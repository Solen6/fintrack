/**
 * POST /api/holdings/dividends/manual
 *
 * Manually record a dividend for one of the user's current holdings.
 *
 * Body:
 *   holdingId      — uuid of the holding to credit
 *   effectiveDate  — YYYY-MM-DD
 *   amountPerShare — dividend per share in $
 *   reinvested     — true = DRIP (add shares), false = credit cash
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchQuote } from "@/lib/finnhub";
import { fetchExDateClose } from "@/lib/corporate-actions";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { holdingId, effectiveDate, amountPerShare, reinvested } = body as {
    holdingId?: string;
    effectiveDate?: string;
    amountPerShare?: number;
    reinvested?: boolean;
  };

  if (!holdingId || !effectiveDate || amountPerShare == null) {
    return NextResponse.json({ error: "holdingId, effectiveDate, and amountPerShare are required" }, { status: 400 });
  }

  // Fetch the holding — RLS ensures it belongs to this user.
  const { data: holding, error: holdingErr } = await supabase
    .from("holdings")
    .select("id, ticker, name, shares, cost_basis, account, instrument_type")
    .eq("id", holdingId)
    .maybeSingle();

  if (holdingErr) return NextResponse.json({ error: holdingErr.message }, { status: 500 });
  if (!holding) return NextResponse.json({ error: "Holding not found" }, { status: 404 });
  if (holding.instrument_type === "bond") {
    // Bonds accrue coupons on face value — the per-share dividend / DRIP path
    // does not apply and would corrupt the face-value encoding.
    return NextResponse.json({ error: "Bonds accrue coupons, not dividends." }, { status: 400 });
  }
  if (holding.instrument_type === "option" || holding.instrument_type === "future") {
    // Options/futures don't pay dividends, and the per-share math here would
    // corrupt the signed "effective shares" encoding.
    return NextResponse.json({ error: "Options and futures don't pay dividends." }, { status: 400 });
  }

  const shares = Number(holding.shares);
  const costBasis = Number(holding.cost_basis);
  const ticker = holding.ticker as string;
  const account = ((holding.account as string | null) ?? "").trim() || "Unassigned";
  const total = amountPerShare * shares;

  // Price of the security on the chosen ex-date — used for a DRIP buy now and
  // recorded so a later cash↔DRIP switch reinvests at the historical price.
  const exClose = await fetchExDateClose(ticker, effectiveDate);

  let detail: string;
  let sharesDelta = 0;
  let cashDelta = 0;
  let pricePerShare: number | null = exClose ?? null;
  let newReinvested = reinvested ?? false;

  if (reinvested) {
    // DRIP: buy shares at the ex-date close (fall back to the live quote).
    let price = exClose && exClose > 0 ? exClose : null;
    if (!price) {
      const quote = await fetchQuote(ticker);
      price = quote?.price && quote.price > 0 ? quote.price : null;
    }

    if (!price || price <= 0) {
      return NextResponse.json({ error: "Could not determine a price for DRIP. Try again or use Cash." }, { status: 503 });
    }

    const bought = total / price;
    const newShares = shares + bought;
    const newCostBasis = (shares * costBasis + total) / newShares;

    const { error: updateErr } = await supabase
      .from("holdings")
      .update({ shares: newShares, cost_basis: newCostBasis })
      .eq("id", holdingId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    sharesDelta = bought;
    pricePerShare = price;
    newReinvested = true;
    detail = `Manual DRIP $${amountPerShare}/sh → +${bought.toFixed(6)} sh @ $${price.toFixed(2)} ($${total.toFixed(2)})`;
  } else {
    // Cash: credit to cash_balances.
    const { data: existing } = await supabase
      .from("cash_balances")
      .select("balance, label")
      .eq("user_id", user.id)
      .eq("account", account)
      .maybeSingle();
    const newBalance = Number(existing?.balance ?? 0) + total;
    const { error: cashErr } = await supabase.from("cash_balances").upsert(
      { user_id: user.id, account, label: existing?.label ?? "Cash", balance: newBalance, updated_at: new Date().toISOString() },
      { onConflict: "user_id,account" },
    );
    if (cashErr) return NextResponse.json({ error: cashErr.message }, { status: 500 });

    cashDelta = total;
    detail = `Manual $${amountPerShare}/sh × ${shares.toFixed(4)} sh → $${total.toFixed(2)} to cash`;
  }

  const { error: ledgerErr } = await supabase.from("applied_corporate_actions").insert({
    holding_id: holdingId,
    user_id: user.id,
    action_type: "dividend",
    effective_date: effectiveDate,
    detail,
    ticker,
    name: holding.name,
    amount: total,
    reinvested: newReinvested,
    shares_delta: sharesDelta,
    cash_delta: cashDelta,
    price_per_share: pricePerShare,
    account,
    is_manual: true,
  });

  if (ledgerErr) return NextResponse.json({ error: ledgerErr.message }, { status: 500 });

  return NextResponse.json({ success: true, total, reinvested: newReinvested });
}
