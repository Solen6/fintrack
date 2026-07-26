"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatPercent } from "@/lib/format";
import type { ReportTrendPoint } from "@/app/api/reports/trends/route";

/* Cross-month trends for the Monthly Reports view. Fetches the compact series
   from /api/reports/trends for the selected account scope and renders a small
   hand-rolled SVG chart (no Recharts → no SSR concerns, matches the rest of the
   app) plus a "vs last month" comparison strip for the selected period.

   Deliberately percentage/ratio metrics only (return, S&P, Sharpe, beta, alpha,
   savings rate) — no absolute dollar series — so nothing here needs Private-mode
   masking. */

const DIM = "oklch(0.52 0.008 74)";
const STEEL = "var(--steel)";

type Mode = "return" | "alpha" | "beta" | "savings";
const MODES: { key: Mode; label: string }[] = [
  { key: "return", label: "Return vs S&P" },
  { key: "alpha", label: "Alpha" },
  { key: "beta", label: "Beta" },
  { key: "savings", label: "Savings rate" },
];

function shortMonth(period: string): string {
  return new Date(`${period}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" });
}

export function ReportTrends({ account, period }: { account: string; period: string | null }) {
  const [series, setSeries] = useState<ReportTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("return");
  const reqRef = useRef(0);

  useEffect(() => {
    const req = ++reqRef.current;
    setLoading(true);
    fetch(`/api/reports/trends?account=${encodeURIComponent(account)}`)
      .then((r) => (r.ok ? r.json() : { series: [] }))
      .then((d: { series?: ReportTrendPoint[] }) => {
        if (reqRef.current !== req) return;
        setSeries(d.series ?? []);
      })
      .catch(() => reqRef.current === req && setSeries([]))
      .finally(() => reqRef.current === req && setLoading(false));
  }, [account]);

  // Selected period vs the period immediately before it in the series.
  const comparison = useMemo(() => {
    if (!period) return null;
    const idx = series.findIndex((p) => p.period === period);
    if (idx < 1) return null;
    return { cur: series[idx], prev: series[idx - 1] };
  }, [series, period]);

  if (loading) {
    return (
      <div className="rounded-md border border-border bg-card p-4">
        <div className="h-40 animate-pulse rounded-sm" style={{ background: "oklch(0.14 0 0)" }} />
      </div>
    );
  }
  if (series.length < 2) return null; // nothing to trend yet — a single month says nothing

  return (
    <section className="rounded-md border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Trends</h3>
        <div className="flex items-center rounded-sm border border-border p-0.5 gap-0.5">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`px-2 py-0.5 text-[11px] rounded-[3px] transition-colors ${
                mode === m.key ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={mode === m.key}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <TrendChart series={series} mode={mode} selected={period} />

      {comparison && <ComparisonStrip cur={comparison.cur} prev={comparison.prev} />}
    </section>
  );
}

/* ── The SVG chart ─────────────────────────────────────────────────────────── */

const W = 720;
const H = 200;
const PAD = { l: 36, r: 10, t: 14, b: 22 };
const plotW = W - PAD.l - PAD.r;
const plotH = H - PAD.t - PAD.b;

function gainColor(v: number): string {
  if (v > 0) return "var(--positive)";
  if (v < 0) return "var(--negative)";
  return DIM;
}

function TrendChart({ series, mode, selected }: { series: ReportTrendPoint[]; mode: Mode; selected: string | null }) {
  const n = series.length;
  const groupW = plotW / n;

  // Values in play for the y-scale (always include 0 so the baseline reads).
  const primary = (p: ReportTrendPoint): number | null =>
    mode === "return" ? p.monthReturnPct
      : mode === "alpha" ? p.alpha
      : mode === "beta" ? p.beta
      : p.savingsRate;
  const secondary = (p: ReportTrendPoint): number | null =>
    mode === "return" ? p.benchmarkReturnPct : null;

  const vals: number[] = [0];
  if (mode === "beta") vals.push(1); // keep the β=1 reference in view
  for (const p of series) {
    const a = primary(p); if (a != null) vals.push(a);
    const b = secondary(p); if (b != null) vals.push(b);
  }
  let yMax = Math.max(...vals);
  let yMin = Math.min(...vals);
  if (yMax === yMin) { yMax += 1; yMin -= 1; }
  const headroom = (yMax - yMin) * 0.12;
  yMax += headroom;
  yMin -= headroom;
  const yToPx = (v: number) => PAD.t + ((yMax - v) / (yMax - yMin)) * plotH;
  const y0 = yToPx(0);
  const centerX = (i: number) => PAD.l + groupW * i + groupW / 2;

  const hasData = vals.length > (mode === "beta" ? 2 : 1);
  if (!hasData) {
    return <p className="text-xs" style={{ color: DIM }}>No data for this metric yet.</p>;
  }

  // Y-axis scale so every bar/point is readable, not just relative. Ticks at the
  // real data extremes (beta = plain number, everything else = a percentage).
  const fmtAxis = (v: number) => (mode === "beta" ? v.toFixed(2) : `${v.toFixed(1)}%`);
  const dataVals = vals.slice(mode === "beta" ? 2 : 1); // drop the synthetic 0 (and β=1) refs
  const realMax = Math.max(...dataVals);
  const realMin = Math.min(...dataVals);
  const gridLines = [realMax, realMin].filter(
    (v, i, a) => Math.abs(v) > 1e-9 && a.indexOf(v) === i, // skip 0 (zero baseline covers it) and dupes
  );

  const modeLabel = MODES.find((m) => m.key === mode)?.label ?? mode;
  const selPoint = selected ? series.find((p) => p.period === selected) : null;
  const selVal = selPoint ? primary(selPoint) : null;
  const ariaLabel =
    `${modeLabel} by month across ${n} months.` +
    (selected && selVal != null ? ` Selected ${shortMonth(selected)}: ${fmtAxis(selVal)}.` : "");

  const isBars = mode !== "beta";
  const twoSeries = mode === "return";
  const nBars = twoSeries ? 2 : 1;
  const barW = Math.min(26, (groupW * 0.62) / nBars);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: n > 8 ? 640 : undefined, height: "auto" }} role="img" aria-label={ariaLabel}>
        {/* y-axis scale: faint gridline + left-edge value at each data extreme */}
        {gridLines.map((v) => {
          const y = yToPx(v);
          return (
            <g key={`grid-${v}`}>
              <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke={DIM} strokeWidth={1} strokeOpacity={0.22} />
              <text x={PAD.l - 5} y={y + 3} textAnchor="end" fontSize={8} fill={DIM} style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmtAxis(v)}
              </text>
            </g>
          );
        })}
        {/* zero / baseline */}
        <line x1={PAD.l} y1={y0} x2={W - PAD.r} y2={y0} stroke="var(--border)" strokeWidth={1} />
        <text x={PAD.l - 5} y={y0 + 3} textAnchor="end" fontSize={8} fill={DIM} style={{ fontVariantNumeric: "tabular-nums" }}>
          {mode === "beta" ? "0.00" : "0%"}
        </text>

        {/* β = 1 reference */}
        {mode === "beta" && yMin <= 1 && yMax >= 1 && (
          <>
            <line x1={PAD.l} y1={yToPx(1)} x2={W - PAD.r} y2={yToPx(1)} stroke={DIM} strokeWidth={1} strokeDasharray="3 3" />
            <text x={W - PAD.r} y={yToPx(1) - 3} textAnchor="end" fontSize={9} fill={DIM}>β=1 (market)</text>
          </>
        )}

        {isBars
          ? series.map((p, i) => {
              const a = primary(p);
              const b = secondary(p);
              const sel = p.period === selected;
              const cx = centerX(i);
              const els: React.ReactNode[] = [];
              if (a != null) {
                const x = twoSeries ? cx - barW - 1 : cx - barW / 2;
                const top = Math.min(y0, yToPx(a));
                const h = Math.abs(yToPx(a) - y0);
                els.push(
                  <rect key="a" x={x} y={top} width={barW} height={Math.max(h, 0.5)} rx={1.5}
                    fill={gainColor(a)} opacity={sel ? 1 : 0.82}
                    stroke={sel ? "var(--foreground)" : "none"} strokeWidth={sel ? 1 : 0} />,
                );
              }
              if (twoSeries && b != null) {
                const x = cx + 1;
                const top = Math.min(y0, yToPx(b));
                const h = Math.abs(yToPx(b) - y0);
                els.push(
                  <rect key="b" x={x} y={top} width={barW} height={Math.max(h, 0.5)} rx={1.5}
                    fill={STEEL} opacity={sel ? 0.9 : 0.55} />,
                );
              }
              return (
                <g key={p.period}>
                  {els}
                  <text x={cx} y={H - 7} textAnchor="middle" fontSize={9}
                    fill={sel ? "var(--foreground)" : DIM}>{shortMonth(p.period)}</text>
                </g>
              );
            })
          : (() => {
              // Beta line
              const pts = series.map((p, i) => ({ p, i, v: primary(p) })).filter((d) => d.v != null) as { p: ReportTrendPoint; i: number; v: number }[];
              const path = pts.map((d, k) => `${k === 0 ? "M" : "L"}${centerX(d.i).toFixed(1)},${yToPx(d.v).toFixed(1)}`).join(" ");
              return (
                <>
                  {pts.length > 1 && <path d={path} fill="none" stroke={STEEL} strokeWidth={1.5} />}
                  {series.map((p, i) => {
                    const v = primary(p);
                    const sel = p.period === selected;
                    return (
                      <g key={p.period}>
                        {v != null && (
                          <circle cx={centerX(i)} cy={yToPx(v)} r={sel ? 4 : 3}
                            fill={sel ? "var(--foreground)" : STEEL} />
                        )}
                        <text x={centerX(i)} y={H - 7} textAnchor="middle" fontSize={9}
                          fill={sel ? "var(--foreground)" : DIM}>{shortMonth(p.period)}</text>
                      </g>
                    );
                  })}
                </>
              );
            })()}
      </svg>

      {/* Legend for the two-series return view */}
      {twoSeries && (
        <div className="flex items-center gap-4 text-[11px] mt-1" style={{ color: DIM }}>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--positive)" }} /> Portfolio
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: STEEL }} /> S&amp;P 500
          </span>
        </div>
      )}
    </div>
  );
}

/* ── vs-last-month comparison strip ────────────────────────────────────────── */

function ComparisonStrip({ cur, prev }: { cur: ReportTrendPoint; prev: ReportTrendPoint }) {
  const items = ([
    { label: "Return", cur: cur.monthReturnPct, prev: prev.monthReturnPct, unit: "pct" },
    { label: "S&P 500", cur: cur.benchmarkReturnPct, prev: prev.benchmarkReturnPct, unit: "pct" },
    { label: "Beta", cur: cur.beta, prev: prev.beta, unit: "num" },
    { label: "Alpha", cur: cur.alpha, prev: prev.alpha, unit: "pct" },
    { label: "Savings", cur: cur.savingsRate, prev: prev.savingsRate, unit: "pct" },
  ] as { label: string; cur: number | null; prev: number | null; unit: "pct" | "num" }[]).filter(
    (i) => i.cur != null,
  );

  if (items.length === 0) return null;

  const fmt = (v: number, unit: "pct" | "num") => (unit === "pct" ? formatPercent(v, false) : v.toFixed(2));

  return (
    <div className="border-t border-border/60 pt-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
        {shortMonth(cur.period)} vs {shortMonth(prev.period)}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px rounded-sm overflow-hidden" style={{ background: "var(--border)" }}>
        {items.map((it) => {
          const delta = it.prev != null ? it.cur! - it.prev : null;
          return (
            <div key={it.label} className="bg-card px-2.5 py-1.5 flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{it.label}</span>
              <span className="text-sm font-mono tabular-nums text-foreground">{fmt(it.cur!, it.unit)}</span>
              {delta != null && (
                <span className="text-[10px] font-mono tabular-nums" style={{ color: gainColor(delta) }}>
                  {delta >= 0 ? "▲" : "▼"} {fmt(Math.abs(delta), it.unit)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
