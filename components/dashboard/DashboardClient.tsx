"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import nextDynamic from "next/dynamic";
import { formatCurrency, formatPercent } from "@/lib/format";
import type { PerfPoint, PerfMetric, ReturnPoint, AllocationPoint } from "@/components/dashboard/charts";
import { isInvestedType, resolveAccountType, type AccountType } from "@/lib/account-types";

const chartLoading = () => (
  <div className="skeleton h-full w-full rounded-sm" aria-hidden />
);

const PerformanceChart = nextDynamic(
  () => import("@/components/dashboard/charts").then((m) => m.PerformanceChart),
  { ssr: false, loading: chartLoading }
);
const AllocationDonut = nextDynamic(
  () => import("@/components/dashboard/charts").then((m) => m.AllocationDonut),
  { ssr: false, loading: chartLoading }
);
const ReturnsBarChart = nextDynamic(
  () => import("@/components/dashboard/charts").then((m) => m.ReturnsBarChart),
  { ssr: false, loading: chartLoading }
);
const ReturnsBarChartExpanded = nextDynamic(
  () => import("@/components/dashboard/charts").then((m) => m.ReturnsBarChartExpanded),
  { ssr: false, loading: chartLoading }
);

/* Performance-chart timeframes (clip + rebase the series). */
const TIMEFRAMES = ["1M", "3M", "6M", "YTD", "1Y", "ALL"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

/* Steel ramp for allocation slices, largest → smallest */
const STEEL_RAMP = [
  "oklch(0.74 0.08 240)",
  "oklch(0.63 0.07 240)",
  "oklch(0.52 0.06 240)",
  "oklch(0.42 0.05 240)",
  "oklch(0.34 0.02 240)",
];

/* Generate an N-step graphite→steel ramp for the full (expanded) allocation. */
function steelRamp(n: number): string[] {
  if (n <= 1) return [STEEL_RAMP[0]];
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const l = 0.74 - t * (0.74 - 0.32);
    const c = 0.08 - t * (0.08 - 0.02);
    return `oklch(${l.toFixed(3)} ${c.toFixed(3)} 240)`;
  });
}

interface DBHolding {
  id: string;
  ticker: string;
  name: string;
  shares: number;
  cost_basis: number;
  account: string;
}

interface QuoteData {
  price: number;
  changePct: number;
}

interface Snapshot {
  date: string;
  value: number;
  /* Cash balance captured for this account on this day (0 for legacy/pre-cash rows). */
  cash?: number;
  /* null = legacy combined row (pre per-account split); otherwise the account name. */
  account: string | null;
}



const BENCH_RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y"] as const;
type BenchRange = (typeof BENCH_RANGES)[number];

interface AggHolding {
  ticker: string;
  name: string;
  sector: string;
  shares: number;
  cost: number;
  value: number;
  gain: number;
  gainPct: number;
}

type ViewState = "loading" | "empty" | "error" | "ready";

export function DashboardClient() {
  const [view, setView] = useState<ViewState>("loading");
  const [holdings, setHoldings] = useState<DBHolding[]>([]);
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});
  const [sectors, setSectors] = useState<Record<string, string>>({});
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [accountTypes, setAccountTypes] = useState<Record<string, AccountType>>({});
  const [cashBalances, setCashBalances] = useState<Record<string, number>>({});
  const [benchmark, setBenchmark] = useState<Record<BenchRange, number | null> | null>(null);
  const [quotesError, setQuotesError] = useState(false);
  const [asOf, setAsOf] = useState<Date | null>(null);
  const [allocOpen, setAllocOpen] = useState(false);
  const [returnsOpen, setReturnsOpen] = useState<"monthly" | "yearly" | null>(null);

  // Performance-chart controls.
  const [metric, setMetric] = useState<PerfMetric>("value");
  const [timeframe, setTimeframe] = useState<Timeframe>("ALL");
  /* Accounts the user has explicitly turned OFF. Empty = "Combined" (all on).
     Storing the off-list (instead of an on-list) means newly added accounts
     auto-enroll into the combined view — they're simply not in the off-set. */
  const [excludedAccounts, setExcludedAccounts] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setView("loading");
    try {
      const hRes = await fetch("/api/holdings");
      if (!hRes.ok) throw new Error();
      const { holdings: rows }: { holdings: DBHolding[] } = await hRes.json();
      if (!rows || rows.length === 0) {
        setView("empty");
        return;
      }
      setHoldings(rows);

      const tickers = [...new Set(rows.map((h) => h.ticker))];
      setQuotesError(false);

      // Quotes + sectors in parallel; capture today's snapshot fire-and-forget
      const snapshotCapture = fetch("/api/snapshots", { method: "POST" }).catch(() => null);
      const [qRes, sRes, bRes, tRes, cRes] = await Promise.all([
        fetch(`/api/quotes?tickers=${tickers.join(",")}`).catch(() => null),
        fetch(`/api/sectors?tickers=${tickers.join(",")}`).catch(() => null),
        fetch("/api/benchmark").catch(() => null),
        fetch("/api/accounts/meta").catch(() => null),
        fetch("/api/cash").catch(() => null),
      ]);

      if (qRes?.ok) {
        const { quotes: q } = await qRes.json();
        setQuotes(q ?? {});
      } else {
        setQuotesError(true);
        setQuotes({});
      }
      if (sRes?.ok) {
        const { sectors: s } = await sRes.json();
        setSectors(s ?? {});
      }
      if (bRes?.ok) {
        const { returns } = await bRes.json();
        setBenchmark(returns ?? null);
      }
      if (tRes?.ok) {
        const { types } = await tRes.json();
        setAccountTypes(types ?? {});
      }
      if (cRes?.ok) {
        const { balances } = await cRes.json();
        const m: Record<string, number> = {};
        for (const b of balances ?? []) m[b.account] = Number(b.balance);
        setCashBalances(m);
      }

      // History after capture so today's point is included
      await snapshotCapture;
      const snapRes = await fetch("/api/snapshots").catch(() => null);
      if (snapRes?.ok) {
        const { snapshots: snaps } = await snapRes.json();
        setSnapshots(snaps ?? []);
      }

      setAsOf(new Date());
      setView("ready");
    } catch {
      setView("error");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /* All accounts present in holdings or cash balances, sorted for stable order. */
  const accountList = useMemo(() => {
    const set = new Set<string>();
    for (const h of holdings) {
      const a = (h.account ?? "").trim();
      if (a) set.add(a);
    }
    for (const a of Object.keys(cashBalances)) {
      if (a.trim()) set.add(a);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [holdings, cashBalances]);

  /* Enabled = every known account minus the user's explicit off-list. */
  const enabledAccounts = useMemo(() => {
    return new Set(accountList.filter((a) => !excludedAccounts.has(a)));
  }, [accountList, excludedAccounts]);

  const allAccountsOn = excludedAccounts.size === 0;

  const toggleAccount = useCallback((acct: string) => {
    setExcludedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(acct)) next.delete(acct);
      else next.add(acct);
      return next;
    });
  }, []);

  const resetAccountSelection = useCallback(() => setExcludedAccounts(new Set()), []);

  /* ─── Aggregations (all derived from live rows + quotes) ─── */
  const agg = useMemo(() => {
    const isCashAcct = (account: string) => !isInvestedType(resolveAccountType(account, accountTypes));
    const filtered = holdings.filter((h) => enabledAccounts.has(h.account));
    const investRows = filtered.filter((h) => !isCashAcct(h.account));
    const cashRows = filtered.filter((h) => isCashAcct(h.account));

    const byTicker = new Map<string, AggHolding>();
    for (const h of investRows) {
      const q = quotes[h.ticker];
      const price = q?.price ?? Number(h.cost_basis);
      const cur = byTicker.get(h.ticker);
      const shares = Number(h.shares);
      const cost = shares * Number(h.cost_basis);
      const value = shares * price;
      if (cur) {
        cur.shares += shares;
        cur.cost += cost;
        cur.value += value;
      } else {
        byTicker.set(h.ticker, {
          ticker: h.ticker,
          name: h.name,
          sector: sectors[h.ticker] || "Other",
          shares,
          cost,
          value,
          gain: 0,
          gainPct: 0,
        });
      }
    }
    const positions = [...byTicker.values()].map((p) => {
      p.sector = sectors[p.ticker] || "Other";
      p.gain = p.value - p.cost;
      p.gainPct = p.cost > 0 ? (p.gain / p.cost) * 100 : 0;
      return p;
    }).sort((a, b) => b.value - a.value);

    // Cash = legacy cash-typed holdings (rare) + real cash balances from the
    // cash_balances table, both honoring the account toggle.
    const cashFromHoldings = cashRows.reduce((s, h) => {
      const q = quotes[h.ticker];
      return s + Number(h.shares) * (q?.price ?? (Number(h.cost_basis) || 1));
    }, 0);
    const cashFromBalances = Object.entries(cashBalances).reduce(
      (s, [acct, bal]) => (enabledAccounts.has(acct) ? s + bal : s),
      0,
    );
    const cash = cashFromHoldings + cashFromBalances;

    const invested = positions.reduce((s, p) => s + p.cost, 0);
    const positionsValue = positions.reduce((s, p) => s + p.value, 0);
    const totalValue = positionsValue + cash;
    const totalGain = positionsValue - invested;
    const totalReturnPct = invested > 0 ? (totalGain / invested) * 100 : 0;

    const todayChange = positions.reduce((s, p) => {
      const pct = (quotes[p.ticker]?.changePct ?? 0) / 100;
      return s + (p.value / (1 + pct)) * pct;
    }, 0);
    const todayPct =
      positionsValue - todayChange > 0
        ? (todayChange / (positionsValue - todayChange)) * 100
        : 0;

    return { positions, cash, invested, positionsValue, totalValue, totalGain, totalReturnPct, todayChange, todayPct };
  }, [holdings, quotes, sectors, enabledAccounts, accountTypes, cashBalances]);

  /* Allocation by sector — top 4 + Other, steel ramp */
  const allocation: AllocationPoint[] = useMemo(() => {
    const bySector = new Map<string, number>();
    for (const p of agg.positions) {
      bySector.set(p.sector, (bySector.get(p.sector) ?? 0) + p.value);
    }
    if (agg.cash > 0) bySector.set("Cash", (bySector.get("Cash") ?? 0) + agg.cash);
    const sorted = [...bySector.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 4);
    const rest = sorted.slice(4).reduce((s, [, v]) => s + v, 0);
    const slices = [...top, ...(rest > 0 ? [["Other", rest] as [string, number]] : [])];
    return slices.map(([label, value], i) => ({
      label,
      value,
      color: STEEL_RAMP[Math.min(i, STEEL_RAMP.length - 1)],
    }));
  }, [agg]);

  /* Full allocation — every sector (+ cash), for the expanded view */
  const fullAllocation: AllocationPoint[] = useMemo(() => {
    const bySector = new Map<string, number>();
    for (const p of agg.positions) {
      bySector.set(p.sector, (bySector.get(p.sector) ?? 0) + p.value);
    }
    if (agg.cash > 0) bySector.set("Cash", (bySector.get("Cash") ?? 0) + agg.cash);
    const sorted = [...bySector.entries()].sort((a, b) => b[1] - a[1]);
    const ramp = steelRamp(sorted.length);
    return sorted.map(([label, value], i) => ({ label, value, color: ramp[i] }));
  }, [agg]);

  /* Source series for all history panels: collapse per-account snapshots into
     one daily total honoring the account toggle.
       • Per-account rows (account != null): summed if that account is enabled.
       • Legacy rows (account == null): a pre-split combined total. Used ONLY as
         a fallback for dates that have NO per-account rows — otherwise a day
         with both a legacy total AND per-account rows would be double-counted
         (this was the "+100% on the latest day" bug: Jun 19 had both a null
         and a "t" row, summing to 2× the real value).
     The same filtered series feeds the performance chart AND the monthly /
     yearly bars, so toggles propagate everywhere. */
  const series = useMemo(() => {
    type Acc = { value: number; cash: number };
    // Pass 1: sum enabled per-account rows per date (securities value + cash).
    const perAccount = new Map<string, Acc>();
    const legacy = new Map<string, Acc>();
    for (const s of snapshots) {
      const cash = s.cash ?? 0;
      if (s.account === null) {
        legacy.set(s.date, { value: s.value, cash }); // last write wins; one combined total/day
      } else if (enabledAccounts.has(s.account)) {
        const cur = perAccount.get(s.date) ?? { value: 0, cash: 0 };
        perAccount.set(s.date, { value: cur.value + s.value, cash: cur.cash + cash });
      }
    }
    // Pass 2: per-account total wins for a date; fall back to the legacy
    // combined row only when that date has no per-account rows AND all
    // accounts are enabled (a legacy total can't be filtered by account).
    const byDate = new Map<string, Acc>(perAccount);
    if (allAccountsOn) {
      for (const [date, acc] of legacy) {
        if (!byDate.has(date)) byDate.set(date, acc);
      }
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, acc]) => ({ date, value: acc.value, cash: acc.cash }));
  }, [snapshots, enabledAccounts, allAccountsOn]);

  /* Performance chart: clip the series to the selected timeframe, then plot
     GAIN VS COST BASIS at each point — (value − costBasis) / costBasis.

     This makes the chart's headline return match the Accounts tab exactly
     (both are "how far is the portfolio above what I paid"), instead of the
     old "return since the first snapshot," which only saw the tracked window
     and disagreed with the Accounts number. Robust to contributions: adding a
     position raises value AND cost basis together, so the ratio doesn't jump.

     costBasis = current total cost of enabled holdings (agg.invested). It's
     held flat across the window — an approximation if you've traded mid-window,
     but exact when holdings are stable, and it's what reconciles the two
     numbers the user looks at. */
  const perf = useMemo(() => {
    const start = (() => {
      if (timeframe === "ALL") return null;
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      if (timeframe === "1M") d.setMonth(d.getMonth() - 1);
      else if (timeframe === "3M") d.setMonth(d.getMonth() - 3);
      else if (timeframe === "6M") d.setMonth(d.getMonth() - 6);
      else if (timeframe === "YTD") d.setMonth(0, 1);
      else if (timeframe === "1Y") d.setFullYear(d.getFullYear() - 1);
      return d;
    })();
    const clipped = start
      ? series.filter((s) => new Date(`${s.date}T00:00:00`) >= start)
      : series;

    const costBasis = agg.invested;
    const points: PerfPoint[] = clipped.map((s) => {
      // Return % is a pure securities figure (gain vs cost basis) — cash isn't a
      // gain. The Value line plots the true total: securities + cash.
      const gain = s.value - costBasis;
      const returnPct = costBasis > 0 ? (gain / costBasis) * 100 : 0;
      const totalValue = s.value + s.cash;
      return {
        label: new Date(`${s.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        date: new Date(`${s.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        metric: metric === "value" ? totalValue : returnPct,
        total: totalValue,
        securities: s.value,
        cash: s.cash,
        gain,
        returnPct,
      };
    });
    const last = points[points.length - 1];
    return {
      points,
      gain: last?.gain ?? 0,
      returnPct: last?.returnPct ?? 0,
      endValue: last?.total ?? 0,
      since: clipped.length
        ? new Date(`${clipped[0].date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : null,
    };
  }, [series, timeframe, metric, agg.invested]);

  /* History derivations — period-over-period returns from snapshots. */
  const history = useMemo(() => {
    const byPeriod = (keyFn: (d: string) => string) => {
      const m = new Map<string, { firstVal: number; lastVal: number }>();
      for (const s of series) {
        const k = keyFn(s.date);
        const cur = m.get(k);
        if (!cur) m.set(k, { firstVal: s.value, lastVal: s.value });
        else { cur.lastVal = s.value; }
      }
      return [...m.entries()];
    };

    type Period = [string, { firstVal: number; lastVal: number }];
    const buildReturns = (periods: Period[], labelFn: (key: string) => string): ReturnPoint[] =>
      periods.map(([key, p], i) => {
        const baseVal = i > 0 ? periods[i - 1][1].lastVal : p.firstVal;
        const pnl = p.lastVal - baseVal;
        return { label: labelFn(key), pct: baseVal > 0 ? (pnl / baseVal) * 100 : 0 };
      });

    const monthly = byPeriod((d) => d.slice(0, 7));
    const monthlyReturns = buildReturns(monthly, (key) =>
      new Date(`${key}-15T12:00:00`).toLocaleDateString("en-US", { month: "short" }));

    const yearly = byPeriod((d) => d.slice(0, 4));
    const yearlyReturns = buildReturns(yearly, (key) => key);

    const bestMonths = buildReturns(monthly, (key) =>
      new Date(`${key}-15T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" }))
      .sort((a, b) => b.pct - a.pct);

    const since = series.length
      ? new Date(`${series[0].date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : null;

    return { monthlyReturns, yearlyReturns, bestMonths, since };
  }, [series]);

  /* Portfolio return per timeframe, vs market. 1D is live (today's quotes);
     longer ranges need a snapshot at/before the period start — null until
     history reaches back that far. */
  const vsMarket = useMemo(() => {
    const startDate = (range: BenchRange): Date => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      if (range === "5D") d.setDate(d.getDate() - 7);
      else if (range === "1M") d.setMonth(d.getMonth() - 1);
      else if (range === "6M") d.setMonth(d.getMonth() - 6);
      else if (range === "YTD") { d.setMonth(0, 1); }
      else if (range === "1Y") d.setFullYear(d.getFullYear() - 1);
      return d;
    };

    const portfolioReturn = (range: BenchRange): number | null => {
      if (range === "1D") return agg.todayPct;
      const target = startDate(range);
      let base: { date: string; value: number } | null = null;
      for (const s of series) {
        if (new Date(`${s.date}T00:00:00`) <= target) base = s;
        else break;
      }
      if (!base || base.value <= 0) return null;
      return ((agg.totalValue - base.value) / base.value) * 100;
    };

    return BENCH_RANGES.map((range) => ({
      range,
      portfolio: portfolioReturn(range),
      market: benchmark?.[range] ?? null,
    }));
  }, [agg.todayPct, agg.totalValue, series, benchmark]);

  /* ─── States ─── */
  if (view === "loading") {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-[1400px] flex flex-col gap-5">
          <div className="skeleton rounded-md" style={{ height: 280 }} />
          <div className="skeleton rounded-md" style={{ height: 48 }} />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton rounded-md" style={{ height: 220 }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (view === "empty") {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-md text-center flex flex-col gap-3">
          <p className="text-base text-foreground">No holdings yet</p>
          <p className="text-sm text-muted-foreground">
            The dashboard builds itself from your real positions. Upload a Fidelity
            positions CSV in Accounts to get started.
          </p>
          <Link
            href="/accounts"
            className="self-center text-sm px-4 py-2 rounded-sm mt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            Go to Accounts
          </Link>
        </div>
      </div>
    );
  }

  if (view === "error") {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-md text-center flex flex-col gap-3">
          <p className="text-sm text-foreground">Couldn&apos;t load your portfolio</p>
          <button
            onClick={load}
            className="self-center text-xs px-3 py-1.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const hasHistory = perf.points.length >= 2;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-[1400px] flex flex-col gap-5">
        {/* Header: title + live status */}
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-lg font-medium tracking-[-0.01em] text-foreground">Dashboard</h1>
          <div className="flex items-center gap-3">
            {quotesError ? (
              <span className="text-xs" style={{ color: "var(--negative)" }}>
                Live prices unavailable — showing cost basis
              </span>
            ) : (
              asOf && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: "var(--positive)" }}
                    aria-hidden
                  />
                  Live · as of {asOf.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )
            )}
            <button
              onClick={load}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Hero: the one answer + performance */}
        <section className="rounded-md border border-border bg-card p-5">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,300px)_1fr]">
            <div className="flex flex-col justify-center gap-2 lg:border-r lg:border-border lg:pr-6">
              {/* Supporting metrics above the total */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-1">
                <Metric
                  label="Overall Return"
                  value={formatPercent(agg.totalReturnPct)}
                  tone={agg.totalReturnPct >= 0 ? "pos" : "neg"}
                />
                <Metric
                  label="Total Gain"
                  value={formatCurrency(agg.totalGain)}
                  tone={agg.totalGain >= 0 ? "pos" : "neg"}
                />
                <Metric label="Invested" value={formatCurrency(agg.invested)} muted />
                <Metric label="Positions" value={String(agg.positions.length)} muted />
              </div>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Total Portfolio Value
              </span>
              <span className="font-mono text-[2.75rem] leading-none text-foreground">
                {formatCurrency(agg.totalValue)}
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-xs text-muted-foreground">Today</span>
                <span
                  className="font-mono text-sm"
                  style={toneStyle(agg.todayChange >= 0 ? "pos" : "neg")}
                >
                  {formatCurrency(agg.todayChange)}
                </span>
                <span
                  className="font-mono text-xs"
                  style={toneStyle(agg.todayPct >= 0 ? "pos" : "neg")}
                >
                  {formatPercent(agg.todayPct)}
                </span>
              </div>
            </div>
            <div className="flex flex-col">
              {/* Chart header: title + window readout, then controls */}
              <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 mb-1">
                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Performance Over Time
                  </span>
                  {hasHistory && (
                    <div className="flex items-baseline gap-2">
                      <span
                        className="font-mono text-lg leading-none"
                        style={toneStyle(perf.gain >= 0 ? "pos" : "neg")}
                      >
                        {perf.gain >= 0 ? "+" : ""}{formatCurrency(perf.gain)}
                      </span>
                      <span
                        className="font-mono text-xs"
                        style={toneStyle(perf.returnPct >= 0 ? "pos" : "neg")}
                      >
                        {formatPercent(perf.returnPct)}
                      </span>
                      <span className="text-xs text-muted-foreground">vs cost basis</span>
                    </div>
                  )}
                </div>
                <Segmented
                  options={[
                    { value: "value", label: "Value $" },
                    { value: "return", label: "Return %" },
                  ]}
                  value={metric}
                  onChange={(v) => setMetric(v as PerfMetric)}
                />
              </div>

              {hasHistory ? (
                <div className="h-[220px]">
                  <PerformanceChart data={perf.points} metric={metric} />
                </div>
              ) : (
                <HistoryPlaceholder since={perf.since ?? history.since} height={220} />
              )}

              {/* Controls: timeframe + per-account toggle */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
                <Segmented
                  options={TIMEFRAMES.map((t) => ({ value: t, label: t }))}
                  value={timeframe}
                  onChange={(v) => setTimeframe(v as Timeframe)}
                />
                {accountList.length > 1 && (
                  <AccountToggles
                    accounts={accountList}
                    enabled={enabledAccounts}
                    allOn={allAccountsOn}
                    onToggle={toggleAccount}
                    onReset={resetAccountSelection}
                  />
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Supporting metrics — cash only (gain/return/invested/positions moved into hero) */}
        {agg.cash > 0 && (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-1">
            <Metric label="Cash" value={formatCurrency(agg.cash)} />
          </div>
        )}

        {/* Allocation + returns */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <button
            type="button"
            onClick={() => setAllocOpen(true)}
            aria-label="Expand full allocation breakdown"
            className="group rounded-md border border-border bg-card p-4 text-left transition-colors hover:border-[oklch(0.30_0_0)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Allocation by Sector</h2>
              <ExpandIcon />
            </div>
            <div className="flex items-center gap-4">
              <div className="h-[160px] w-[160px] shrink-0 pointer-events-none">
                <AllocationDonut data={allocation} />
              </div>
              <ul className="flex flex-col gap-2 text-sm min-w-0">
                {allocation.map((slice) => (
                  <li key={slice.label} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-sm shrink-0"
                      style={{ background: slice.color }}
                      aria-hidden
                    />
                    <span className="text-muted-foreground truncate">{slice.label}</span>
                    <span className="ml-auto font-mono text-foreground">
                      {agg.totalValue > 0 ? ((slice.value / agg.totalValue) * 100).toFixed(1) : "0.0"}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setReturnsOpen("monthly")}
            aria-label="Expand monthly returns"
            className="group rounded-md border border-border bg-card p-4 text-left transition-colors hover:border-[oklch(0.30_0_0)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Monthly Returns</h2>
              <ExpandIcon />
            </div>
            {history.monthlyReturns.length > 0 ? (
              <div className="h-[180px] pointer-events-none">
                <ReturnsBarChart data={history.monthlyReturns} />
              </div>
            ) : (
              <HistoryPlaceholder since={history.since} height={180} detail="Building once snapshots arrive." />
            )}
          </button>
          <button
            type="button"
            onClick={() => setReturnsOpen("yearly")}
            aria-label="Expand yearly returns"
            className="group rounded-md border border-border bg-card p-4 text-left transition-colors hover:border-[oklch(0.30_0_0)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Yearly Returns</h2>
              <ExpandIcon />
            </div>
            {history.yearlyReturns.length > 0 ? (
              <div className="h-[180px] pointer-events-none">
                <ReturnsBarChart data={history.yearlyReturns} />
              </div>
            ) : (
              <HistoryPlaceholder since={history.since} height={180} detail="Building once snapshots arrive." />
            )}
          </button>
        </div>

        {/* Best months + vs market + holdings */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="flex flex-col gap-4">
          <Panel title="Best Months">
            {history.bestMonths.length > 0 ? (
              <ol className="flex flex-col gap-2.5 max-h-[320px] overflow-y-auto pr-1">
                {history.bestMonths.map((m, i) => (
                  <li key={m.label} className="flex items-center gap-3 text-sm">
                    <span className="font-mono text-xs text-muted-foreground w-4 shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-foreground flex-1 min-w-0">{m.label}</span>
                    <span
                      className="font-mono shrink-0"
                      style={{ color: m.pct >= 0 ? "var(--positive)" : "var(--negative)" }}
                    >
                      {formatPercent(m.pct)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <HistoryPlaceholder since={history.since} height={160} detail="Ranks your strongest months once history accrues." />
            )}
          </Panel>

          <Panel title="vs Market (SPY)">
            <div className="flex items-center gap-3 pb-1.5 text-xs text-muted-foreground border-b border-border">
              <span className="w-9" aria-hidden />
              <span className="w-16 text-right">You</span>
              <span className="w-16 text-right">SPY</span>
              <span className="ml-auto w-16 text-right">+/−</span>
            </div>
            <ul className="flex flex-col">
              {vsMarket.map((row) => {
                const spread =
                  row.portfolio !== null && row.market !== null
                    ? row.portfolio - row.market
                    : null;
                return (
                  <li
                    key={row.range}
                    className="flex items-center gap-3 py-1.5 border-b border-border/60 last:border-0 text-sm"
                  >
                    <span className="font-mono text-xs text-muted-foreground w-9 shrink-0">
                      {row.range}
                    </span>
                    <PctCell value={row.portfolio} />
                    <PctCell value={row.market} muted />
                    <span
                      className="font-mono text-xs ml-auto shrink-0 w-16 text-right"
                      style={
                        spread === null
                          ? { color: "var(--muted-foreground)" }
                          : { color: spread >= 0 ? "var(--positive)" : "var(--negative)" }
                      }
                      title={spread === null ? "Needs portfolio history for this range" : "Portfolio minus SPY"}
                    >
                      {spread === null ? "—" : `${spread >= 0 ? "+" : ""}${spread.toFixed(2)}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
          </div>
          <div className="lg:col-span-2">
            <Panel title="Top Holdings">
              <HoldingsTable positions={agg.positions} totalValue={agg.totalValue} />
            </Panel>
          </div>
        </div>
      </div>

      <AllocationModal
        open={allocOpen}
        onClose={() => setAllocOpen(false)}
        data={fullAllocation}
        totalValue={agg.totalValue}
      />

      <ReturnsModal
        open={returnsOpen}
        onClose={() => setReturnsOpen(null)}
        monthlyData={history.monthlyReturns}
        yearlyData={history.yearlyReturns}
      />
    </div>
  );
}

/* ─── Expand affordance icon ─── */
function ExpandIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-muted-foreground transition-colors group-hover:text-foreground"
      aria-hidden
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

/* ─── Expanded allocation modal (full coverage, every sector) ─── */
function AllocationModal({
  open,
  onClose,
  data,
  totalValue,
}: {
  open: boolean;
  onClose: () => void;
  data: AllocationPoint[];
  totalValue: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // backdrop click
      }}
      className="app-dialog m-auto w-[min(92vw,640px)] rounded-md border border-border bg-popover p-0 text-foreground"
    >
      <div className="flex flex-col gap-5 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium text-foreground">Allocation by Sector</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-6">
          <div className="h-[260px] w-[260px] shrink-0">
            <AllocationDonut data={data} />
          </div>
          <ul className="grid w-full grid-cols-1 gap-x-6 gap-y-2 text-sm sm:max-h-[260px] sm:grid-cols-2 sm:overflow-y-auto sm:pr-1">
            {data.map((slice) => (
              <li key={slice.label} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: slice.color }} aria-hidden />
                <span className="min-w-0 truncate text-muted-foreground">{slice.label}</span>
                <span className="ml-auto shrink-0 font-mono text-foreground">
                  {totalValue > 0 ? ((slice.value / totalValue) * 100).toFixed(1) : "0.0"}%
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">
          {data.length} {data.length === 1 ? "sector" : "sectors"} · {formatCurrency(totalValue)} total
        </p>
      </div>
    </dialog>
  );
}

/* ─── History placeholder (honest empty state) ─── */
function HistoryPlaceholder({
  since,
  height,
  detail,
}: {
  since: string | null;
  height: number;
  detail?: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1.5 rounded-sm border border-dashed"
      style={{ height, borderColor: "var(--border)" }}
    >
      <p className="text-xs text-muted-foreground">
        {since ? `Tracking since ${since}` : "History starts today"}
      </p>
      <p className="text-xs text-muted-foreground/70 px-6 text-center">
        {detail ?? "Builds from daily snapshots as you use Fintrack."}
      </p>
    </div>
  );
}

/* ─── % cell for the vs-market rows ─── */
function PctCell({ value, muted }: { value: number | null; muted?: boolean }) {
  if (value === null) {
    return (
      <span className="font-mono text-xs w-16 text-right shrink-0" style={{ color: "var(--muted-foreground)" }}>
        —
      </span>
    );
  }
  const color = muted
    ? "var(--muted-foreground)"
    : value >= 0
    ? "var(--positive)"
    : "var(--negative)";
  return (
    <span className="font-mono text-xs w-16 text-right shrink-0" style={{ color }}>
      {formatPercent(value)}
    </span>
  );
}

/* ─── Supporting metric ─── */
function Metric({
  label,
  value,
  tone,
  muted,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground leading-none">
        {label}
      </span>
      <span className="font-mono text-base leading-none" style={toneStyle(tone, muted)}>
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="hidden sm:block w-px h-8 bg-border shrink-0" aria-hidden />;
}

function toneStyle(tone?: "pos" | "neg", muted = false) {
  if (tone === "pos") return { color: "var(--positive)" };
  if (tone === "neg") return { color: "var(--negative)" };
  return muted ? { color: "var(--muted-foreground)" } : {};
}

/* ─── Segmented control (timeframe / metric toggles) ─── */
function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-sm border border-border bg-[oklch(0.10_0_0)] p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className="rounded-[3px] px-2.5 py-1 text-xs font-mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            style={
              active
                ? { background: "oklch(0.20 0.02 74)", color: "var(--primary)" }
                : { color: "var(--muted-foreground)" }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}


/* ─── Account toggles ─── Combined chip + one chip per account.
   "Combined" highlights when every account is on; clicking it resets the
   selection (and re-enrolls accounts added later). Each account chip toggles
   individually; the chart + monthly/yearly bars re-derive from the selection. */
function AccountToggles({
  accounts,
  enabled,
  allOn,
  onToggle,
  onReset,
}: {
  accounts: string[];
  enabled: Set<string>;
  allOn: boolean;
  onToggle: (acct: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={onReset}
        aria-pressed={allOn}
        className="rounded-sm px-2.5 py-1 text-xs font-mono transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        style={
          allOn
            ? { background: "oklch(0.20 0.02 74)", color: "var(--primary)", borderColor: "oklch(0.30 0.04 74)" }
            : { background: "transparent", color: "var(--muted-foreground)", borderColor: "var(--border)" }
        }
        title="Show combined total across every account"
      >
        Combined
      </button>
      {accounts.map((acct) => {
        const on = enabled.has(acct);
        return (
          <button
            key={acct}
            type="button"
            onClick={() => onToggle(acct)}
            aria-pressed={on}
            className="rounded-sm px-2.5 py-1 text-xs font-mono transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            style={
              on
                ? { background: "oklch(0.20 0.02 74)", color: "var(--primary)", borderColor: "oklch(0.30 0.04 74)" }
                : { background: "transparent", color: "var(--muted-foreground)", borderColor: "var(--border)", textDecoration: "line-through" }
            }
          >
            {acct}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Expanded returns modal (Monthly or Yearly) ─── */
function ReturnsModal({
  open,
  onClose,
  monthlyData,
  yearlyData,
}: {
  open: "monthly" | "yearly" | null;
  onClose: () => void;
  monthlyData: { label: string; pct: number }[];
  yearlyData: { label: string; pct: number }[];
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  const data = open === "monthly" ? monthlyData : yearlyData;
  const title = open === "monthly" ? "Monthly Returns" : "Yearly Returns";

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="app-dialog m-auto w-[min(92vw,720px)] rounded-md border border-border bg-popover p-0 text-foreground"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {data.length > 0 ? (
          <div className="h-[360px]">
            <ReturnsBarChartExpanded data={data} />
          </div>
        ) : (
          <div
            className="flex items-center justify-center rounded-sm border border-dashed"
            style={{ height: 200, borderColor: "var(--border)" }}
          >
            <p className="text-xs text-muted-foreground">No data yet</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Hover over bars to see the % change.
        </p>
      </div>
    </dialog>
  );
}

/* ─── Panel shell ─── */
function Panel({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-md border border-border bg-card p-4 ${className}`}>
      <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

/* ─── Top holdings table (live, aggregated across accounts) ─── */
function HoldingsTable({
  positions,
  totalValue,
}: {
  positions: AggHolding[];
  totalValue: number;
}) {
  const top = positions.slice(0, 8);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
            <Th className="text-left">Name</Th>
            <Th className="text-left">Sector</Th>
            <Th>Quantity</Th>
            <Th>Value</Th>
            <Th>Gain / Loss</Th>
            <Th>Allocation</Th>
          </tr>
        </thead>
        <tbody>
          {top.map((h) => {
            const alloc = totalValue > 0 ? (h.value / totalValue) * 100 : 0;
            const pos = h.gain >= 0;
            return (
              <tr key={h.ticker} className="border-b border-border/60 last:border-0">
                <td className="py-2.5 pr-3">
                  <span className="text-foreground">{h.name}</span>{" "}
                  <span className="text-muted-foreground font-mono text-xs">{h.ticker}</span>
                </td>
                <td className="py-2.5 pr-3 text-muted-foreground">
                  {h.sector === "Other" ? "—" : h.sector}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-foreground">{h.shares}</td>
                <td className="py-2.5 px-3 text-right font-mono text-foreground">
                  {formatCurrency(h.value)}
                </td>
                <td
                  className="py-2.5 px-3 text-right font-mono"
                  style={{ color: pos ? "var(--positive)" : "var(--negative)" }}
                >
                  {formatCurrency(h.gain)}{" "}
                  <span className="text-xs">({formatPercent(h.gainPct)})</span>
                </td>
                <td className="py-2.5 pl-3 text-right font-mono text-muted-foreground">
                  {alloc.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {positions.length > 8 && (
        <p className="text-xs text-muted-foreground mt-2">
          Showing top 8 of {positions.length} —{" "}
          <Link href="/accounts" className="rounded-sm hover:text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
            see all in Accounts
          </Link>
        </p>
      )}
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`py-2 px-3 font-medium text-right first:pl-0 last:pr-0 ${className}`}>
      {children}
    </th>
  );
}
