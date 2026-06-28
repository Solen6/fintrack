"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import nextDynamic from "next/dynamic";
import { formatCurrency } from "@/lib/format";
import {
  FUTURES_SPECS,
  pointValueFor,
  tickValueFor,
} from "@/lib/contract-specs";
import type { FutureCell, FuturesTimeframe } from "@/app/api/futures/route";
import type { SeriesRange } from "@/app/api/paper/series/route";

const FuturesTreemap = nextDynamic(
  () => import("@/components/futures/FuturesTreemap").then((m) => m.FuturesTreemap),
  { ssr: false, loading: () => <div className="skeleton h-full w-full rounded-sm" /> }
);

/* Recharts (SSR-disabled — project convention to avoid prerender errors) */
const AreaChart = nextDynamic(() => import("recharts").then((m) => m.AreaChart), { ssr: false });
const Area = nextDynamic(() => import("recharts").then((m) => m.Area), { ssr: false });
const XAxis = nextDynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = nextDynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const Tooltip = nextDynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const ResponsiveContainer = nextDynamic(() => import("recharts").then((m) => m.ResponsiveContainer), { ssr: false });

const TF_OPTIONS: FuturesTimeframe[] = ["1D", "1W", "1M", "YTD"];

// % move that maps to full color intensity, per timeframe
const FULL_SCALE: Record<FuturesTimeframe, number> = {
  "1D": 3,
  "1W": 6,
  "1M": 12,
  "YTD": 40,
};

const EMERALD = "0.72 0.15 152";
const RUBY = "0.66 0.19 25";
const AMBER = "0.72 0.14 74";

function fmtPx(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 50 ? 2 : 4 });
}
function signedPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function FuturesHeatmap() {
  const [cells, setCells] = useState<FutureCell[]>([]);
  const [timeframe, setTimeframe] = useState<FuturesTimeframe>("1D");
  const [selected, setSelected] = useState<string>("ES=F");
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [tfOpen, setTfOpen] = useState(false);
  const tfRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/futures?range=${timeframe}`)
      .then((r) => r.json())
      .then((d) => {
        setCells(d.cells ?? []);
        setLastRefreshed(new Date());
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [timeframe]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (tfRef.current && !tfRef.current.contains(e.target as Node)) setTfOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Biggest movers across all valid cells
  const movers = useMemo(() => {
    const valid = cells.filter((c) => !c.error);
    const byMove = [...valid].sort((a, b) => b.changePct - a.changePct);
    return {
      gainers: byMove.slice(0, 3),
      losers: byMove.slice(-3).reverse(),
    };
  }, [cells]);

  const cellBySym = useMemo(() => new Map(cells.map((c) => [c.symbol, c])), [cells]);
  const selectedCell = cellBySym.get(selected) ?? null;

  return (
    <main className="flex-1 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-3.5 border-b border-border shrink-0 flex items-center gap-4 flex-wrap">
        <h2 className="text-lg font-medium text-foreground leading-none">Futures</h2>

        {/* Timeframe selector */}
        <div className="relative" ref={tfRef}>
          <button
            onClick={() => setTfOpen((o) => !o)}
            className="flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-sm border border-border text-foreground hover:border-foreground/40 transition-colors duration-150"
            aria-haspopup="listbox"
            aria-expanded={tfOpen}
          >
            {timeframe}
            <span className="text-muted-foreground" style={{ fontSize: "0.6rem" }}>▾</span>
          </button>
          {tfOpen && (
            <div
              className="absolute left-0 top-full mt-1 rounded-sm border border-border overflow-hidden"
              style={{ background: "oklch(0.14 0 0)", zIndex: 50, minWidth: 84 }}
              role="listbox"
            >
              {TF_OPTIONS.map((tf) => (
                <button
                  key={tf}
                  className="w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-accent transition-colors duration-150"
                  style={{ color: tf === timeframe ? "var(--primary)" : "oklch(0.64 0.008 74)" }}
                  onClick={() => { setTimeframe(tf); setTfOpen(false); }}
                  role="option"
                  aria-selected={tf === timeframe}
                >
                  {tf}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1 hidden sm:block" />

        {/* Legend */}
        <Legend tf={timeframe} />

        {/* Timestamp */}
        {lastRefreshed && (
          <p className="text-xs text-muted-foreground whitespace-nowrap">
            as of {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        )}
      </div>

      {/* Movers strip */}
      {!loading && (movers.gainers.length > 0 || movers.losers.length > 0) && (
        <div className="px-6 py-2.5 border-b border-border shrink-0 flex items-center gap-x-6 gap-y-1.5 flex-wrap">
          <MoversGroup label="Top gainers" items={movers.gainers} selected={selected} onSelect={setSelected} />
          <MoversGroup label="Top losers" items={movers.losers} selected={selected} onSelect={setSelected} />
        </div>
      )}

      {/* Treemap — click a tile to load it into the chart below */}
      {loading ? (
        <div className="p-px h-[58vh] min-h-[340px] shrink-0">
          <div className="skeleton h-full w-full rounded-sm" />
        </div>
      ) : (
        <div className="h-[58vh] min-h-[340px] shrink-0">
          <FuturesTreemap cells={cells} tf={timeframe} onSelect={setSelected} selected={selected} />
        </div>
      )}

      {/* Selected-contract detail: header + price chart + stats/specs */}
      {!loading && (
        <div className="px-6 py-4 shrink-0 border-t border-border">
          <ContractDetail symbol={selected} cell={selectedCell} />
        </div>
      )}
    </main>
  );
}

/* ─── Selected-contract detail: header + chart + snapshot/specs ─── */
function ContractDetail({ symbol, cell }: { symbol: string; cell: FutureCell | null }) {
  const spec = FUTURES_SPECS[symbol];
  const name = cell?.name ?? spec?.name ?? symbol;
  const category = cell?.category ?? spec?.category ?? "";
  const price = cell && !cell.error ? cell.price : null;
  const pct = cell && !cell.error ? cell.changePct : null;
  const chg = cell && !cell.error ? cell.change : null;
  const tone = pct == null ? undefined : pct >= 0 ? "var(--positive)" : "var(--negative)";

  const pointVal = spec ? pointValueFor(symbol) : null;
  const tickVal = spec ? tickValueFor(symbol) : null;
  const notional = spec && price != null ? price * spec.multiplier : null;

  return (
    <section className="rounded-md border border-border bg-card p-4 flex flex-col gap-4">
      {/* header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-medium text-foreground leading-tight">{name}</h2>
          <p className="text-xs font-mono text-muted-foreground">
            {symbol}{category ? ` · ${category}` : ""}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono tabular-nums leading-none text-foreground">
            {price != null ? fmtPx(price) : "—"}
          </div>
          {pct != null && (
            <div className="text-sm font-mono tabular-nums mt-1" style={{ color: tone }}>
              {chg != null ? `${chg >= 0 ? "+" : ""}${fmtPx(chg)} · ` : ""}{signedPct(pct)}
            </div>
          )}
        </div>
      </div>

      {/* chart (2/3) + snapshot/specs (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ContractChart symbol={symbol} />
        </div>
        <div className="lg:col-span-1 flex flex-col gap-3">
          <div>
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Snapshot</h3>
            <div className="grid grid-cols-2 gap-px rounded-sm overflow-hidden" style={{ background: "var(--border)" }}>
              <Stat label="Last" value={price != null ? fmtPx(price) : "—"} />
              <Stat label="Change" value={chg != null ? `${chg >= 0 ? "+" : ""}${fmtPx(chg)}` : "—"} tone={tone} />
              <Stat label="% Change" value={pct != null ? signedPct(pct) : "—"} tone={tone} />
              <Stat label="Category" value={category || "—"} />
            </div>
          </div>

          {spec && (
            <div>
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Contract Specs</h3>
              <div className="grid grid-cols-2 gap-px rounded-sm overflow-hidden" style={{ background: "var(--border)" }}>
                <Stat label="Point value" value={formatCurrency(pointVal!)} hint="per 1.00 move" />
                <Stat label="Tick size" value={spec.tickSize.toString()} />
                <Stat label="Tick value" value={formatCurrency(tickVal!)} hint="per tick" />
                <Stat label="Multiplier" value={`×${spec.multiplier.toLocaleString()}`} />
                <Stat label="Init. margin" value={formatCurrency(spec.initialMargin)} hint="per contract" />
                <Stat label="Maint. margin" value={formatCurrency(spec.maintenanceMargin)} hint="per contract" />
              </div>
              <div className="flex items-center justify-between mt-2 px-1">
                <span className="text-xs text-muted-foreground">Notional · 1 contract</span>
                <span className="text-sm font-mono tabular-nums text-foreground">{notional != null ? formatCurrency(notional) : "—"}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="bg-card px-3 py-2.5 flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span
        className={`text-sm font-mono tabular-nums ${tone ? "" : "text-foreground"}`}
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </span>
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

/* ─── Per-contract price chart with range toggle ─── */
const CHART_RANGES: SeriesRange[] = ["1D", "5D", "1M", "6M", "YTD"];

function ContractChart({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<SeriesRange>("1M");
  const [series, setSeries] = useState<{ date: string; price: number }[] | null>(null);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSeries(null);
    fetch(`/api/paper/series?symbol=${encodeURIComponent(symbol)}&range=${range}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setSeries(d.data ?? []);
        setPct(d.changePct ?? 0);
      })
      .catch(() => { if (!cancelled) setSeries([]); });
    return () => { cancelled = true; };
  }, [symbol, range]);

  const color = pct >= 0 ? "var(--positive)" : "var(--negative)";
  const intraday = range === "1D" || range === "5D";
  const gid = `fx-${symbol.replace(/[^a-zA-Z0-9]/g, "")}`; // safe SVG id (symbols contain "=" / ".")

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 self-end p-0.5 rounded-sm" style={{ background: "oklch(0.10 0 0)" }}>
        {CHART_RANGES.map((r) => {
          const on = range === r;
          return (
            <button
              key={r}
              onClick={() => setRange(r)}
              aria-pressed={on}
              className="rounded-sm px-2 py-0.5 text-[11px] font-mono transition-colors"
              style={{ background: on ? "var(--card)" : "transparent", color: on ? "var(--primary)" : "oklch(0.64 0.008 74)" }}
            >
              {r}
            </button>
          );
        })}
      </div>
      <div style={{ height: 240 }}>
        {series === null ? (
          <div className="skeleton h-full w-full rounded-md" />
        ) : series.length < 2 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-muted-foreground">No price data available.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "oklch(0.64 0.008 74)" }}
                tickFormatter={(d: string) => (intraday ? d.slice(11, 16) : d.slice(5))}
                minTickGap={32}
                stroke="oklch(0.20 0 0)"
              />
              <YAxis
                tick={{ fontSize: 10, fill: "oklch(0.64 0.008 74)" }}
                tickFormatter={(v: number) => fmtPx(v)}
                domain={["auto", "auto"]}
                width={52}
                stroke="oklch(0.20 0 0)"
              />
              <Tooltip
                contentStyle={{ background: "oklch(0.12 0 0)", border: "1px solid oklch(0.20 0 0)", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "oklch(0.64 0.008 74)" }}
                labelFormatter={(d) => (intraday ? String(d).slice(0, 16).replace("T", " ") : String(d))}
                formatter={(v) => [fmtPx(Number(v)), "Price"] as [string, string]}
              />
              <Area type="monotone" dataKey="price" stroke={color} strokeWidth={1.5} fill={`url(#${gid})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

/* ─── Color legend: ruby → neutral → emerald, with % markers ─── */
function Legend({ tf }: { tf: FuturesTimeframe }) {
  const scale = FULL_SCALE[tf];
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <span className="text-xs font-mono text-muted-foreground">−{scale}%</span>
      <div
        className="h-2.5 w-28 rounded-sm border border-border"
        style={{
          background: `linear-gradient(to right,
            oklch(${RUBY} / 0.80),
            oklch(${RUBY} / 0.22),
            oklch(0.20 0 0),
            oklch(${EMERALD} / 0.22),
            oklch(${EMERALD} / 0.80))`,
        }}
      />
      <span className="text-xs font-mono text-muted-foreground">+{scale}%</span>
    </div>
  );
}

/* ─── Movers strip group — chips select the contract ─── */
function MoversGroup({
  label, items, selected, onSelect,
}: {
  label: string;
  items: FutureCell[];
  selected: string;
  onSelect: (symbol: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {items.map((c) => {
          const positive = c.changePct >= 0;
          const isSel = selected === c.symbol;
          return (
            <button
              key={c.symbol}
              onClick={() => onSelect(c.symbol)}
              aria-pressed={isSel}
              className="text-xs font-mono px-1.5 py-0.5 rounded-sm transition-colors"
              style={{
                background: positive ? `oklch(${EMERALD} / 0.12)` : `oklch(${RUBY} / 0.12)`,
                color: positive ? "var(--positive)" : "var(--negative)",
                boxShadow: isSel ? `inset 0 0 0 1px oklch(${AMBER})` : "none",
              }}
              title={`${c.name} (${c.symbol})`}
            >
              {c.name} {positive ? "+" : ""}{c.changePct.toFixed(2)}%
            </button>
          );
        })}
      </div>
    </div>
  );
}
