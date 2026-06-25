/**
 * POST /api/holdings/dividends/correct
 *
 * Reverses a dividend that was applied with the wrong cash/DRIP setting, then
 * re-applies it with the opposite setting. Targets rows by their UUID `id`.
 *
 * Body: { id: string }
 *
 * Reversal logic:
 *   Was DRIP (reinvested=true, shares_delta>0):
 *     — subtract shares_delta from holding.shares, recalculate cost_basis
 *     — re-apply as cash credit to cash_balances
 *   Was cash (reinvested=false, cash_delta>0):
 *     — subtract cash_delta from cash_balances
 *     — re-apply as DRIP using current Finnhub price (not historical)
 *
 * If the holding no longer exists when trying to DRIP, falls back to cash.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchQuote } from "@/lib/finnhub";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { id, deleteOnly = false } = body as { id?: string; deleteOnly?: boolean };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Fetch the ledger row — scoped to this user.
  const { data: row, error: fetchErr } = await supabase
    .from("applied_corporate_actions")
    .select("id, holding_id, ticker, name, amount, reinvested, shares_delta, cash_delta, price_per_share, account, effective_date, is_manual")
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("action_type", "dividend")
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Dividend not found" }, { status: 404 });

  // deleteOnly: reverse the effect and remove the row, no re-apply.
  if (deleteOnly) {
    const wasDrip = (row.reinvested as boolean | null) === true;
    const sd = Number(row.shares_delta ?? 0);
    const cd = Number(row.cash_delta ?? 0);
    const amt = Number(row.amount ?? 0);
    const acct = (row.account as string) ?? "Unassigned";
    const hid = row.holding_id as string;

    if (wasDrip && sd > 0) {
      const { data: h } = await supabase.from("holdings").select("shares,cost_basis").eq("id", hid).maybeSingle();
      if (h) {
        const restored = Number(h.shares) - sd;
        if (restored > 0) {
          const restoredCost = (Number(h.shares) * Number(h.cost_basis) - amt) / restored;
          await supabase.from("holdings").update({ shares: restored, cost_basis: Math.max(0, restoredCost) }).eq("id", hid);
        }
      }
    } else if (!wasDrip && cd > 0) {
      const { data: ex } = await supabase.from("cash_balances").select("balance,label").eq("user_id", user.id).eq("account", acct).maybeSingle();
      const newBal = Number(ex?.balance ?? 0) - cd;
      await supabase.from("cash_balances").upsert(
        { user_id: user.id, account: acct, label: ex?.label ?? "Cash", balance: newBal, updated_at: new Date().toISOString() },
        { onConflict: "user_id,account" },
      );
    }
    const { error: delErr } = await supabase.from("applied_corporate_actions").delete().eq("id", id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    return NextResponse.json({ success: true, deleted: true });
  }

  const wasReinvested = row.reinvested as boolean | null;
  const sharesDelta = Number(row.shares_delta ?? 0);
  const cashDelta = Number(row.cash_delta ?? 0);
  const amount = Number(row.amount ?? 0);
  const ticker = (row.ticker as string) ?? "";
  const account = (row.account as string) ?? "Unassigned";
  const holdingId = row.holding_id as string;
  const effectiveDate = row.effective_date as string;

  // Look up the current holding (may not exist if position was closed).
  const { data: holding } = await supabase
    .from("holdings")
    .select("id, shares, cost_basis")
    .eq("id", holdingId)
    .maybeSingle();

  let newReinvested: boolean;
  let newDetail: string;
  let newSharesDelta = 0;
  let newCashDelta = 0;
  let newPricePerShare: number | null = null;

  if (wasReinvested) {
    // Was DRIP → correct to cash.
    newReinvested = false;

    // Reverse the DRIP shares from the holding if it still exists.
    if (holding && sharesDelta > 0) {
      const restoredShares = Number(holding.shares) - sharesDelta;
      if (restoredShares > 0) {
        const restoredCost = (Number(holding.shares) * Number(holding.cost_basis) - amount) / restoredShares;
        const { error: holdingErr } = await supabase
          .from("holdings")
          .update({ shares: restoredShares, cost_basis: Math.max(0, restoredCost) })
          .eq("id", holdingId);
        if (holdingErr) return NextResponse.json({ error: holdingErr.message }, { status: 500 });
      }
      // If restoredShares <= 0 user sold down — skip holding update, still credit cash.
    }

    // Credit cash.
    const { data: existing } = await supabase
      .from("cash_balances")
      .select("balance, label")
      .eq("user_id", user.id)
      .eq("account", account)
      .maybeSingle();
    const newBalance = Number(existing?.balance ?? 0) + amount;
    await supabase.from("cash_balances").upsert(
      { user_id: user.id, account, label: existing?.label ?? "Cash", balance: newBalance, updated_at: new Date().toISOString() },
      { onConflict: "user_id,account" },
    );

    newCashDelta = amount;
    newDetail = `Corrected DRIP→Cash: $${amount.toFixed(2)} credited to cash`;
  } else {
    // Was cash → correct to DRIP (if holding still exists).
    if (!holding) {
      return NextResponse.json(
        { error: "Holding no longer exists — cannot reinvest. Delete the entry instead if it was incorrect." },
        { status: 422 },
      );
    }

    // Reverse the cash credit.
    const { data: existing } = await supabase
      .from("cash_balances")
      .select("balance, label")
      .eq("user_id", user.id)
      .eq("account", account)
      .maybeSingle();
    const restoredBalance = Number(existing?.balance ?? 0) - cashDelta;
    await supabase.from("cash_balances").upsert(
      { user_id: user.id, account, label: existing?.label ?? "Cash", balance: restoredBalance, updated_at: new Date().toISOString() },
      { onConflict: "user_id,account" },
    );

    // Apply DRIP at current market price.
    const quote = await fetchQuote(ticker);
    const price = quote?.price ?? null;

    if (!price || price <= 0) {
      // Can't DRIP without a price — roll back and leave as cash.
      await supabase.from("cash_balances").upsert(
        { user_id: user.id, account, label: existing?.label ?? "Cash", balance: Number(existing?.balance ?? 0), updated_at: new Date().toISOString() },
        { onConflict: "user_id,account" },
      );
      return NextResponse.json({ error: "Could not fetch live price for DRIP reinvestment. Try again shortly." }, { status: 503 });
    }

    const bought = amount / price;
    const currentShares = Number(holding.shares);
    const currentCost = Number(holding.cost_basis);
    const newShares = currentShares + bought;
    const newCostBasis = (currentShares * currentCost + amount) / newShares;

    const { error: holdingErr } = await supabase
      .from("holdings")
      .update({ shares: newShares, cost_basis: newCostBasis })
      .eq("id", holdingId);
    if (holdingErr) return NextResponse.json({ error: holdingErr.message }, { status: 500 });

    newReinvested = true;
    newSharesDelta = bought;
    newPricePerShare = price;
    newDetail = `Corrected Cash→DRIP: +${bought.toFixed(6)} sh @ $${price.toFixed(2)} ($${amount.toFixed(2)})`;
  }

  // Replace the ledger row with the corrected version.
  const { error: deleteErr } = await supabase
    .from("applied_corporate_actions")
    .delete()
    .eq("id", id);
  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  const { error: insertErr } = await supabase.from("applied_corporate_actions").insert({
    holding_id: holdingId,
    user_id: user.id,
    action_type: "dividend",
    effective_date: effectiveDate,
    detail: newDetail,
    ticker,
    name: row.name,
    amount,
    reinvested: newReinvested,
    shares_delta: newSharesDelta,
    cash_delta: newCashDelta,
    price_per_share: newPricePerShare,
    account,
    is_manual: row.is_manual ?? false,
  });
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  return NextResponse.json({ success: true, newReinvested });
}
