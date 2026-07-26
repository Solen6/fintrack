/* Year-in-Review summary for the Reports tab. Computed on demand (no stored
   report rows) from the same snapshot / flow / seed history the monthly reports
   and the dashboard use, so the full-year return matches the unit-method figure
   everywhere else. Sharpe/alpha/beta come from a full year of daily returns —
   ~252 observations, far more meaningful than the monthly view's ~21.

   Pure: the API route fetches the rows + benchmark + risk-free and calls this. */

import {
  earliestStoredCapital,
  unitCumReturns,
  chainedPeriodReturns,
  type ReturnSnapshot,
} from "@/lib/portfolio-return";
import {
  computeRiskMetrics,
  dailyReturnsFromCum,
  type DailyReturn,
  type RiskMetrics,
} from "@/lib/risk-metrics";

export const ALL_ACCOUNTS = "__all__";

const norm = (a: string | null | undefined): string => {
  const t = (a ?? "").trim();
  return !t || t === ALL_ACCOUNTS ? "Unassigned" : t;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

// ── Row shapes the route passes in (mapped from the DB selects) ──────────────
export interface SnapshotRow {
  snapshot_date: string; // YYYY-MM-DD
  total_value: number;
  cash: number;
  cost_basis: number;
  account: string | null;
}
export interface FlowRow {
  trade_date: string;
  account: string | null;
  amount: number; // signed: deposit +, withdrawal −
}
export interface SeedRow {
  account: string;
  seed_cost_basis: number;
}
export interface HoldingRow {
  account: string | null;
  shares: number;
  cost_basis: number;
}
export interface CashRow {
  account: string | null;
  balance: number;
}
export interface ClosedRow {
  account: string | null;
  realized_gain: number;
  closed_at: string; // ET date already (YYYY-MM-DD) — route resolves the ET calendar date
}
export interface DividendRow {
  account: string | null;
  effective_date: string; // YYYY-MM-DD
  amount: number; // total gross $
  cash_delta: number; // cash portion (0 if fully reinvested)
}
export interface TxnRow {
  account: string | null;
  trade_date: string;
  action: string;
  amount: number;
}

export interface AnnualSummary {
  year: string;
  account: string;
  yearReturnPct: number | null;
  endValue: number | null; // year-end NAV (securities + cash) — sensitive
  startValue: number | null; // prior year-end NAV, for context — sensitive
  risk: RiskMetrics | null; // beta / alpha (annual) / Sharpe (annualized) / volatility
  monthlyReturns: { period: string; pct: number }[];
  bestMonth: { period: string; pct: number } | null;
  worstMonth: { period: string; pct: number } | null;
  income: { dividendsGross: number; dividendsCash: number; interest: number };
  realizedGain: number;
  fees: number;
  netContributions: number; // Σ external flows over the year (deposits − withdrawals)
  hasData: boolean;
}

/** Minimum daily observations before Sharpe/beta/alpha/volatility are trusted —
 *  below this the year has too little history for the risk metrics to mean
 *  anything (they're still noise-prone, but this stops a handful of days from
 *  producing an eye-popping number). */
const MIN_OBS_FOR_RISK = 20;

/** Per-scope daily NAV series from snapshots.
 *
 *  Rollup ("__all__") uses CARRY-FORWARD: NAV on a date = Σ over accounts of
 *  each account's most recent snapshot value as of that date. Summing only the
 *  accounts physically snapshotted on a given date (the dashboard/monthly rule)
 *  makes the rollup lurch when the daily cron misses an account — which then
 *  wrecks a long-window return and its risk metrics. Carry-forward keeps an
 *  account contributing its last-known value until it's re-snapshotted. */
function scopeSeries(rows: SnapshotRow[], scope: string): { date: string; nav: number }[] {
  const navOf = (r: SnapshotRow) => (Number(r.total_value) || 0) + (Number(r.cash) || 0);
  if (scope !== ALL_ACCOUNTS) {
    return rows
      .filter((r) => r.account != null && norm(r.account) === scope)
      .map((r) => ({ date: r.snapshot_date, nav: navOf(r) }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  // Per-account sorted series + legacy (null-account) rows by date.
  const perAcct = new Map<string, { date: string; nav: number }[]>();
  const legacyByDate = new Map<string, number>();
  for (const r of rows) {
    if (r.account == null) {
      legacyByDate.set(r.snapshot_date, navOf(r));
    } else {
      const a = norm(r.account);
      const arr = perAcct.get(a) ?? [];
      arr.push({ date: r.snapshot_date, nav: navOf(r) });
      perAcct.set(a, arr);
    }
  }
  for (const arr of perAcct.values()) arr.sort((a, b) => (a.date < b.date ? -1 : 1));

  const allDates = [...new Set(rows.map((r) => r.snapshot_date))].sort();
  // Per-account walking pointer (dates ascending) → O(dates + rows).
  const ptr = new Map<string, number>();
  const last = new Map<string, number>();
  const out: { date: string; nav: number }[] = [];
  for (const date of allDates) {
    let sum = 0;
    let anyAcct = false;
    for (const [a, arr] of perAcct) {
      let i = ptr.get(a) ?? 0;
      while (i < arr.length && arr[i].date <= date) {
        last.set(a, arr[i].nav);
        i++;
      }
      ptr.set(a, i);
      if (last.has(a)) {
        sum += last.get(a)!;
        anyAcct = true;
      }
    }
    if (anyAcct) out.push({ date, nav: sum });
    else if (legacyByDate.has(date)) out.push({ date, nav: legacyByDate.get(date)! });
  }
  return out;
}

export function buildAnnualSummary(inputs: {
  year: string; // "2026"
  scope: string; // account name or "__all__"
  snapshots: SnapshotRow[];
  flows: FlowRow[];
  seeds: SeedRow[];
  holdings: HoldingRow[];
  cash: CashRow[];
  closed: ClosedRow[];
  dividends: DividendRow[];
  txns: TxnRow[];
  benchmarkDaily: DailyReturn[];
  benchmarkYearReturnPct: number | null;
  riskFreeAnnualPct: number | null;
  benchmarkSymbol: string;
}): AnnualSummary {
  const { year, scope } = inputs;
  const yearStart = `${year}-01`;
  const nextYear = `${Number(year) + 1}-01`;
  const inYear = (ym: string) => ym >= yearStart && ym < nextYear;

  // ── unit-method cumulative curve for the scope ──
  const nav = scopeSeries(inputs.snapshots, scope);
  const returnSnaps: ReturnSnapshot[] = inputs.snapshots.map((r) => ({
    date: r.snapshot_date,
    value: Number(r.total_value) || 0,
    cash: Number(r.cash) || 0,
    costBasis: Number(r.cost_basis) || 0,
    account: r.account == null ? null : norm(r.account),
  }));
  const seedByAccount = new Map<string, number>();
  for (const s of inputs.seeds) seedByAccount.set(norm(s.account), Number(s.seed_cost_basis) || 0);
  const seedFor = (acct: string): number => {
    const seeded = seedByAccount.get(acct);
    if (seeded != null) return seeded;
    const anchor = earliestStoredCapital(returnSnaps, new Set([acct]), false);
    if (anchor) return anchor.costBasis + anchor.cash;
    const liveCost = inputs.holdings
      .filter((h) => norm(h.account) === acct)
      .reduce((s, h) => s + (Number(h.shares) || 0) * (Number(h.cost_basis) || 0), 0);
    const liveCash = inputs.cash
      .filter((c) => norm(c.account) === acct)
      .reduce((s, c) => s + (Number(c.balance) || 0), 0);
    return liveCost + liveCash;
  };
  const accounts = new Set<string>();
  for (const r of inputs.snapshots) if (r.account != null) accounts.add(norm(r.account));
  for (const a of seedByAccount.keys()) accounts.add(a);
  const seed = scope === ALL_ACCOUNTS
    ? [...accounts].reduce((s, a) => s + seedFor(a), 0)
    : seedFor(scope);

  const flowByDate = new Map<string, number>();
  for (const f of inputs.flows) {
    if (f.account === null) {
      if (scope !== ALL_ACCOUNTS) continue;
    } else if (scope !== ALL_ACCOUNTS && norm(f.account) !== scope) {
      continue;
    }
    const d = String(f.trade_date).slice(0, 10);
    flowByDate.set(d, (flowByDate.get(d) ?? 0) + (Number(f.amount) || 0));
  }

  // Anchor the unit curve at the last snapshot BEFORE the year (the year's
  // opening base), or the first snapshot ever for the inception year. Crucially
  // NOT the dashboard's inceptionDateFor "≥50% of max NAV" heuristic: when NAV
  // grows >2× within a year that would treat the early months as "onboarding"
  // and truncate the year. Year-over-year chaining cancels the seed/anchor
  // level, so the full-year return is unaffected by the absolute anchor.
  const beforeYear = nav.filter((p) => p.date < `${year}-01-01`);
  const anchor = beforeYear.length > 0
    ? beforeYear[beforeYear.length - 1].date
    : nav.length > 0
      ? nav[0].date
      : null;
  const { cumByDate } = unitCumReturns(nav, flowByDate, seed, anchor);

  const yearReturn = chainedPeriodReturns(cumByDate, (d) => d.slice(0, 4)).find((p) => p.key === year);
  const yearReturnPct = yearReturn ? r2(yearReturn.pct) : null;

  const monthlyReturns = chainedPeriodReturns(cumByDate, (d) => d.slice(0, 7))
    .filter((p) => inYear(p.key))
    .map((p) => ({ period: p.key, pct: r2(p.pct) }));
  const bestMonth = monthlyReturns.length
    ? monthlyReturns.reduce((a, b) => (b.pct > a.pct ? b : a))
    : null;
  const worstMonth = monthlyReturns.length
    ? monthlyReturns.reduce((a, b) => (b.pct < a.pct ? b : a))
    : null;

  const yearDaily = dailyReturnsFromCum(cumByDate).filter((d) => d.date >= `${year}-01-01` && d.date < `${nextYear}-01`);

  const risk = computeRiskMetrics({
    portfolioDaily: yearDaily,
    benchmarkDaily: inputs.benchmarkDaily,
    monthReturnPct: yearReturnPct, // the "period" return — here a full year
    benchmarkReturnPct: inputs.benchmarkYearReturnPct,
    riskFreeAnnualPct: inputs.riskFreeAnnualPct,
    benchmarkSymbol: inputs.benchmarkSymbol,
  });
  // Too few days → drop the portfolio-vs-benchmark metrics but keep the market
  // context (S&P return, risk-free) so the Performance tiles still populate.
  if (risk.observations < MIN_OBS_FOR_RISK) {
    risk.beta = null;
    risk.alpha = null;
    risk.sharpe = null;
    risk.volatility = null;
  }

  // Year-end + prior-year-end NAV for the scope.
  const inYearNav = nav.filter((p) => p.date >= `${year}-01-01` && p.date < `${nextYear}-01`);
  const beforeNav = nav.filter((p) => p.date < `${year}-01-01`);
  const endValue = inYearNav.length ? r2(inYearNav[inYearNav.length - 1].nav) : null;
  const startValue = beforeNav.length ? r2(beforeNav[beforeNav.length - 1].nav) : null;

  // ── Aggregates over the year (scope-filtered) ──
  const scoped = <T extends { account: string | null }>(rows: T[]) =>
    rows.filter((r) => scope === ALL_ACCOUNTS || norm(r.account) === scope);

  let dividendsGross = 0;
  let dividendsCash = 0;
  for (const d of scoped(inputs.dividends)) {
    if (!inYear(String(d.effective_date).slice(0, 7))) continue;
    dividendsGross += Number(d.amount) || 0;
    dividendsCash += Number(d.cash_delta) || 0;
  }
  let realizedGain = 0;
  for (const c of scoped(inputs.closed)) {
    if (!inYear(String(c.closed_at).slice(0, 7))) continue;
    realizedGain += Number(c.realized_gain) || 0;
  }
  let interest = 0;
  let fees = 0;
  for (const t of scoped(inputs.txns)) {
    if (!inYear(String(t.trade_date).slice(0, 7))) continue;
    if (t.action === "INTEREST") interest += Number(t.amount) || 0;
    else if (t.action === "FEE") fees += Math.abs(Number(t.amount) || 0);
  }
  let netContributions = 0;
  for (const [date, amt] of flowByDate) if (inYear(date.slice(0, 7))) netContributions += amt;

  return {
    year,
    account: scope,
    yearReturnPct,
    endValue,
    startValue,
    risk, // always present for market context; portfolio metrics may be null
    monthlyReturns,
    bestMonth,
    worstMonth,
    income: { dividendsGross: r2(dividendsGross), dividendsCash: r2(dividendsCash), interest: r2(interest) },
    realizedGain: r2(realizedGain),
    fees: r2(fees),
    netContributions: r2(netContributions),
    hasData: nav.length > 0 || monthlyReturns.length > 0,
  };
}
