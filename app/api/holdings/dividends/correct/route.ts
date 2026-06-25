/**
 * POST /api/holdings/dividends/correct
 *
 * Reverses a dividend that was applied with the wrong cash/DRIP setting, then
 * re-applies it the other way. Targets rows by their UUID `id`.
 *
 * Body: { id: string, deleteOnly?: boolean }
 *
 * Reinvestment always uses the security's EX-DATE price (price_per_share on the
 * row, recorded at apply time; recomputed from the date for older rows that
 * predate that column), never today's price.
 *
 * Robustness for the recovered SPDR-ETF rows (and any row written before the
 * delta columns existed): they have account = NULL, shares_delta/cash_delta = 0,
 * price_per_share = NULL, and a holding_id that may be STALE (a CSV re-upload
 * deletes + re-inserts holdings with new uuids). So we:
 *   - resolve the holding by id, then fall back to the user's current holding
 *     for that ticker,
 *   - derive the cash account from the live holding (matching how the cron
 *     credited it), not the row's null account,
 *   - verify the holdings UPDATE actually matched a row (no silent no-op).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchQuote } from "@/lib/finnhub";
import { fetchExDateClose } from "@/lib/corporate-actions";

interface HoldingRow { id: string; shares: number; cost_basis: number; account: string | null }

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

  const wasReinvested = (row.reinvested as boolean | null) === true;
  const amount = Number(row.amount ?? 0);
  const storedShares = Number(row.shares_delta ?? 0);
  const storedCash = Number(row.cash_delta ?? 0);
  const storedPrice = Number(row.price_per_share ?? 0);
  const ticker = ((row.ticker as string) ?? "").toUpperCase();
  const rowAccount = (row.account as string | null) ?? null;
  const holdingId = row.holding_id as string;
  const effectiveDate = row.effective_date as string;

  if (!deleteOnly && !(amount > 0)) {
    return NextResponse.json(
      { error: "This dividend has no recorded amount — delete it and re-add it with an amount." },
      { status: 400 },
    );
  }

  // ── Resolve the holding: by id first, then by ticker (handles stale ids) ──
  let holding: HoldingRow | null = null;
  {
    const { data: byId } = await supabase
      .from("holdings").select("id, shares, cost_basis, account")
      .eq("id", holdingId).maybeSingle();
    holding = (byId as HoldingRow | null) ?? null;

    if (!holding && ticker) {
      const { data: byTicker } = await supabase
        .from("holdings").select("id, shares, cost_basis, account")
        .eq("user_id", user.id).ilike("ticker", ticker);
      const list = (byTicker ?? []) as HoldingRow[];
      if (list.length > 0) {
        holding =
          list.find((h) => (h.account ?? "") === (rowAccount ?? "")) ??
          (list.length === 1 ? list[0] : list[0]); // ambiguous multi-account → first
      }
    }
  }

  // Account the cron credited cash to = (holding.account || "Unassigned"). Match
  // that exactly so the cash reversal/credit lands on the right balance.
  const account = ((holding?.account ?? rowAccount ?? "").trim()) || "Unassigned";
  const effectiveHoldingId = holding?.id ?? holdingId;

  // Ex-date price this dividend reinvests at: stored → historical close → live.
  async function exDatePrice(): Promise<number | null> {
    if (storedPrice > 0) return storedPrice;
    if (ticker && effectiveDate) {
      const hist = await fetchExDateClose(ticker, effectiveDate);
      if (hist && hist > 0) return hist;
    }
    const q = await fetchQuote(ticker);
    return q?.price && q.price > 0 ? q.price : null;
  }
  // Shares reinvested for this dividend — recorded delta, else amount ÷ price.
  const reinvestedSharesFor = (price: number) => (storedShares > 0 ? storedShares : amount / price);
  // Cash credited for this dividend — recorded delta, else the full amount.
  const cashCredited = storedCash > 0 ? storedCash : amount;

  async function adjustCash(delta: number) {
    const { data: ex } = await supabase
      .from("cash_balances").select("balance,label")
      .eq("user_id", user!.id).eq("account", account).maybeSingle();
    const newBal = Number(ex?.balance ?? 0) + delta;
    const { error } = await supabase.from("cash_balances").upsert(
      { user_id: user!.id, account, label: ex?.label ?? "Cash", balance: newBal, updated_at: new Date().toISOString() },
      { onConflict: "user_id,account" },
    );
    return error;
  }

  // Update a holding's shares/cost_basis and confirm a row actually matched
  // (a stale id would otherwise update 0 rows and look like success).
  async function writeHolding(hid: string, shares: number, costBasis: number): Promise<string | null> {
    const { data, error } = await supabase
      .from("holdings").update({ shares, cost_basis: Math.max(0, costBasis) })
      .eq("id", hid).select("id");
    if (error) return error.message;
    if (!data || data.length === 0) return "Holding update did not match any row.";
    return null;
  }

  // ─── deleteOnly: reverse the effect and remove the row ───
  if (deleteOnly) {
    if (wasReinvested) {
      if (holding) {
        const price = await exDatePrice();
        const sd = price ? reinvestedSharesFor(price) : storedShares;
        if (sd > 0) {
          const restored = Number(holding.shares) - sd;
          if (restored > 0) {
            const restoredCost = (Number(holding.shares) * Number(holding.cost_basis) - amount) / restored;
            await writeHolding(holding.id, restored, restoredCost);
          }
        }
      }
    } else {
      await adjustCash(-cashCredited);
    }
    const { error: delErr } = await supabase.from("applied_corporate_actions").delete().eq("id", id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    return NextResponse.json({ success: true, deleted: true });
  }

  let newReinvested: boolean;
  let newDetail: string;
  let newSharesDelta = 0;
  let newCashDelta = 0;
  let newPricePerShare: number | null = storedPrice > 0 ? storedPrice : null;

  if (wasReinvested) {
    // ─── DRIP → Cash ───
    if (!holding) {
      return NextResponse.json(
        { error: `No current holding found for ${ticker} to remove the reinvested shares from. Delete the entry instead.` },
        { status: 422 },
      );
    }
    const price = await exDatePrice();
    const sd = price ? reinvestedSharesFor(price) : storedShares;
    if (sd > 0) {
      const restoredShares = Number(holding.shares) - sd;
      if (restoredShares > 0) {
        const restoredCost = (Number(holding.shares) * Number(holding.cost_basis) - amount) / restoredShares;
        const err = await writeHolding(holding.id, restoredShares, restoredCost);
        if (err) return NextResponse.json({ error: err }, { status: 500 });
      }
      // restoredShares <= 0 → user already sold down; skip the holding write, still credit cash.
    }
    const cashErr = await adjustCash(amount);
    if (cashErr) return NextResponse.json({ error: cashErr }, { status: 500 });

    newReinvested = false;
    newCashDelta = amount;
    newPricePerShare = price ?? newPricePerShare;
    newDetail = `Corrected DRIP→Cash: $${amount.toFixed(2)} credited to ${account}`;
  } else {
    // ─── Cash → DRIP ───
    if (!holding) {
      return NextResponse.json(
        { error: `No current holding found for ${ticker} to reinvest into. Delete the entry instead.` },
        { status: 422 },
      );
    }
    const price = await exDatePrice();
    if (!price || price <= 0) {
      return NextResponse.json(
        { error: "Could not determine the security's price on the ex-dividend date. Try again shortly." },
        { status: 503 },
      );
    }

    const bought = amount / price;
    const curShares = Number(holding.shares);
    const curCost = Number(holding.cost_basis);
    const newShares = curShares + bought;
    const newCostBasis = (curShares * curCost + amount) / newShares;

    const err = await writeHolding(holding.id, newShares, newCostBasis);
    if (err) return NextResponse.json({ error: err }, { status: 500 });

    // Only reverse the cash AFTER the shares landed.
    const cashErr = await adjustCash(-cashCredited);
    if (cashErr) return NextResponse.json({ error: cashErr }, { status: 500 });

    newReinvested = true;
    newSharesDelta = bought;
    newPricePerShare = price;
    newDetail = `Corrected Cash→DRIP: +${bought.toFixed(6)} sh @ $${price.toFixed(2)} ($${amount.toFixed(2)})`;
  }

  // Replace the ledger row with the corrected version (point at the live holding).
  const { error: deleteErr } = await supabase.from("applied_corporate_actions").delete().eq("id", id);
  if (deleteErr) return NextResponse.json({ error: deleteErr.message }, { status: 500 });

  const { error: insertErr } = await supabase.from("applied_corporate_actions").insert({
    holding_id: effectiveHoldingId,
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
