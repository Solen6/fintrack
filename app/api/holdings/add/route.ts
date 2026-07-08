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

  const { error } = await supabase.from("holdings").insert({
    user_id: user.id,
    ticker: ticker.toUpperCase(),
    name: name ?? ticker.toUpperCase(),
    shares, // face value for bonds
    cost_basis: perUnit,
    account: account.trim(),
    notes: notes ?? null,
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
  });

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

  return NextResponse.json({ ok: true });
}
