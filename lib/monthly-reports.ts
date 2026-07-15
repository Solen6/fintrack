import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchQuotes } from "@/lib/finnhub";
import { fetchSectors } from "@/lib/sectors";
import { resolveAccountType, type AccountType } from "@/lib/account-types";

/* Monthly per-account report generator (supabase/monthly-reports.sql).
   Runs from the daily snapshot cron (service-role client, all users) right
   after snapshots are captured. For the just-closed month it writes three
   reports per account plus an '__all__' rollup:

     · cash_flow — inflows/outflows/net savings rate from the merged activity
                   sources (transactions ledger + closed_positions + dividends)
     · portfolio — positions, cost basis, unrealized G/L, sector allocation,
                   month-end value + monthly return from portfolio_snapshots
     · tax       — realized gains, dividend/interest income log, fees

   Timing: "missing" is checked in the DB, never against the calendar — the
   cron only fires on market days, so the 1st is often skipped. cash_flow and
   tax regenerate on every run through day REFRESH_THROUGH_DAY of the new month
   (Yahoo posts ETF ex-dividends 1-2 days late; the corporate-actions window
   backfills them, and the refresh picks them up), then freeze. portfolio
   generates once unless forced; its positions are month-end reconstructions —
   live holdings with post-month-end buys/sells/DRIPs reversed from the
   activity ledgers. Everything is idempotent via the unique
   (user_id, account, period, report_type) upsert key.

   Versioning: a report written by older logic must not survive a logic fix
   (e.g. the dividend ex-date entitlement bug lived on in frozen payloads).
   Bump PAYLOAD_VERSION whenever report math changes; rows carrying an older
   payload `v` are treated as missing and regenerate on the next run for
   their period. */

export const ALL_ACCOUNTS = "__all__";
export const REPORT_TYPES = ["cash_flow", "portfolio", "tax"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** Bump when report math changes — older-version rows regenerate automatically.
 *  v2: dividend ex-date entitlement fix, month-end position reconstruction,
 *  single-snapshot months report null return instead of 0%. */
export const PAYLOAD_VERSION = 2;

/** Days into the new month during which cash_flow/tax reports keep refreshing. */
const REFRESH_THROUGH_DAY = 7;
/** Max events embedded in a cash_flow payload (newest kept). */
const MAX_EVENTS = 300;
/** Max tickers per user for the sector lookup (sequential, 50ms apart). */
const MAX_SECTOR_TICKERS = 60;

const COVERAGE_NOTE =
  "Event coverage: buys/deposits from the transactions ledger (since 2026-06), " +
  "sells from closed positions, dividends from the corporate-actions ledger. " +
  "Bulk CSV imports and absolute cash edits are not event-logged, so totals " +
  "may not reconcile against balance changes.";

const HOLDING_PERIOD_NOTE =
  "Acquisition dates are not tracked; short-term vs long-term classification " +
  "is unavailable. Cost basis is the position's average per share at close.";

// ── Payload shapes (versioned; the UI reads these) ──────────────────────────

export interface ReportEvent {
  date: string; // YYYY-MM-DD
  type: string;
  symbol: string | null;
  description: string;
  shares: number | null;
  price: number | null;
  amount: number; // signed USD cash impact: inflow +, outflow − (0 for DRIP)
  gross: number; // event magnitude (e.g. full dividend even when reinvested)
  account: string;
}

export interface CashFlowReport {
  v: number;
  period: string;
  account: string;
  accountType: AccountType | "all";
  generatedOn: string;
  hasLedger: boolean;
  inflows: {
    deposits: number;
    saleProceeds: number;
    dividends: number;
    interest: number;
    transfersIn: number;
    other: number;
    total: number;
  };
  outflows: {
    purchases: number;
    withdrawals: number;
    fees: number;
    transfersOut: number;
    other: number;
    total: number;
  };
  netCashFlow: number;
  /** (inflow − outflow) / inflow × 100 — null when there was no inflow. */
  savingsRate: number | null;
  /** DRIP value excluded from cash flow (no cash moved). */
  dividendsReinvested: number;
  cash: {
    start: number | null;
    end: number | null;
    startDate: string | null;
    endDate: string | null;
  };
  events: ReportEvent[];
  eventCount: number;
  coverageNote: string;
}

export interface PortfolioPosition {
  ticker: string;
  name: string;
  sector: string;
  shares: number;
  costPerShare: number;
  costBasis: number;
  price: number;
  value: number;
  gain: number;
  gainPct: number | null;
  /** false = no live quote; price fell back to cost basis. */
  priced: boolean;
}

export interface PortfolioReport {
  v: number;
  period: string;
  account: string;
  accountType: AccountType | "all";
  generatedOn: string;
  /** Month-end date the positions represent (post-month-end trades reversed);
   *  prices are still generation-time quotes. */
  positionsAsOf: string;
  positions: PortfolioPosition[];
  totals: {
    costBasis: number;
    value: number;
    gain: number;
    gainPct: number | null;
    cash: number;
    totalValue: number;
  };
  allocation: {
    bySector: { sector: string; value: number; weightPct: number }[];
    /** Rollup only — weight by resolved account type. */
    byType: { type: string; value: number; weightPct: number }[] | null;
  };
  monthEnd: {
    snapshotDate: string | null;
    securities: number | null;
    cash: number | null;
    total: number | null;
    /** Prior month's last snapshot (securities), the return base. */
    prevMonthEnd: number | null;
    /** Securities-only point-to-point month change. NOT flow-adjusted — a
     *  deposit invested mid-month inflates it; the dashboard's unit-method
     *  return will differ whenever the month had external cash flows. */
    monthReturnPct: number | null;
  };
}

export interface RealizedLot {
  ticker: string;
  name: string;
  shares: number;
  costPerShare: number;
  salePrice: number;
  proceeds: number;
  costBasis: number;
  gain: number;
  date: string; // YYYY-MM-DD Eastern
}

export interface DividendIncome {
  ticker: string;
  name: string;
  gross: number;
  cash: number;
  reinvested: number;
  payments: number;
}

export interface TaxReport {
  v: number;
  period: string;
  account: string;
  generatedOn: string;
  realized: {
    lots: RealizedLot[];
    totalProceeds: number;
    totalCostBasis: number;
    totalGain: number;
    holdingPeriodNote: string;
  };
  income: {
    dividends: DividendIncome[];
    totalGross: number;
    totalCash: number;
    totalReinvested: number;
    interest: number;
  };
  fees: { total: number; count: number };
}

export interface MonthlyReportsSummary {
  period: string;
  users: number;
  written: number;
  /** Rows that failed to upsert + users whose processing threw. */
  failed: number;
  skipped: string | null;
  refreshWindow: boolean;
}

// ── Small helpers ────────────────────────────────────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100;
// Blank accounts group under "Unassigned"; an account literally named
// '__all__' is remapped too, so the rollup sentinel can never be duplicated in
// a user's scope list (duplicate upsert conflict keys abort the whole batch).
const norm = (a: string | null | undefined) => {
  const t = (a ?? "").trim();
  return !t || t === ALL_ACCOUNTS ? "Unassigned" : t;
};

/** Existence-set key — account names are free text, so use a control-char
 *  delimiter they can't realistically contain (unlike '|'). */
const tupleKey = (u: string, a: string, t: string) => [u, a, t].join("\u0001");

const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
/** Calendar date (YYYY-MM-DD) of a timestamptz in Eastern time. */
const etDate = (iso: string) => ET_DATE.format(new Date(iso));

/** Page through a select — PostgREST silently truncates at max-rows (1000 by
 *  default on Supabase), which would corrupt reports without any error. Every
 *  query passed in must carry a stable .order() for consistent page bounds. */
async function pageAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ rows: T[]; error: string | null }> {
  const PAGE = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { rows, error: null };
  }
}

/** 'YYYY-MM' of the month before the given YYYY-MM-DD. */
export function prevPeriod(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

/** First day of the period and of the next month (exclusive upper bound). */
export function periodBounds(period: string): { start: string; nextStart: string; prevStart: string } {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return {
    start: `${period}-01`,
    nextStart: `${ny}-${String(nm).padStart(2, "0")}-01`,
    prevStart: `${py}-${String(pm).padStart(2, "0")}-01`,
  };
}

function groupByUser<T extends { user_id: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const list = m.get(r.user_id);
    if (list) list.push(r);
    else m.set(r.user_id, [r]);
  }
  return m;
}

// Ledger actions with no dedicated table (SELL/DIV are skipped — they live in
// closed_positions / applied_corporate_actions and would double-count).
const LEDGER_ACTIONS = new Set([
  "BUY", "DEPOSIT", "WITHDRAWAL", "INTEREST", "FEE", "TRANSFER_IN", "TRANSFER_OUT", "OTHER",
]);

// ── Internal row shapes ──────────────────────────────────────────────────────

interface HoldingRow {
  user_id: string;
  ticker: string;
  name: string | null;
  shares: number;
  cost_basis: number;
  account: string | null;
}
interface CashRow { user_id: string; account: string | null; balance: number }
interface MetaRow { user_id: string; account: string; type: string }
interface TxnRow {
  user_id: string;
  trade_date: string;
  action: string;
  symbol: string | null;
  description: string | null;
  quantity: number | null;
  price: number | null;
  amount: number;
  account: string | null;
}
interface ClosedRow {
  user_id: string;
  ticker: string;
  name: string | null;
  shares: number;
  cost_basis: number;
  sale_price: number;
  realized_gain: number | null;
  account: string | null;
  closed_at: string;
}
interface DivRow {
  user_id: string;
  effective_date: string;
  ticker: string | null;
  name: string | null;
  amount: number | null;
  reinvested: boolean | null;
  shares_delta: number | null;
  cash_delta: number | null;
  account: string | null;
}
interface SnapRow {
  user_id: string;
  snapshot_date: string;
  total_value: number;
  cash: number;
  account: string | null;
}
interface SnapPoint { date: string; securities: number; cash: number }

// ── Event merge (mirrors /api/transactions/recent) ──────────────────────────

function mergeEvents(txns: TxnRow[], closed: ClosedRow[], divs: DivRow[], period: string): ReportEvent[] {
  const events: ReportEvent[] = [];

  for (const r of closed) {
    const date = etDate(r.closed_at);
    if (date.slice(0, 7) !== period) continue; // ET month boundary, exact
    const shares = Number(r.shares) || 0;
    const price = Number(r.sale_price) || 0;
    const proceeds = r2(shares * price);
    events.push({
      date,
      type: "SELL",
      symbol: r.ticker,
      description: r.name ?? r.ticker,
      shares,
      price,
      amount: proceeds,
      gross: proceeds,
      account: norm(r.account),
    });
  }

  for (const r of divs) {
    const date = String(r.effective_date).slice(0, 10);
    if (date.slice(0, 7) !== period) continue; // fetch window extends past month end
    const reinvested = r.reinvested === true;
    const gross = Number(r.amount ?? r.cash_delta ?? 0);
    const amt = reinvested ? 0 : Number(r.cash_delta ?? r.amount ?? 0);
    events.push({
      date,
      type: "DIV",
      symbol: r.ticker,
      description: reinvested ? "Dividend · reinvested" : "Dividend · cash",
      shares: null,
      price: null,
      amount: r2(amt),
      gross: r2(gross),
      account: norm(r.account),
    });
  }

  for (const r of txns) {
    const action = (r.action ?? "").toUpperCase();
    if (!LEDGER_ACTIONS.has(action)) continue; // SELL/DIV covered above
    const date = String(r.trade_date).slice(0, 10);
    if (date.slice(0, 7) !== period) continue; // fetch window extends past month end
    events.push({
      date,
      type: action,
      symbol: r.symbol,
      description: r.description ?? action,
      shares: r.quantity != null ? Number(r.quantity) : null,
      price: r.price != null ? Number(r.price) : null,
      amount: Number(r.amount) || 0,
      gross: Math.abs(Number(r.amount) || 0),
      account: norm(r.account),
    });
  }

  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return events;
}

// ── Report builders ──────────────────────────────────────────────────────────

function buildCashFlow(
  period: string,
  account: string,
  accountType: AccountType | "all",
  generatedOn: string,
  events: ReportEvent[],
  series: SnapPoint[],
  hasLedger: boolean,
): CashFlowReport {
  const inflows = { deposits: 0, saleProceeds: 0, dividends: 0, interest: 0, transfersIn: 0, other: 0, total: 0 };
  const outflows = { purchases: 0, withdrawals: 0, fees: 0, transfersOut: 0, other: 0, total: 0 };
  let dividendsReinvested = 0;

  for (const e of events) {
    switch (e.type) {
      case "BUY": outflows.purchases += Math.abs(e.amount); break;
      case "SELL": inflows.saleProceeds += e.amount; break;
      case "DIV":
        if (e.amount !== 0) inflows.dividends += e.amount;
        else dividendsReinvested += e.gross;
        break;
      case "DEPOSIT":
        if (e.amount >= 0) inflows.deposits += e.amount;
        else outflows.withdrawals += -e.amount;
        break;
      case "WITHDRAWAL": outflows.withdrawals += Math.abs(e.amount); break;
      case "INTEREST": inflows.interest += Math.abs(e.amount); break;
      case "FEE": outflows.fees += Math.abs(e.amount); break;
      case "TRANSFER_IN": inflows.transfersIn += Math.abs(e.amount); break;
      case "TRANSFER_OUT": outflows.transfersOut += Math.abs(e.amount); break;
      default:
        if (e.amount >= 0) inflows.other += e.amount;
        else outflows.other += -e.amount;
    }
  }
  inflows.total = inflows.deposits + inflows.saleProceeds + inflows.dividends + inflows.interest + inflows.transfersIn + inflows.other;
  outflows.total = outflows.purchases + outflows.withdrawals + outflows.fees + outflows.transfersOut + outflows.other;
  for (const k of Object.keys(inflows) as (keyof typeof inflows)[]) inflows[k] = r2(inflows[k]);
  for (const k of Object.keys(outflows) as (keyof typeof outflows)[]) outflows[k] = r2(outflows[k]);

  // Cash position: prior-month close (else first in-month snapshot) → last in-month.
  const { start } = periodBounds(period);
  const inMonth = series.filter((s) => s.date >= start && s.date.slice(0, 7) === period);
  const prev = series.filter((s) => s.date < start);
  const startPoint = prev.length > 0 ? prev[prev.length - 1] : inMonth[0] ?? null;
  const endPoint = inMonth.length > 0 ? inMonth[inMonth.length - 1] : null;

  return {
    v: PAYLOAD_VERSION,
    period,
    account,
    accountType,
    generatedOn,
    hasLedger,
    inflows,
    outflows,
    netCashFlow: r2(inflows.total - outflows.total),
    savingsRate: inflows.total > 0 ? r2(((inflows.total - outflows.total) / inflows.total) * 100) : null,
    dividendsReinvested: r2(dividendsReinvested),
    cash: {
      start: startPoint ? r2(startPoint.cash) : null,
      end: endPoint ? r2(endPoint.cash) : null,
      startDate: startPoint?.date ?? null,
      endDate: endPoint?.date ?? null,
    },
    events: events.slice(0, MAX_EVENTS),
    eventCount: events.length,
    coverageNote: COVERAGE_NOTE,
  };
}

function buildPortfolio(
  period: string,
  account: string,
  accountType: AccountType | "all",
  generatedOn: string,
  holdings: HoldingRow[],
  cashTotal: number,
  quotes: Record<string, { price: number }>,
  sectors: Record<string, string>,
  series: SnapPoint[],
  typeOf: (account: string) => AccountType,
): PortfolioReport {
  // Aggregate per ticker (rollup can hold the same ticker in several accounts).
  const byTicker = new Map<string, { name: string; shares: number; cost: number; priced: boolean; value: number }>();
  for (const h of holdings) {
    const ticker = h.ticker.toUpperCase();
    const q = quotes[ticker];
    const shares = Number(h.shares) || 0;
    const price = q?.price ?? Number(h.cost_basis);
    const cur = byTicker.get(ticker) ?? { name: h.name ?? ticker, shares: 0, cost: 0, priced: !!q, value: 0 };
    cur.shares += shares;
    cur.cost += shares * Number(h.cost_basis);
    cur.value += shares * price;
    cur.priced = cur.priced && !!q;
    byTicker.set(ticker, cur);
  }

  const positions: PortfolioPosition[] = [...byTicker.entries()]
    .map(([ticker, p]) => {
      const gain = p.value - p.cost;
      return {
        ticker,
        name: p.name,
        sector: sectors[ticker] ?? "",
        shares: p.shares,
        costPerShare: p.shares > 0 ? r2(p.cost / p.shares) : 0,
        costBasis: r2(p.cost),
        price: p.shares > 0 ? r2(p.value / p.shares) : 0,
        value: r2(p.value),
        gain: r2(gain),
        gainPct: p.cost > 0 ? r2((gain / p.cost) * 100) : null,
        priced: p.priced,
      };
    })
    .sort((a, b) => b.value - a.value);

  // Month-end value + monthly return from the snapshot series.
  const { start } = periodBounds(period);
  const inMonth = series.filter((s) => s.date >= start && s.date.slice(0, 7) === period);
  const prev = series.filter((s) => s.date < start);
  const end = inMonth.length > 0 ? inMonth[inMonth.length - 1] : null;
  // Base = prior month's close; first tracked month falls back to its own first
  // snapshot — but only when a later snapshot exists to measure against, else
  // base and end are the same point and the "return" would be a fake flat 0%.
  const base =
    prev.length > 0
      ? prev[prev.length - 1].securities
      : inMonth.length > 1
        ? inMonth[0].securities
        : null;
  const monthReturnPct =
    end && base != null && base > 0 ? r2(((end.securities - base) / base) * 100) : null;

  const value = r2(positions.reduce((s, p) => s + p.value, 0));
  const costBasis = r2(positions.reduce((s, p) => s + p.costBasis, 0));
  const gain = r2(value - costBasis);
  // Month-end snapshot cash when we have it (live balances drift after month
  // end, same as positions); live total is the no-snapshot fallback.
  const cash = r2(end ? end.cash : cashTotal);
  const totalValue = r2(value + cash);

  // Sector allocation (value-weighted, cash as its own slice).
  const bySectorMap = new Map<string, number>();
  for (const p of positions) {
    const s = p.sector || "Other";
    bySectorMap.set(s, (bySectorMap.get(s) ?? 0) + p.value);
  }
  if (cash > 0) bySectorMap.set("Cash", (bySectorMap.get("Cash") ?? 0) + cash);
  const bySector = [...bySectorMap.entries()]
    .map(([sector, v]) => ({
      sector,
      value: r2(v),
      weightPct: totalValue > 0 ? r2((v / totalValue) * 100) : 0,
    }))
    .sort((a, b) => b.value - a.value);

  // Account-type allocation — rollup only.
  let byType: PortfolioReport["allocation"]["byType"] = null;
  if (account === ALL_ACCOUNTS) {
    const typeMap = new Map<string, number>();
    for (const h of holdings) {
      const t = typeOf(norm(h.account));
      const q = quotes[h.ticker.toUpperCase()];
      const v = (Number(h.shares) || 0) * (q?.price ?? Number(h.cost_basis));
      typeMap.set(t, (typeMap.get(t) ?? 0) + v);
    }
    if (cash > 0) typeMap.set("cash", (typeMap.get("cash") ?? 0) + cash);
    byType = [...typeMap.entries()]
      .map(([type, v]) => ({
        type,
        value: r2(v),
        weightPct: totalValue > 0 ? r2((v / totalValue) * 100) : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }

  // Last calendar day of the period — positionsAsOf fallback when the month
  // has no stored snapshot.
  const monthEndDate =
    end?.date ??
    `${period}-${String(new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;

  return {
    v: PAYLOAD_VERSION,
    period,
    account,
    accountType,
    generatedOn,
    positionsAsOf: monthEndDate,
    positions,
    totals: {
      costBasis,
      value,
      gain,
      gainPct: costBasis > 0 ? r2((gain / costBasis) * 100) : null,
      cash,
      totalValue,
    },
    allocation: { bySector, byType },
    monthEnd: {
      snapshotDate: end?.date ?? null,
      securities: end ? r2(end.securities) : null,
      cash: end ? r2(end.cash) : null,
      total: end ? r2(end.securities + end.cash) : null,
      prevMonthEnd: prev.length > 0 ? r2(prev[prev.length - 1].securities) : null,
      monthReturnPct,
    },
  };
}

function buildTax(
  period: string,
  account: string,
  generatedOn: string,
  closed: ClosedRow[],
  divs: DivRow[],
  events: ReportEvent[],
): TaxReport {
  const lots: RealizedLot[] = closed
    .map((r) => {
      const date = etDate(r.closed_at);
      const shares = Number(r.shares) || 0;
      const salePrice = Number(r.sale_price) || 0;
      const costPerShare = Number(r.cost_basis) || 0;
      const proceeds = r2(shares * salePrice);
      const costBasis = r2(shares * costPerShare);
      return {
        ticker: r.ticker,
        name: r.name ?? r.ticker,
        shares,
        costPerShare,
        salePrice,
        proceeds,
        costBasis,
        gain: r.realized_gain != null ? r2(Number(r.realized_gain)) : r2(proceeds - costBasis),
        date,
      };
    })
    .filter((l) => l.date.slice(0, 7) === period)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const divMap = new Map<string, DividendIncome>();
  for (const r of divs) {
    const ticker = r.ticker ?? "—";
    const gross = Number(r.amount ?? r.cash_delta ?? 0);
    const reinvested = r.reinvested === true;
    const cur = divMap.get(ticker) ?? { ticker, name: r.name ?? ticker, gross: 0, cash: 0, reinvested: 0, payments: 0 };
    cur.gross += gross;
    if (reinvested) cur.reinvested += gross;
    else cur.cash += Number(r.cash_delta ?? r.amount ?? 0);
    cur.payments += 1;
    divMap.set(ticker, cur);
  }
  const dividends = [...divMap.values()]
    .map((d) => ({ ...d, gross: r2(d.gross), cash: r2(d.cash), reinvested: r2(d.reinvested) }))
    .sort((a, b) => b.gross - a.gross);

  const interest = r2(events.filter((e) => e.type === "INTEREST").reduce((s, e) => s + Math.abs(e.amount), 0));
  const feeEvents = events.filter((e) => e.type === "FEE");

  return {
    v: PAYLOAD_VERSION,
    period,
    account,
    generatedOn,
    realized: {
      lots,
      totalProceeds: r2(lots.reduce((s, l) => s + l.proceeds, 0)),
      totalCostBasis: r2(lots.reduce((s, l) => s + l.costBasis, 0)),
      totalGain: r2(lots.reduce((s, l) => s + l.gain, 0)),
      holdingPeriodNote: HOLDING_PERIOD_NOTE,
    },
    income: {
      dividends,
      totalGross: r2(dividends.reduce((s, d) => s + d.gross, 0)),
      totalCash: r2(dividends.reduce((s, d) => s + d.cash, 0)),
      totalReinvested: r2(dividends.reduce((s, d) => s + d.reinvested, 0)),
      interest,
    },
    fees: {
      total: r2(feeEvents.reduce((s, e) => s + Math.abs(e.amount), 0)),
      count: feeEvents.length,
    },
  };
}

// ── Snapshot series (per account, or rollup with the legacy-NULL rule) ──────

function snapshotSeries(rows: SnapRow[], scope: string): SnapPoint[] {
  if (scope !== ALL_ACCOUNTS) {
    return rows
      .filter((r) => r.account != null && norm(r.account) === scope)
      .map((r) => ({ date: r.snapshot_date, securities: Number(r.total_value) || 0, cash: Number(r.cash) || 0 }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  // Rollup: sum per-account rows per date; a legacy NULL-account row stands in
  // only when that date has no per-account rows (same rule as the dashboard).
  const byDate = new Map<string, { acct: SnapPoint | null; legacy: SnapPoint | null }>();
  for (const r of rows) {
    const point = { date: r.snapshot_date, securities: Number(r.total_value) || 0, cash: Number(r.cash) || 0 };
    const cur = byDate.get(r.snapshot_date) ?? { acct: null, legacy: null };
    if (r.account == null) {
      cur.legacy = point;
    } else if (cur.acct) {
      cur.acct.securities += point.securities;
      cur.acct.cash += point.cash;
    } else {
      cur.acct = { ...point };
    }
    byDate.set(r.snapshot_date, cur);
  }
  return [...byDate.values()]
    .map((v) => v.acct ?? v.legacy)
    .filter((p): p is SnapPoint => p !== null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ── Month-end position reconstruction ────────────────────────────────────────

/** Roll live holdings back to month-end by reversing post-month-end activity:
 *  ledger BUYs (−shares, −shares×price), closed-position SELLs (+shares,
 *  +shares×recorded avg cost — exact under average-cost accounting), and
 *  DRIPs (−shares_delta, −reinvested amount). A position fully sold after
 *  month end is restored; one fully bought after month end is dropped.
 *  Limits: bond BUYs carry null quantity/price and can't be reversed, and
 *  the ledger only covers activity since 2026-06 — both leave the live row
 *  as-is, which matches the old behavior. */
export function monthEndHoldings(
  holdings: HoldingRow[],
  postTxns: TxnRow[],
  postClosed: ClosedRow[],
  postDivs: DivRow[],
): HoldingRow[] {
  const key = (account: string | null | undefined, ticker: string) =>
    `${norm(account)}\u0001${ticker.toUpperCase()}`;
  const map = new Map<string, { user_id: string; ticker: string; name: string | null; account: string | null; shares: number; cost: number }>();
  for (const h of holdings) {
    const k = key(h.account, h.ticker);
    const shares = Number(h.shares) || 0;
    const cur = map.get(k) ?? {
      user_id: h.user_id, ticker: h.ticker.toUpperCase(), name: h.name,
      account: norm(h.account), shares: 0, cost: 0,
    };
    cur.shares += shares;
    cur.cost += shares * (Number(h.cost_basis) || 0);
    map.set(k, cur);
  }

  for (const r of postTxns) {
    if ((r.action ?? "").toUpperCase() !== "BUY") continue;
    if (r.symbol == null || r.quantity == null || r.price == null) continue; // bonds
    const cur = map.get(key(r.account, r.symbol));
    if (!cur) continue; // bought post-month AND already gone — nothing to reverse
    cur.shares -= Number(r.quantity) || 0;
    cur.cost -= (Number(r.quantity) || 0) * (Number(r.price) || 0);
  }
  for (const r of postDivs) {
    if (r.reinvested !== true || !r.ticker) continue;
    const bought = Number(r.shares_delta) || 0;
    if (bought <= 0) continue;
    const cur = map.get(key(r.account, r.ticker));
    if (!cur) continue;
    cur.shares -= bought;
    cur.cost -= Number(r.amount) || 0;
  }
  for (const r of postClosed) {
    const k = key(r.account, r.ticker);
    const shares = Number(r.shares) || 0;
    const cur = map.get(k) ?? {
      user_id: r.user_id, ticker: r.ticker.toUpperCase(), name: r.name,
      account: norm(r.account), shares: 0, cost: 0,
    };
    cur.shares += shares;
    cur.cost += shares * (Number(r.cost_basis) || 0);
    map.set(k, cur);
  }

  return [...map.values()]
    .filter((p) => p.shares > 1e-9)
    .map((p) => ({
      user_id: p.user_id,
      ticker: p.ticker,
      name: p.name,
      shares: p.shares,
      cost_basis: p.cost > 0 && p.shares > 0 ? p.cost / p.shares : 0,
      account: p.account,
    }));
}

// ── Writes ───────────────────────────────────────────────────────────────────

interface ReportRowInsert {
  user_id: string;
  account: string;
  period: string;
  report_type: ReportType;
  payload: CashFlowReport | PortfolioReport | TaxReport;
  generated_at: string;
}

/** Batch upsert; on batch failure retry row-by-row so good rows still land
 *  (one poisoned row must not starve the user's whole statement forever). */
async function upsertReportRows(
  db: SupabaseClient,
  rows: ReportRowInsert[],
): Promise<{ written: number; failed: number }> {
  if (rows.length === 0) return { written: 0, failed: 0 };
  const { error } = await db
    .from("monthly_reports")
    .upsert(rows, { onConflict: "user_id,account,period,report_type" });
  if (!error) return { written: rows.length, failed: 0 };
  let written = 0;
  for (const row of rows) {
    const { error: rowErr } = await db
      .from("monthly_reports")
      .upsert(row, { onConflict: "user_id,account,period,report_type" });
    if (!rowErr) written += 1;
  }
  return { written, failed: rows.length - written };
}

// ── Main entry — called from the snapshot cron ───────────────────────────────

export async function generateMonthlyReports(
  db: SupabaseClient,
  today: string, // YYYY-MM-DD Eastern
  liveQuotes?: Record<string, { price: number }>,
  opts?: { period?: string; force?: boolean },
): Promise<MonthlyReportsSummary> {
  const force = opts?.force === true;
  const period = opts?.period ?? prevPeriod(today);
  const dayOfMonth = Number(today.slice(8, 10));
  const refreshWindow = !opts?.period && dayOfMonth <= REFRESH_THROUGH_DAY;
  const summary: MonthlyReportsSummary = {
    period, users: 0, written: 0, failed: 0, skipped: null, refreshWindow,
  };

  // Existing tuples for the period — also the table-exists probe. Rows whose
  // payload carries an older version are left out of the set, so they count
  // as missing and regenerate with current logic.
  const existRes = await pageAll<{ user_id: string; account: string; report_type: string; v: unknown }>(
    (from, to) =>
      db.from("monthly_reports")
        .select("user_id,account,report_type,v:payload->v")
        .eq("period", period)
        .order("id")
        .range(from, to),
  );
  if (existRes.error) {
    summary.skipped = "monthly_reports table missing — run supabase/monthly-reports.sql";
    return summary;
  }
  const existing = new Set(
    existRes.rows
      .filter((r) => Number(r.v) >= PAYLOAD_VERSION)
      .map((r) => tupleKey(r.user_id, r.account, r.report_type)),
  );

  // Cheap universe (holdings + cash) to decide whether any work is needed.
  const [hRes, cRes] = await Promise.all([
    pageAll<HoldingRow>((from, to) =>
      db.from("holdings")
        .select("user_id,ticker,name,shares,cost_basis,account")
        .order("id")
        .range(from, to),
    ),
    pageAll<CashRow>((from, to) =>
      db.from("cash_balances")
        .select("user_id,account,balance")
        .order("user_id")
        .order("account")
        .range(from, to),
    ),
  ]);
  if (hRes.error) throw new Error(hRes.error);
  const holdings = hRes.rows;
  const cash = cRes.error ? [] : cRes.rows;

  const holdingsByUser = groupByUser(holdings);
  const cashByUser = groupByUser(cash);
  const baseUsers = new Set([...holdingsByUser.keys(), ...cashByUser.keys()]);

  if (!force && !refreshWindow) {
    let anyMissing = false;
    for (const u of baseUsers) {
      const accounts = new Set<string>([ALL_ACCOUNTS]);
      for (const h of holdingsByUser.get(u) ?? []) accounts.add(norm(h.account));
      for (const c of cashByUser.get(u) ?? []) accounts.add(norm(c.account));
      for (const a of accounts) {
        for (const t of REPORT_TYPES) {
          if (!existing.has(tupleKey(u, a, t))) { anyMissing = true; break; }
        }
        if (anyMissing) break;
      }
      if (anyMissing) break;
    }
    if (!anyMissing) {
      summary.skipped = "up to date";
      return summary;
    }
  }

  // Heavy path: month activity + snapshots + account types (all paged).
  // Activity fetches run through TODAY, not just month end — the tail past
  // nextStart is what monthEndHoldings() reverses to roll live positions back
  // to the month-end close (mergeEvents/buildTax only ever see in-month rows).
  const { start, nextStart, prevStart } = periodBounds(period);
  const fetchEnd = today >= nextStart
    ? new Date(new Date(`${today}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
    : nextStart;
  const [txnRes, closedRes, divRes, snapRes, metaRes] = await Promise.all([
    pageAll<TxnRow>((from, to) =>
      db.from("transactions")
        .select("user_id,trade_date,action,symbol,description,quantity,price,amount,account")
        .gte("trade_date", start)
        .lt("trade_date", fetchEnd)
        .order("id")
        .range(from, to),
    ),
    pageAll<ClosedRow>((from, to) =>
      db.from("closed_positions")
        .select("user_id,ticker,name,shares,cost_basis,sale_price,realized_gain,account,closed_at")
        .gte("closed_at", `${start}T00:00:00Z`)
        .lt("closed_at", `${fetchEnd}T12:00:00Z`) // pad; exact ET filter in mergeEvents
        .order("id")
        .range(from, to),
    ),
    pageAll<DivRow>((from, to) =>
      db.from("applied_corporate_actions")
        .select("user_id,effective_date,ticker,name,amount,reinvested,shares_delta,cash_delta,account")
        .eq("action_type", "dividend")
        .gte("effective_date", start)
        .lt("effective_date", fetchEnd)
        .order("id")
        .range(from, to),
    ),
    pageAll<SnapRow>((from, to) =>
      db.from("portfolio_snapshots")
        .select("user_id,snapshot_date,total_value,cash,account")
        .gte("snapshot_date", prevStart)
        .lt("snapshot_date", nextStart)
        .order("id")
        .range(from, to),
    ),
    pageAll<MetaRow>((from, to) =>
      db.from("account_meta")
        .select("user_id,account,type")
        .order("user_id")
        .order("account")
        .range(from, to),
    ),
  ]);

  // Every source is optional — a missing table (migration not run) soft-skips.
  const txnsByUser = groupByUser(txnRes.error ? [] : txnRes.rows);
  const hasLedger = !txnRes.error;
  const closedByUser = groupByUser(closedRes.error ? [] : closedRes.rows);
  const divsByUser = groupByUser(divRes.error ? [] : divRes.rows);
  const snapsByUser = groupByUser(snapRes.error ? [] : snapRes.rows);
  const metaByUser = groupByUser(metaRes.error ? [] : metaRes.rows);

  const users = new Set([
    ...baseUsers,
    ...txnsByUser.keys(),
    ...closedByUser.keys(),
    ...divsByUser.keys(),
  ]);

  const generatedOn = today;
  const nowISO = new Date().toISOString();

  for (const user_id of users) {
    try {
      const uHoldings = holdingsByUser.get(user_id) ?? [];
      const uCash = cashByUser.get(user_id) ?? [];
      const uTxnsAll = txnsByUser.get(user_id) ?? [];
      const uClosedAll = closedByUser.get(user_id) ?? [];
      const uDivsAll = divsByUser.get(user_id) ?? [];
      const uSnaps = snapsByUser.get(user_id) ?? [];
      const typeMap: Record<string, string> = {};
      for (const m of metaByUser.get(user_id) ?? []) typeMap[m.account] = m.type;
      const typeOf = (account: string): AccountType => resolveAccountType(account, typeMap);

      // In-month rows feed the reports; post-month-end rows are only used to
      // roll live holdings back to the month-end close.
      const uTxns = uTxnsAll.filter((r) => String(r.trade_date).slice(0, 7) === period);
      const uClosed = uClosedAll.filter((r) => etDate(r.closed_at).slice(0, 7) === period);
      const uDivs = uDivsAll.filter((r) => String(r.effective_date).slice(0, 7) === period);
      const postTxns = uTxnsAll.filter((r) => String(r.trade_date).slice(0, 10) >= nextStart);
      const postClosed = uClosedAll.filter((r) => etDate(r.closed_at) >= nextStart);
      const postDivs = uDivsAll.filter((r) => String(r.effective_date).slice(0, 10) >= nextStart);
      const meHoldings = monthEndHoldings(uHoldings, postTxns, postClosed, postDivs);

      const allEvents = mergeEvents(uTxns, uClosed, uDivs, period);

      const accounts = new Set<string>();
      for (const h of uHoldings) accounts.add(norm(h.account));
      for (const h of meHoldings) accounts.add(norm(h.account));
      for (const c of uCash) accounts.add(norm(c.account));
      for (const e of allEvents) accounts.add(e.account);
      if (accounts.size === 0) continue;
      // norm() reserves the sentinel, and the Set dedupes regardless — two rows
      // with the same conflict key would abort the whole upsert batch.
      const scopes = [...new Set([...accounts, ALL_ACCOUNTS])];

      const seriesCache = new Map<string, SnapPoint[]>();
      const seriesFor = (scope: string): SnapPoint[] => {
        let s = seriesCache.get(scope);
        if (!s) { s = snapshotSeries(uSnaps, scope); seriesCache.set(scope, s); }
        return s;
      };

      // Phase 1 — cash_flow + tax need no market data. Commit them BEFORE the
      // expensive quote/sector fetches so a timeout mid-run still lands them.
      const cheapRows: ReportRowInsert[] = [];
      for (const scope of scopes) {
        const isAll = scope === ALL_ACCOUNTS;
        const accountType: AccountType | "all" = isAll ? "all" : typeOf(scope);
        const scopedEvents = isAll ? allEvents : allEvents.filter((e) => e.account === scope);
        const scopedClosed = isAll ? uClosed : uClosed.filter((r) => norm(r.account) === scope);
        const scopedDivs = isAll ? uDivs : uDivs.filter((r) => norm(r.account) === scope);

        if (force || refreshWindow || !existing.has(tupleKey(user_id, scope, "cash_flow"))) {
          cheapRows.push({
            user_id, account: scope, period, report_type: "cash_flow",
            payload: buildCashFlow(period, scope, accountType, generatedOn, scopedEvents, seriesFor(scope), hasLedger),
            generated_at: nowISO,
          });
        }
        if (force || refreshWindow || !existing.has(tupleKey(user_id, scope, "tax"))) {
          cheapRows.push({
            user_id, account: scope, period, report_type: "tax",
            payload: buildTax(period, scope, generatedOn, scopedClosed, scopedDivs, scopedEvents),
            generated_at: nowISO,
          });
        }
      }
      const cheap = await upsertReportRows(db, cheapRows);

      // Phase 2 — portfolio needs quotes + sectors (fetched once per user).
      const portfolioScopes = scopes.filter(
        (a) => force || !existing.has(tupleKey(user_id, a, "portfolio")),
      );
      let portfolio = { written: 0, failed: 0 };
      if (portfolioScopes.length > 0) {
        let quotes: Record<string, { price: number }> = {};
        let sectors: Record<string, string> = {};
        if (meHoldings.length > 0) {
          const tickers = [...new Set(meHoldings.map((h) => h.ticker.toUpperCase()))];
          quotes = { ...(liveQuotes ?? {}) };
          const missing = tickers.filter((t) => !(t in quotes));
          for (let i = 0; i < missing.length; i += 30) {
            Object.assign(quotes, await fetchQuotes(missing.slice(i, i + 30)));
          }
          try {
            sectors = await fetchSectors(tickers, MAX_SECTOR_TICKERS);
          } catch {
            sectors = {}; // non-fatal — positions fall back to "Other"
          }
        }

        const portfolioRows: ReportRowInsert[] = [];
        for (const scope of portfolioScopes) {
          const isAll = scope === ALL_ACCOUNTS;
          const accountType: AccountType | "all" = isAll ? "all" : typeOf(scope);
          const scopedHoldings = isAll ? meHoldings : meHoldings.filter((h) => norm(h.account) === scope);
          // Junk guard (mirrors the snapshot cron): holdings but ZERO live
          // quotes means a market-data outage — don't freeze a cost-basis-only
          // portfolio forever; the missing-check retries next market day.
          const unpriced =
            scopedHoldings.length > 0 &&
            !scopedHoldings.some((h) => quotes[h.ticker.toUpperCase()]);
          if (unpriced && !force) continue;
          const cashTotal = (isAll ? uCash : uCash.filter((c) => norm(c.account) === scope))
            .reduce((s, c) => s + (Number(c.balance) || 0), 0);
          portfolioRows.push({
            user_id, account: scope, period, report_type: "portfolio",
            payload: buildPortfolio(
              period, scope, accountType, generatedOn,
              scopedHoldings, cashTotal, quotes, sectors, seriesFor(scope), typeOf,
            ),
            generated_at: nowISO,
          });
        }
        portfolio = await upsertReportRows(db, portfolioRows);
      }

      const written = cheap.written + portfolio.written;
      summary.written += written;
      summary.failed += cheap.failed + portfolio.failed;
      if (written > 0) summary.users += 1;
    } catch {
      summary.failed += 1;
      continue; // per-user isolation — one bad user never aborts the run
    }
  }

  return summary;
}
