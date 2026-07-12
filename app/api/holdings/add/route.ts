import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordTransaction } from "@/lib/transactions";
import { formatCurrency } from "@/lib/format";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const {
    ticker, name, shares, cost_basis, account, notes,
    instrument_type, bond_type, cusip, coupon_rate, coupon_freq,
    maturity_date, issue_date, day_count, price_source, manual_price, credit_spread_bps,
  } = body as {
    ticker: string;
    name?: string;
    shares: number;
    cost_basis: number;
    account: string;
    notes?: string;
    instrument_type?: "equity" | "bond";
    bond_type?: string;
    cusip?: string;
    coupon_rate?: number;
    coupon_freq?: number;
    maturity_date?: string;
    issue_date?: string;
    day_count?: string;
    price_source?: string;
    manual_price?: number;
    credit_spread_bps?: number;
  };

  if (!ticker || !shares || shares <= 0 || !account) {
    return NextResponse.json({ error: "ticker, shares (>0), and account are required" }, { status: 400 });
  }

  const isBond = instrument_type === "bond";
  const perUnit = cost_basis ?? 0; // per-share for equities; clean price / 100 for bonds (face-value trick)

  if (isBond && !maturity_date && bond_type !== "etf") {
    return NextResponse.json({ error: "maturity date is required for bonds" }, { status: 400 });
  }

  const row: Record<string, unknown> = {
    user_id: user.id,
    ticker: ticker.toUpperCase(),
    name: name ?? ticker.toUpperCase(),
    shares, // face value for bonds
    cost_basis: perUnit,
    account: account.trim(),
    notes: notes ?? null,
    acquired_at: new Date().toISOString(), // added now → same-day daily gain from cost
    ...(isBond
      ? {
          instrument_type: "bond",
          sector: "Fixed Income",
          bond_type: bond_type ?? null,
          cusip: cusip ?? null,
          coupon_rate: coupon_rate ?? null,
          coupon_freq: coupon_freq ?? 2,
          maturity_date: maturity_date ?? null,
          issue_date: issue_date ?? null,
          day_count: day_count ?? "actual/actual",
          price_source: price_source ?? "auto",
          manual_price: manual_price ?? null,
          credit_spread_bps: credit_spread_bps ?? 0,
        }
      : {}),
  };
  let { error } = await supabase.from("holdings").insert(row);
  if (error && /acquired_at/i.test(error.message ?? "")) {
    delete row.acquired_at; // pre-migration fallback
    ({ error } = await supabase.from("holdings").insert(row));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Record the buy in the activity ledger (best-effort). For bonds we omit the
  // quantity/price so the feed doesn't render "10000 @ 0.97" — the description
  // carries the face value and clean price instead.
  await recordTransaction(supabase, user.id, {
    account: account.trim(),
    action: "BUY",
    symbol: ticker.toUpperCase(),
    description: isBond
      ? `Bought ${formatCurrency(shares)} face — ${name ?? ticker.toUpperCase()} @ ${(perUnit * 100).toFixed(2)}`
      : `Bought ${name ?? ticker.toUpperCase()}`,
    quantity: isBond ? null : shares,
    price: isBond ? null : perUnit,
    amount: -(shares * perUnit), // cash outflow (−)
  });

  // Buying pulls cash out of the account's balance, mirroring the sale-proceeds
  // credit in /api/holdings/close so a rebalance (sell → buy) is value-neutral.
  // Non-fatal if cash_balances isn't migrated yet — the holding insert already
  // succeeded. Cash may go negative when recording a position bought with funds
  // not tracked in Fintrack; that's expected and self-corrects when the real
  // cash balance is set.
  const cost = Math.round(shares * perUnit * 100) / 100;
  const { data: existingCash } = await supabase
    .from("cash_balances")
    .select("balance,label")
    .eq("user_id", user.id)
    .eq("account", account.trim())
    .maybeSingle();

  const newBalance = Math.round((Number(existingCash?.balance ?? 0) - cost) * 100) / 100;
  await supabase.from("cash_balances").upsert(
    {
      user_id: user.id,
      account: account.trim(),
      label: existingCash?.label ?? "Cash",
      balance: newBalance,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,account" },
  );

  return NextResponse.json({ ok: true, cost, cashBalance: newBalance });
}
