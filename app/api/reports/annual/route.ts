import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { yahooDailyHistory } from "@/lib/yahoo";
import { getTreasuryYieldForMonth } from "@/lib/treasury-curve";
import { dailyReturnsFromCloses, type DailyReturn } from "@/lib/risk-metrics";
import { buildAnnualSummary } from "@/lib/annual-summary";

/* Year-in-Review summary — computed on demand (no stored rows) from the user's
   snapshot / flow / seed history, so the full-year return matches the unit-
   method figure used on the dashboard and monthly reports. Sharpe/alpha/beta
   come from the full year of daily returns.

     GET ?account=<scope>&year=YYYY   (defaults: __all__ / latest year with data)

   Returns { account, year, years, summary }. */

const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const etToday = () => ET.format(new Date());
const etDate = (iso: string) => ET.format(new Date(iso));

type Row = Record<string, unknown>;
async function pageAll(
  q: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const PAGE = 1000;
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/** SPY daily returns within the year + the year's total return. */
async function benchmarkForYear(
  year: string,
): Promise<{ symbol: string; daily: DailyReturn[]; yearReturnPct: number | null }> {
  const symbol = "SPY";
  const start = `${year}-01-01`;
  const nextStart = `${Number(year) + 1}-01-01`;
  const fromUnix = Math.floor(Date.parse(`${start}T00:00:00Z`) / 1000) - 12 * 86_400;
  const toUnix = Math.floor(Date.parse(`${nextStart}T00:00:00Z`) / 1000) + 2 * 86_400;
  const closes = (await yahooDailyHistory(symbol, fromUnix, toUnix)).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const daily = dailyReturnsFromCloses(closes).filter((d) => d.date >= start && d.date < nextStart);
  const before = closes.filter((c) => c.date < start);
  const inYear = closes.filter((c) => c.date >= start && c.date < nextStart);
  let yearReturnPct: number | null = null;
  if (inYear.length > 0) {
    const base = before.length > 0 ? before[before.length - 1].close : inYear[0].close;
    if (base > 0) yearReturnPct = (inYear[inYear.length - 1].close / base - 1) * 100;
  }
  return { symbol, daily, yearReturnPct };
}

/** Average short-tenor Treasury yield across the year, sampled quarterly (only
 *  months that have already closed). Null if every sample is unreachable. */
async function riskFreeForYear(year: string): Promise<number | null> {
  const nowYm = etToday().slice(0, 7);
  const months = ["01", "04", "07", "10"]
    .map((m) => `${year}-${m}`)
    .filter((ym) => ym <= nowYm);
  if (months.length === 0) months.push(`${year}-01`);
  const vals = (await Promise.all(months.map((ym) => getTreasuryYieldForMonth(ym, 0.25)))).filter(
    (v): v is number => v != null,
  );
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = request.nextUrl.searchParams.get("account") || "__all__";
  const yearParam = request.nextUrl.searchParams.get("year");
  if (yearParam && !/^\d{4}$/.test(yearParam)) {
    return NextResponse.json({ error: "year must be YYYY" }, { status: 400 });
  }

  const uid = user.id;
  let snapshots: Row[];
  try {
    snapshots = await pageAll((from, to) =>
      supabase
        .from("portfolio_snapshots")
        .select("snapshot_date,total_value,cash,cost_basis,account")
        .eq("user_id", uid)
        .order("id")
        .range(from, to),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/schema cache/i.test(msg) || /does not exist/i.test(msg)) {
      return NextResponse.json({ account, year: null, years: [], summary: null });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const years = [...new Set(snapshots.map((r) => String(r.snapshot_date).slice(0, 4)))].sort((a, b) =>
    b.localeCompare(a),
  );
  if (years.length === 0) {
    return NextResponse.json({ account, year: null, years: [], summary: null });
  }
  const year = yearParam && years.includes(yearParam) ? yearParam : years[0];

  const start = `${year}-01-01`;
  const nextStart = `${Number(year) + 1}-01-01`;

  const [flows, seeds, holdings, cash, closed, dividends, txns, benchmark, riskFree] = await Promise.all([
    pageAll((from, to) =>
      supabase
        .from("transactions")
        .select("trade_date,account,amount")
        .eq("user_id", uid)
        .in("action", ["DEPOSIT", "WITHDRAWAL", "TRANSFER_IN", "TRANSFER_OUT", "TRANSFER"])
        .order("id")
        .range(from, to),
    ).catch(() => [] as Row[]),
    supabase.from("portfolio_seed").select("account,seed_cost_basis").eq("user_id", uid).then((r) => r.data ?? []),
    supabase.from("holdings").select("account,shares,cost_basis").eq("user_id", uid).then((r) => r.data ?? []),
    supabase.from("cash_balances").select("account,balance").eq("user_id", uid).then((r) => r.data ?? []),
    supabase
      .from("closed_positions")
      .select("account,realized_gain,closed_at")
      .eq("user_id", uid)
      .gte("closed_at", `${start}T00:00:00Z`)
      .lt("closed_at", `${nextStart}T12:00:00Z`)
      .then((r) => r.data ?? []),
    supabase
      .from("applied_corporate_actions")
      .select("account,effective_date,amount,cash_delta")
      .eq("user_id", uid)
      .eq("action_type", "dividend")
      .gte("effective_date", start)
      .lt("effective_date", nextStart)
      .then((r) => r.data ?? []),
    supabase
      .from("transactions")
      .select("account,trade_date,action,amount")
      .eq("user_id", uid)
      .in("action", ["INTEREST", "FEE"])
      .gte("trade_date", start)
      .lt("trade_date", nextStart)
      .then((r) => r.data ?? []),
    benchmarkForYear(year),
    riskFreeForYear(year),
  ]);

  const summary = buildAnnualSummary({
    year,
    scope: account,
    snapshots: snapshots as never,
    flows: flows as never,
    seeds: seeds as never,
    holdings: holdings as never,
    cash: cash as never,
    // closed_at is timestamptz — resolve its ET calendar date so year bucketing matches the app.
    closed: (closed as Row[]).map((c) => ({
      account: (c.account as string | null) ?? null,
      realized_gain: Number(c.realized_gain) || 0,
      closed_at: etDate(String(c.closed_at)),
    })),
    dividends: dividends as never,
    txns: txns as never,
    benchmarkDaily: benchmark.daily,
    benchmarkYearReturnPct: benchmark.yearReturnPct,
    riskFreeAnnualPct: riskFree,
    benchmarkSymbol: benchmark.symbol,
  });

  return NextResponse.json({ account, year, years, summary });
}
