"use client";

import { useEffect, useMemo, useState } from "react";
import nextDynamic from "next/dynamic";
import { formatCurrency } from "@/lib/format";
import { TradeTicket } from "./TradeTicket";
import type { StockCell, Sp500Timeframe } from "@/app/api/sp500/route";
import type { StockStats } from "@/lib/yahoo";
import type { SeriesRange } from "@/app/api/paper/series/route";
import { RatingBadge, RatingBar, useRatings } from "@/components/ratings/RatingBadge";

const StockTreemap = nextDynamic(
  () => import("@/components/stocks/StockTreemap").then((m) => m.StockTreemap),
  { ssr: false, loading: () => <div className="skeleton h-full w-full rounded-sm" /> }
);

/* Recharts (SSR-disabled — project convention to avoid prerender errors) */
const AreaChart = nextDynamic(() => import("recharts").then((m) => m.AreaChart), { ssr: false });
const Area = nextDynamic(() => import("recharts").then((m) => m.Area), { ssr: false });
const XAxis = nextDynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = nextDynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const Tooltip = nextDynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const ResponsiveContainer = nextDynamic(() => import("recharts").then((m) => m.ResponsiveContainer), { ssr: false });

const TF_OPTIONS: Sp500Timeframe[] = ["1D", "1W", "1M", "YTD"];
const FULL_SCALE: Record<Sp500Timeframe, number> = { "1D": 2.5, "1W": 5, "1M": 10, "YTD": 30 };
const EMERALD = "0.72 0.15 152";
const RUBY = "0.66 0.19 25";

function signedPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
function fmtPx(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function fmtCapB(capB: number): string {
  return capB >= 1000 ? `$${(capB / 1000).toFixed(2)}T` : `$${capB.toFixed(1)}B`;
}
function fmtBigUsd(v: number): string {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toLocaleString("en-US")}`;
}
function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toLocaleString("en-US");
}

export function StocksDeck({ accountId, onPlaced }: { accountId: string; onPlaced: () => void }) {
  const [tf, setTf] = useState<Sp500Timeframe>("1D");
  const [cells, setCells] = useState<StockCell[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    setLoading(true);
    let cancelled = false;
    fetch(`/api/sp500?range=${tf}`)
      .then((r) => r.json())
      .then((d: { cells?: StockCell[]; sectors?: string[] }) => {
        if (cancelled) return;
        setCells(d.cells ?? []);
        setSectors(d.sectors ?? []);
        setLastRefreshed(new Date());
        // Default selection = largest-cap valid name (cells arrive cap-desc).
        setSelected((cur) => cur || d.cells?.find((c) => !c.error)?.symbol || "AAPL");
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tf]);

  const cellBySym = useMemo(() => new Map(cells.map((c) => [c.symbol, c])), [cells]);
  const selectedCell = cellBySym.get(selected) ?? null;

  // Cap-weighted aggregate % per sector for the performance bars.
  const sectorPerf = useMemo(() => {
    const agg = new Map<string, { cap: number; weighted: number }>();
    for (const c of cells) {
      if (c.error) continue;
      const a = agg.get(c.sector) ?? { cap: 0, weighted: 0 };
      a.cap += c.capB;
      a.weighted += c.capB * c.changePct;
      agg.set(c.sector, a);
    }
    return (sectors.length ? sectors : [...agg.keys()])
      .filter((s) => agg.has(s))
      .map((s) => ({ sector: s, pct: agg.get(s)!.weighted / (agg.get(s)!.cap || 1) }))
      .sort((a, b) => b.pct - a.pct);
  }, [cells, sectors]);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Heatmap ── */}
      <section className="rounded-md border border-border bg-card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">S&amp;P 500 Heatmap</h2>
          <div className="flex items-center gap-1 p-0.5 rounded-sm" style={{ background: "oklch(0.10 0 0)" }}>
            {TF_OPTIONS.map((t) => {
              const on = tf === t;
              return (
                <button
                  key={t}
                  onClick={() => setTf(t)}
                  aria-pressed={on}
                  className="rounded-sm px-2.5 py-1 text-xs font-mono transition-colors"
                  style={{ background: on ? "var(--card)" : "transparent", color: on ? "var(--primary)" : "oklch(0.64 0.008 74)" }}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <div className="flex-1 hidden sm:block" />
          <Legend tf={tf} />
          {lastRefreshed && (
            <p className="text-xs text-muted-foreground whitespace-nowrap">
              as of {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground -mt-1">
          Sized by market cap · grouped by sector · click a tile to load it into the trade ticket.
        </p>
        <div style={{ height: 560 }}>
          {loading && cells.length === 0 ? (
            <div className="skeleton h-full w-full rounded-sm" />
          ) : (
            <StockTreemap cells={cells} sectors={sectors} tf={tf} onSelect={setSelected} selected={selected} />
          )}
        </div>
      </section>

      {/* ── ticket · detail · sector bars ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-3">
          <TradeTicket
            accountId={accountId}
            onPlaced={onPlaced}
            assetClass="STOCK"
            stockSymbol={selected}
            onStockSymbolChange={setSelected}
          />
        </div>
        <div className="lg:col-span-6">
          <StockDetail symbol={selected} cell={selectedCell} tf={tf} />
        </div>
        <div className="lg:col-span-3">
          <SectorBars rows={sectorPerf} tf={tf} loading={loading && cells.length === 0} />
        </div>
      </div>
    </div>
  );
}

/* ─── Selected-stock: header + price chart + key stats ─── */
function StockDetail({ symbol, cell, tf }: { symbol: string; cell: StockCell | null; tf: Sp500Timeframe }) {
  const [stats, setStats] = useState<StockStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const ratingSymbols = useMemo(() => (symbol ? [symbol] : []), [symbol]);
  const { ratings, loading: ratingLoading } = useRatings(ratingSymbols);
  const rating = symbol ? ratings[symbol.toUpperCase()] ?? null : null;

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setStats(null);
    setStatsLoading(true);
    fetch(`/api/stocks/detail?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d: { stats?: StockStats | null }) => { if (!cancelled) setStats(d.stats ?? null); })
      .catch(() => { if (!cancelled) setStats(null); })
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  if (!symbol) {
    return (
      <section className="rounded-md border border-border bg-card p-4 h-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Select a stock from the heatmap.</p>
      </section>
    );
  }

  const price = stats?.price ?? (cell && !cell.error ? cell.price : null);
  // Headline % uses the heatmap timeframe (cell); stats.changePct is always 1D.
  const pct = cell && !cell.error ? cell.changePct : stats?.changePct ?? null;
  const tone = pct == null ? undefined : pct >= 0 ? "var(--positive)" : "var(--negative)";

  const rangePos = (lo: number | null | undefined, hi: number | null | undefined, p: number | null) =>
    lo != null && hi != null && p != null && hi > lo ? Math.max(0, Math.min(1, (p - lo) / (hi - lo))) : null;

  return (
    <section className="rounded-md border border-border bg-card p-4 flex flex-col gap-4 h-full">
      {/* header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-medium text-foreground leading-tight">
            {cell?.name ?? symbol}
          </h2>
          <p className="text-xs font-mono text-muted-foreground">
            {symbol}{cell ? ` · ${cell.sector}` : ""}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono tabular-nums leading-none text-foreground">
            {price != null ? fmtPx(price) : "—"}
          </div>
          {pct != null && (
            <div className="text-sm font-mono tabular-nums mt-1" style={{ color: tone }}>
              {signedPct(pct)} <span className="text-xs text-muted-foreground">{tf}</span>
            </div>
          )}
        </div>
      </div>

      {/* price chart */}
      <StockChart symbol={symbol} />

      {/* stats */}
      <div>
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Key Stats</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-px rounded-sm overflow-hidden" style={{ background: "var(--border)" }}>
          <Stat label="Market cap" value={stats?.marketCap != null ? fmtBigUsd(stats.marketCap) : cell ? fmtCapB(cell.capB) : "—"} loading={statsLoading} />
          <Stat label="P / E" value={stats?.trailingPE != null ? stats.trailingPE.toFixed(1) : "—"} loading={statsLoading} />
          <Stat label="Div yield" value={stats?.dividendYield != null ? `${(stats.dividendYield * 100).toFixed(2)}%` : "—"} loading={statsLoading} />
          <Stat label="Volume" value={stats?.volume != null ? fmtVol(stats.volume) : "—"} loading={statsLoading} />
          <Stat
            label="Day range"
            value={stats?.dayLow != null && stats?.dayHigh != null ? `${fmtPx(stats.dayLow)}–${fmtPx(stats.dayHigh)}` : "—"}
            loading={statsLoading}
            pos={rangePos(stats?.dayLow, stats?.dayHigh, price)}
          />
          <Stat
            label="52-wk range"
            value={stats?.weekLow52 != null && stats?.weekHigh52 != null ? `${fmtPx(stats.weekLow52)}–${fmtPx(stats.weekHigh52)}` : "—"}
            loading={statsLoading}
            pos={rangePos(stats?.weekLow52, stats?.weekHigh52, price)}
          />
        </div>
      </div>

      {/* analyst consensus */}
      <div>
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Analyst Rating</h3>
        {rating ? (
          <div className="flex flex-col gap-2">
            <RatingBadge rating={rating} />
            <RatingBar rating={rating} />
          </div>
        ) : (
          <RatingBadge rating={null} loading={ratingLoading} />
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, loading, pos }: { label: string; value: string; loading?: boolean; pos?: number | null }) {
  return (
    <div className="bg-card px-3 py-2.5 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {loading ? (
        <span className="skeleton rounded-sm" style={{ height: 14, width: "60%" }} />
      ) : (
        <span className="text-sm font-mono tabular-nums text-foreground">{value}</span>
      )}
      {/* range position marker (low ▏ ··●·· ▕ high) */}
      {pos != null && !loading && (
        <div className="relative mt-0.5 h-1 rounded-full" style={{ background: "oklch(0.20 0 0)" }}>
          <div
            className="absolute top-1/2 h-2 w-2 rounded-full -translate-y-1/2 -translate-x-1/2"
            style={{ left: `${pos * 100}%`, background: "var(--primary)" }}
          />
        </div>
      )}
    </div>
  );
}

/* ─── Per-stock price chart with range toggle (reuses /api/paper/series) ─── */
const CHART_RANGES: SeriesRange[] = ["1D", "5D", "1M", "6M", "YTD"];

function StockChart({ symbol }: { symbol: string }) {
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
  const gid = `spx-${symbol.replace(/[^a-zA-Z0-9]/g, "")}`;

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
      <div style={{ height: 200 }}>
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

/* ─── Cap-weighted sector performance bars ─── */
function SectorBars({ rows, tf, loading }: { rows: { sector: string; pct: number }[]; tf: Sp500Timeframe; loading: boolean }) {
  const scale = FULL_SCALE[tf];
  const max = Math.max(scale, ...rows.map((r) => Math.abs(r.pct)), 0.01);

  return (
    <section className="rounded-md border border-border bg-card p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Sectors</h2>
        <span className="text-[10px] font-mono text-muted-foreground">{tf} · cap-wtd</span>
      </div>
      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 11 }).map((_, i) => <div key={i} className="skeleton rounded-sm" style={{ height: 22 }} />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-3 text-center">No sector data.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => {
            const pos = r.pct >= 0;
            const w = Math.min(100, (Math.abs(r.pct) / max) * 100);
            const hue = pos ? EMERALD : RUBY;
            return (
              <div key={r.sector} className="flex items-center gap-2 text-xs" title={`${r.sector}: ${signedPct(r.pct)}`}>
                <span className="w-[92px] shrink-0 truncate text-muted-foreground" style={{ fontSize: 11 }}>{r.sector}</span>
                {/* diverging bar around a center axis */}
                <div className="relative flex-1 h-3.5 rounded-sm overflow-hidden" style={{ background: "oklch(0.10 0 0)" }}>
                  <div className="absolute top-0 bottom-0" style={{ left: "50%", width: 1, background: "oklch(0.24 0 0)" }} />
                  <div
                    className="absolute top-0 bottom-0 rounded-sm"
                    style={{
                      background: `oklch(${hue} / 0.55)`,
                      width: `${w / 2}%`,
                      left: pos ? "50%" : undefined,
                      right: pos ? undefined : "50%",
                    }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right font-mono tabular-nums" style={{ color: pos ? "var(--positive)" : "var(--negative)" }}>
                  {signedPct(r.pct)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ─── Color legend (matches the futures deck) ─── */
function Legend({ tf }: { tf: Sp500Timeframe }) {
  const scale = FULL_SCALE[tf];
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <span className="text-xs font-mono text-muted-foreground">−{scale}%</span>
      <div
        className="h-2.5 w-24 rounded-sm border border-border"
        style={{
          background: `linear-gradient(to right,
            oklch(${RUBY} / 0.80), oklch(${RUBY} / 0.22),
            oklch(0.20 0 0),
            oklch(${EMERALD} / 0.22), oklch(${EMERALD} / 0.80))`,
        }}
      />
      <span className="text-xs font-mono text-muted-foreground">+{scale}%</span>
    </div>
  );
}
