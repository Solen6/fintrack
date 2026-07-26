"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCurrency, formatPercent } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";
import { DIM, gainColor, Section, Stat, StatGrid } from "@/components/portfolio/report-ui";
import type { AnnualSummary } from "@/lib/annual-summary";

/* Year-in-Review card. Reads /api/reports/annual (computed on demand from the
   snapshot history) for the selected account scope + year. Sharpe/alpha/beta
   here rest on a full year of daily returns, which is why they live on the
   yearly view rather than the monthly one. */

interface AnnualResponse {
  account: string;
  year: string | null;
  years: string[];
  summary: AnnualSummary | null;
  error?: string;
}

const num = (v: number | null, dp = 2, suffix = "") => (v == null ? "—" : `${v.toFixed(dp)}${suffix}`);
const shortMonth = (period: string) =>
  new Date(`${period}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" });

export function AnnualReview({ account }: { account: string }) {
  const [data, setData] = useState<AnnualResponse | null>(null);
  const [year, setYear] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  const load = useCallback(
    (y?: string | null) => {
      const req = ++reqRef.current;
      setLoading(true);
      setError(null);
      const q = new URLSearchParams({ account });
      if (y) q.set("year", y);
      fetch(`/api/reports/annual?${q.toString()}`)
        .then((r) => r.json())
        .then((d: AnnualResponse) => {
          if (reqRef.current !== req) return;
          if (d.error) throw new Error(d.error);
          setData(d);
          setYear(d.year);
        })
        .catch((e: Error) => reqRef.current === req && setError(e.message || "Failed to load"))
        .finally(() => reqRef.current === req && setLoading(false));
    },
    [account],
  );

  // Reload on account change (fresh scope → default year).
  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="rounded-md border border-border bg-card p-4">
        <div className="h-40 animate-pulse rounded-sm" style={{ background: "oklch(0.14 0 0)" }} />
      </div>
    );
  }
  if (error) {
    return <p className="text-sm" style={{ color: "var(--negative)" }}>{error}</p>;
  }
  if (!data || data.years.length === 0 || !data.summary) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-16">
        <p className="text-sm text-muted-foreground">No yearly data yet.</p>
        <p className="text-xs" style={{ color: DIM }}>
          A year-in-review appears once the account has snapshot history for that year.
        </p>
      </div>
    );
  }

  const s = data.summary;
  const risk = s.risk;
  const hasRiskMetrics =
    !!risk && (risk.sharpe != null || risk.beta != null || risk.alpha != null || risk.volatility != null);

  return (
    <div className="flex flex-col gap-4">
      {/* Year selector */}
      <div className="flex items-center gap-3">
        <select
          value={year ?? ""}
          onChange={(e) => load(e.target.value)}
          aria-label="Report year"
          className="text-xs rounded border border-border bg-background text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {data.years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        {Number(s.year) >= new Date().getFullYear() && (
          <span className="text-xs" style={{ color: DIM }}>Year to date</span>
        )}
      </div>

      {/* Performance */}
      <Section title="Performance">
        <StatGrid cols={4}>
          <Stat
            label="Annual return"
            value={s.yearReturnPct != null ? formatPercent(s.yearReturnPct) : "—"}
            color={s.yearReturnPct != null ? gainColor(s.yearReturnPct) : undefined}
          />
          <Stat
            label="S&P 500 return"
            value={risk?.benchmarkReturn != null ? formatPercent(risk.benchmarkReturn) : "—"}
            color={risk?.benchmarkReturn != null ? gainColor(risk.benchmarkReturn) : undefined}
          />
          <Stat
            label="Best month"
            value={s.bestMonth ? `${shortMonth(s.bestMonth.period)} ${formatPercent(s.bestMonth.pct)}` : "—"}
            color={s.bestMonth ? gainColor(s.bestMonth.pct) : undefined}
          />
          <Stat
            label="Worst month"
            value={s.worstMonth ? `${shortMonth(s.worstMonth.period)} ${formatPercent(s.worstMonth.pct)}` : "—"}
            color={s.worstMonth ? gainColor(s.worstMonth.pct) : undefined}
          />
        </StatGrid>
        {s.monthlyReturns.length > 1 && <MonthlyBars data={s.monthlyReturns} />}
      </Section>

      {/* Risk & benchmark — this is where Sharpe lives */}
      <Section
        title="Risk & Benchmark"
        hint={hasRiskMetrics && risk ? `vs ${risk.benchmarkSymbol} · ${risk.observations} trading days` : undefined}
      >
        {hasRiskMetrics && risk ? (
          <>
            <StatGrid cols={4}>
              <Stat
                label="Sharpe (annualized)"
                value={num(risk.sharpe)}
                color={risk.sharpe != null ? gainColor(risk.sharpe) : undefined}
              />
              <Stat
                label="Beta"
                value={num(risk.beta)}
                color={risk.beta != null && risk.beta > 1 ? "var(--negative)" : undefined}
              />
              <Stat
                label="Alpha (annual)"
                value={risk.alpha != null ? formatPercent(risk.alpha) : "—"}
                color={risk.alpha != null ? gainColor(risk.alpha) : undefined}
              />
              <Stat label="Volatility (ann.)" value={num(risk.volatility, 2, "%")} />
            </StatGrid>
            <p className="text-xs" style={{ color: DIM }}>
              Computed from this year&apos;s daily unit-method returns vs {risk.benchmarkSymbol}. Sharpe is
              annualized using the year&apos;s average 3-month Treasury yield
              {risk.riskFreeRate != null ? ` (${risk.riskFreeRate.toFixed(2)}%)` : ""} as the risk-free rate;
              alpha is annual Jensen&apos;s alpha.
            </p>
          </>
        ) : (
          <p className="text-xs" style={{ color: DIM }}>
            Not enough daily snapshot history this year to compute risk metrics.
          </p>
        )}
      </Section>

      {/* Income & activity */}
      <Section title="Income & Activity">
        <StatGrid cols={6}>
          <Stat label="Net worth (year-end)" value={s.endValue != null ? <Sensitive>{formatCurrency(s.endValue)}</Sensitive> : "—"} />
          <Stat
            label="Net contributions"
            value={<Sensitive>{formatCurrency(s.netContributions)}</Sensitive>}
            color={gainColor(s.netContributions)}
          />
          <Stat label="Dividends" value={<Sensitive>{formatCurrency(s.income.dividendsGross)}</Sensitive>} />
          <Stat
            label="Realized gain/loss"
            value={<Sensitive>{formatCurrency(s.realizedGain)}</Sensitive>}
            color={gainColor(s.realizedGain)}
          />
          <Stat label="Interest" value={<Sensitive>{formatCurrency(s.income.interest)}</Sensitive>} />
          <Stat label="Fees" value={<Sensitive>{formatCurrency(s.fees)}</Sensitive>} color={s.fees > 0 ? "var(--negative)" : undefined} />
        </StatGrid>
      </Section>
    </div>
  );
}

/* ── Mini monthly-returns bar chart ────────────────────────────────────────── */

const W = 720;
const H = 150;
const PAD = { l: 10, r: 10, t: 12, b: 20 };

function MonthlyBars({ data }: { data: { period: string; pct: number }[] }) {
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const vals = [0, ...data.map((d) => d.pct)];
  let yMax = Math.max(...vals);
  let yMin = Math.min(...vals);
  if (yMax === yMin) { yMax += 1; yMin -= 1; }
  const head = (yMax - yMin) * 0.12;
  yMax += head;
  yMin -= head;
  const yToPx = (v: number) => PAD.t + ((yMax - v) / (yMax - yMin)) * plotH;
  const y0 = yToPx(0);
  const groupW = plotW / data.length;
  const barW = Math.min(30, groupW * 0.6);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto", minWidth: data.length > 8 ? 620 : undefined }} role="img">
        <line x1={PAD.l} y1={y0} x2={W - PAD.r} y2={y0} stroke="var(--border)" strokeWidth={1} />
        {data.map((d, i) => {
          const cx = PAD.l + groupW * i + groupW / 2;
          const top = Math.min(y0, yToPx(d.pct));
          const h = Math.abs(yToPx(d.pct) - y0);
          return (
            <g key={d.period}>
              <rect
                x={cx - barW / 2}
                y={top}
                width={barW}
                height={Math.max(h, 0.5)}
                rx={1.5}
                fill={gainColor(d.pct) ?? DIM}
                opacity={0.85}
              />
              <text x={cx} y={H - 6} textAnchor="middle" fontSize={9} fill={DIM}>
                {shortMonth(d.period)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
