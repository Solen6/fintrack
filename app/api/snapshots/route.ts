import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchQuotes } from "@/lib/finnhub";
import { isMarketDay } from "@/lib/market-calendar";
import { computeBondMarks, type BondRow } from "@/lib/bond-marks";

/* ─── GET: the user's snapshot history, oldest first ───
   Returns one row per (date, account). Legacy rows captured before per-account
   tracking have account === null and represent the combined total for that day;
   the dashboard treats them as a fallback when every account is enabled. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("portfolio_snapshots")
    .select("snapshot_date,total_value,cash,cost_basis,account")
    .eq("user_id", user.id)
    .order("snapshot_date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    snapshots: (data ?? []).map((s) => ({
      date: s.snapshot_date as string,
      value: Number(s.total_value),
      cash: Number(s.cash ?? 0),
      costBasis: Number(s.cost_basis ?? 0),
      account: (s.account as string | null) ?? null,
    })),
  });
}

/* ─── POST: capture today's portfolio value, one row per account (idempotent
   per day per account). Computes value server-side from real holdings × live
   quotes. Opening the app once a day is enough to build history. */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // US market day (Eastern). Skip weekends/holidays — recording then would just
  // duplicate the prior close and flat-line the chart.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
  if (!isMarketDay(today)) {
    return NextResponse.json({ captured: false, reason: "Market closed." });
  }

  const [{ data: holdings, error: hErr }, { data: cashRows }] = await Promise.all([
    // select("*") so a pre-migration deploy still captures snapshots (missing
    // bond columns read as undefined = equity) instead of 400-ing.
    supabase
      .from("holdings")
      .select("*")
      .eq("user_id", user.id),
    supabase.from("cash_balances").select("account,balance").eq("user_id", user.id),
  ]);
  if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 });

  // Cash balance per account (a flat dollar amount, not priced).
  const cashByAccount = new Map<string, number>();
  for (const c of cashRows ?? []) {
    const acct = ((c.account as string | null) ?? "").trim() || "Unassigned";
    cashByAccount.set(acct, (cashByAccount.get(acct) ?? 0) + Number(c.balance));
  }

  if ((!holdings || holdings.length === 0) && cashByAccount.size === 0) {
    return NextResponse.json({ captured: false, reason: "No holdings." });
  }

  // Equities + bond ETFs price via quotes; non-ETF bonds via computeBondMarks.
  const tickers = [
    ...new Set(
      (holdings ?? [])
        .filter((h) => h.instrument_type !== "bond" || h.bond_type === "etf")
        .map((h) => h.ticker as string),
    ),
  ];
  const quotes = tickers.length ? await fetchQuotes(tickers) : {};

  const bondRows = (holdings ?? []).filter((h) => h.instrument_type === "bond" && h.bond_type !== "etf");
  const bondMarks = bondRows.length ? await computeBondMarks(bondRows as unknown as BondRow[]) : {};

  // Bucket securities value and cost basis per account.
  const byAccount = new Map<string, number>();
  const costBasisByAccount = new Map<string, number>();
  let pricedPositions = 0;
  for (const h of holdings ?? []) {
    const isNonEtfBond = h.instrument_type === "bond" && h.bond_type !== "etf";
    const mark = isNonEtfBond ? bondMarks[h.id as string] : undefined;
    const q = quotes[(h.ticker as string).toUpperCase()];
    const price = mark ? mark.currentPrice : q?.price ?? Number(h.cost_basis);
    if (q || mark) pricedPositions++;
    const acct = ((h.account as string | null) ?? "").trim() || "Unassigned";
    byAccount.set(acct, (byAccount.get(acct) ?? 0) + Number(h.shares) * price);
    costBasisByAccount.set(acct, (costBasisByAccount.get(acct) ?? 0) + Number(h.shares) * Number(h.cost_basis));
  }

  // Don't record a junk data point if we have holdings but live prices were
  // broadly unavailable. (Cash-only users skip this — nothing to price.)
  if ((holdings?.length ?? 0) > 0 && pricedPositions === 0) {
    return NextResponse.json({ captured: false, reason: "No live prices available." });
  }

  // One row per account that has holdings OR cash. total_value = securities
  // only; cash is stored separately so Return % stays a pure-securities figure.
  const accounts = new Set<string>([...byAccount.keys(), ...cashByAccount.keys()]);
  const rows = [...accounts].map((account) => ({
    user_id: user.id,
    snapshot_date: today,
    total_value: byAccount.get(account) ?? 0,
    cash: cashByAccount.get(account) ?? 0,
    cost_basis: costBasisByAccount.get(account) ?? 0,
    account,
  }));

  // Upsert per account. The unique index is (user_id, snapshot_date, coalesce(account,'')).
  const { error: upErr } = await supabase
    .from("portfolio_snapshots")
    .upsert(rows, { onConflict: "user_id,snapshot_date,account" });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const totalValue = rows.reduce((s, r) => s + r.total_value + r.cash, 0);
  return NextResponse.json({ captured: true, date: today, value: totalValue, accounts: rows.length });
}
