import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordTransaction } from "@/lib/transactions";
import { formatCurrency } from "@/lib/format";
import { FUTURES_SPECS, OPTION_MULTIPLIER } from "@/lib/contract-specs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const {
    ticker, name, shares, cost_basis, account, notes,
    instrument_type, bond_type, cusip, coupon_rate, coupon_freq,
    maturity_date, issue_date, day_count, price_source, manual_price, credit_spread_bps,
    underlying, expiry, strike, option_type, direction, contracts,
  } = body as {
    ticker: string;
    name?: string;
    shares: number;
    cost_basis: number;
    account: string;
    notes?: string;
    instrument_type?: "equity" | "bond" | "option" | "future";
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
    underlying?: string;
    expiry?: string;
    strike?: number;
    option_type?: "CALL" | "PUT";
    direction?: "LONG" | "SHORT";
    contracts?: number;
  };

  const isBond = instrument_type === "bond";
  const isOption = instrument_type === "option";
  const isFuture = instrument_type === "future";
  const isDerivative = isOption || isFuture;
  const dir: "LONG" | "SHORT" = direction === "SHORT" ? "SHORT" : "LONG";

  if (!ticker || !account) {
    return NextResponse.json({ error: "ticker and account are required" }, { status: 400 });
  }
  if (isBond && !maturity_date && bond_type !== "etf") {
    return NextResponse.json({ error: "maturity date is required for bonds" }, { status: 400 });
  }
  if (isDerivative && (!contracts || contracts <= 0)) {
    return NextResponse.json({ error: "contracts (>0) is required" }, { status: 400 });
  }
  if (isOption && (!underlying || !strike || strike <= 0 || !expiry || !option_type)) {
    return NextResponse.json({ error: "underlying, strike, expiry, and option_type are required for an option" }, { status: 400 });
  }
  if (isFuture && !underlying) {
    return NextResponse.json({ error: "underlying futures symbol is required" }, { status: 400 });
  }
  if (!isDerivative && (!shares || shares <= 0)) {
    return NextResponse.json({ error: "shares (>0) is required" }, { status: 400 });
  }

  // Multiplier: $ per 1.00 price move per contract. Options are always ×100;
  // futures come from the known contract specs (the AddFutureForm sources its
  // symbol dropdown from the same table, so this always resolves in practice).
  const multiplier = isOption
    ? OPTION_MULTIPLIER
    : isFuture
      ? FUTURES_SPECS[underlying!]?.multiplier ?? 1
      : 1;
  if (isFuture && !FUTURES_SPECS[underlying!]) {
    return NextResponse.json({ error: `Unknown futures symbol ${underlying}` }, { status: 400 });
  }

  // "Effective shares" trick (same one bonds use for face value): storing
  // contracts × multiplier × sign(direction) here means value/cost/gain math
  // everywhere else in the app (shares × price) stays correct unmodified,
  // including the sign flip for a short position.
  const effectiveShares = isDerivative ? contracts! * multiplier * (dir === "SHORT" ? -1 : 1) : shares;
  const perUnit = cost_basis ?? 0; // per-share for equities/options; clean price / 100 for bonds; per-point for futures

  const derivativeTicker = isOption
    ? `${underlying!.toUpperCase()} ${expiry} ${strike} ${option_type}`
    : isFuture
      ? underlying!.toUpperCase()
      : ticker.toUpperCase();
  const derivativeName = isOption
    ? `${underlying!.toUpperCase()} ${option_type} $${strike} exp ${expiry}`
    : isFuture
      ? FUTURES_SPECS[underlying!]?.name ?? underlying!.toUpperCase()
      : (name ?? ticker.toUpperCase());

  const row: Record<string, unknown> = {
    user_id: user.id,
    ticker: isDerivative ? derivativeTicker : ticker.toUpperCase(),
    name: isDerivative ? derivativeName : (name ?? ticker.toUpperCase()),
    shares: effectiveShares, // face value for bonds; contracts × multiplier × sign for derivatives
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
    ...(isDerivative
      ? {
          instrument_type,
          sector: "Derivatives",
          underlying: underlying!.toUpperCase(),
          expiry: isOption ? expiry : null,
          strike: isOption ? strike : null,
          option_type: isOption ? option_type : null,
          multiplier,
          direction: dir,
        }
      : {}),
  };
  let { error } = await supabase.from("holdings").insert(row);
  if (error && /acquired_at/i.test(error.message ?? "")) {
    delete row.acquired_at; // pre-migration fallback
    ({ error } = await supabase.from("holdings").insert(row));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Record the buy in the activity ledger (best-effort). For bonds/derivatives
  // we omit the quantity/price so the feed doesn't render a raw "effective
  // shares" number — the description carries the human-readable units instead.
  const derivativeVerb = isOption ? (dir === "SHORT" ? "Sold to open" : "Bought") : (dir === "SHORT" ? "Opened short" : "Opened long");
  await recordTransaction(supabase, user.id, {
    account: account.trim(),
    action: "BUY",
    symbol: derivativeTicker,
    description: isBond
      ? `Bought ${formatCurrency(shares)} face — ${name ?? ticker.toUpperCase()} @ ${(perUnit * 100).toFixed(2)}`
      : isDerivative
        ? `${derivativeVerb} ${contracts} contract${contracts === 1 ? "" : "s"} ${derivativeName} @ ${perUnit.toFixed(2)}`
        : `Bought ${name ?? ticker.toUpperCase()}`,
    quantity: isBond || isDerivative ? null : shares,
    price: isBond || isDerivative ? null : perUnit,
    amount: isFuture ? 0 : -(effectiveShares * perUnit), // futures don't move cash at open (margin only, not modeled); options/equity/bonds do
  });

  // Buying pulls cash out of the account's balance (or, for a short option's
  // premium, credits it — effectiveShares is negative so the sign flips
  // naturally), mirroring the sale-proceeds credit in /api/holdings/close so
  // a rebalance (sell → buy) is value-neutral. Futures are margin
  // instruments — no cash actually changes hands opening a position (margin
  // isn't modeled here), so skip the cash-balance adjustment entirely.
  // Non-fatal if cash_balances isn't migrated yet — the holding insert already
  // succeeded. Cash may go negative when recording a position bought with funds
  // not tracked in Fintrack; that's expected and self-corrects when the real
  // cash balance is set.
  if (isFuture) {
    return NextResponse.json({ ok: true, cost: 0, cashBalance: null });
  }

  const cost = Math.round(effectiveShares * perUnit * 100) / 100;
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
