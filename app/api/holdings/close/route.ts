import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { holdingId, shares: sharesToClose, salePrice } = body as {
    holdingId: string;
    shares: number;
    salePrice: number;
  };

  if (!holdingId || !sharesToClose || sharesToClose <= 0 || !salePrice || salePrice <= 0) {
    return NextResponse.json({ error: "holdingId, shares (>0), and salePrice (>0) are required" }, { status: 400 });
  }

  const { data: holding, error: fetchErr } = await supabase
    .from("holdings")
    .select("*")
    .eq("id", holdingId)
    .eq("user_id", user.id)
    .single();

  if (fetchErr || !holding) {
    return NextResponse.json({ error: "Holding not found" }, { status: 404 });
  }

  // `holding.shares` is signed for a derivative (negative = short — see
  // supabase/holdings-derivatives.sql). `sharesToClose` from the UI is always
  // a positive magnitude ("how much to close"), so compare/derive against the
  // magnitude, not the raw signed value.
  const magnitude = Math.abs(holding.shares);
  if (sharesToClose > magnitude) {
    return NextResponse.json({ error: `Cannot close ${sharesToClose} — only ${magnitude} held` }, { status: 400 });
  }
  const sign = holding.shares < 0 ? -1 : 1;
  const closedShares = sign * sharesToClose; // signed, same convention as holdings.shares
  const isFuture = holding.instrument_type === "future";

  const { error: insertErr } = await supabase.from("closed_positions").insert({
    user_id: user.id,
    ticker: holding.ticker,
    name: holding.name,
    shares: closedShares, // face value for bonds; signed effective units for derivatives
    cost_basis: holding.cost_basis,
    sale_price: salePrice, // clean price / 100 for bonds; price per unit for derivatives
    account: holding.account,
    notes: holding.notes,
    instrument_type: holding.instrument_type ?? "equity",
    underlying: holding.underlying ?? null,
    expiry: holding.expiry ?? null,
    strike: holding.strike ?? null,
    option_type: holding.option_type ?? null,
    multiplier: holding.multiplier ?? 1,
    direction: holding.direction ?? "LONG",
  });

  if (insertErr) {
    if (insertErr.message?.includes("relation") && insertErr.message?.includes("does not exist")) {
      return NextResponse.json({ error: "Run supabase/closed-positions.sql in the SQL Editor first" }, { status: 503 });
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // remaining moves toward 0 from either side (a short's holding.shares is
  // negative, so it trends -100 → 0, not 0 → -100 — `<= 0` alone would
  // wrongly delete on the FIRST partial close of a short).
  const remaining = holding.shares - closedShares;
  const isFullyClosed = Math.abs(remaining) < 1e-9;
  if (isFullyClosed) {
    await supabase.from("holdings").delete().eq("id", holdingId).eq("user_id", user.id);
  } else {
    await supabase.from("holdings").update({ shares: remaining }).eq("id", holdingId).eq("user_id", user.id);
  }

  // Sale proceeds land in the account's cash balance (creating the row if
  // needed). closedShares already carries the sign, so this formula is
  // correct for both directions with no branching: closing a LONG (positive
  // closedShares) credits cash (you're selling); closing a SHORT (negative
  // closedShares) debits cash (you're buying to cover). Futures are margin
  // instruments — no cash was moved opening the position (see /api/holdings/add),
  // so none moves closing it either; skip the cash-balance adjustment entirely.
  // Non-fatal if cash_balances isn't migrated yet — the close still succeeds.
  if (isFuture) {
    return NextResponse.json({ ok: true, remaining, proceeds: 0, cashBalance: null });
  }

  const proceeds = Math.round(closedShares * salePrice * 100) / 100;
  const { data: existingCash } = await supabase
    .from("cash_balances")
    .select("balance,label")
    .eq("user_id", user.id)
    .eq("account", holding.account)
    .maybeSingle();

  const newBalance = Math.round((Number(existingCash?.balance ?? 0) + proceeds) * 100) / 100;
  await supabase.from("cash_balances").upsert(
    {
      user_id: user.id,
      account: holding.account,
      label: existingCash?.label ?? "Cash",
      balance: newBalance,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,account" },
  );

  return NextResponse.json({ ok: true, remaining, proceeds, cashBalance: newBalance });
}
