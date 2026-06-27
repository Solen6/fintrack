"use client";

import { useEffect, useMemo, useState } from "react";
import nextDynamic from "next/dynamic";
import { formatCurrency } from "@/lib/format";
import {
  FUTURES_SPECS,
  pointValueFor,
  tickValueFor,
  type FuturesSpec,
} from "@/lib/contract-specs";
import { TradeTicket } from "./TradeTicket";
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
const FULL_SCALE: Record<FuturesTimeframe, number> = { "1D": 3, "1W": 6, "1M": 12, "YTD": 40 };
const EMERALD = "0.72 0.15 152";
const RUBY = "0.66 0.19 25";

// Only contracts the paper engine can actually trade (FUTURES_SPECS) — this drops
// the Currencies block from the futures route, which has no spec/margin.
const TRADEABLE = new Set(Object.keys(FUTURES_SPECS));
const CATEGORY_ORDER = ["Energy", "Metals", "Indices", "Rates", "Agriculture"];

function shortSymbol(symbol: string): string {
  return symbol.replace("=F", "");
}
function fmtPx(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 50 ? 2 : 4 });
}
function signedPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function FuturesDeck({ accountId, onPlaced }: { accountId: string; onPlaced: () => void }) {
  const [selected, setSelected] = useState<string>("ES=F");
  const [tf, setTf] = useState<FuturesTimeframe>("1D");
  const [cells, setCells] = useState<FutureCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  useEffect(() => {
    setLoading(true);
    let cancelled = false;
    fetch(`/api/futures?range=${tf}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setCells(d.cells ?? []);
        setLastRefreshed(new Date());
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tf]);

  // Tradeable cells only (map + picker); look up live data per symbol.
  const tradeable = useMemo(() => cells.filter((c) => TRADEABLE.has(c.symbol)), [cells]);
  const cellBySym = useMemo(() => new Map(tradeable.map((c) => [c.symbol, c])), [tradeable]);
  const selectedCell = cellBySym.get(selected) ?? null;
  const spec = FUTURES_SPECS[selected];

  return (
    <div className="flex flex-col gap-4">
      {/* ── Market map ── */}
      <section className="rounded-md border border-border bg-card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Market Map</h2>
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
        <p className="text-xs text-muted-foreground -mt-1">Click a tile to load it into the trade ticket.</p>
        <div style={{ height: 300 }}>
          {loading ? (
            <div className="skeleton h-full w-full rounded-sm" />
          ) : (
            <FuturesTreemap cells={tradeable} tf={tf} onSelect={setSelected} selected={selected} />
          )}
        </div>
      </section>

      {/* ── picker · ticket · detail ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-3">
          <ContractPicker cellBySym={cellBySym} tf={tf} selected={selected} onSelect={setSelected} loading={loading} />
        </div>
        <div className="lg:col-span-3">
          <TradeTicket
            accountId={accountId}
            onPlaced={onPlaced}
            assetClass="FUTURE"
            futureSymbol={selected}
            onFutureSymbolChange={setSelected}
          />
        </div>
        <div className="lg:col-span-6 flex flex-col gap-4">
          <ContractDetail symbol={selected} spec={spec} cell={selectedCell} />
        </div>
      </div>
    </div>
  );
}

/* ─── Category-grouped picker with live price + % change ─── */
function ContractPicker({
  cellBySym, tf, selected, onSelect, loading,
}: {
  cellBySym: Map<string, FutureCell>;
  tf: FuturesTimeframe;
  selected: string;
  onSelect: (s: string) => void;
  loading: boolean;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  const groups = useMemo(() => {
    const all = Object.values(FUTURES_SPECS);
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      items: all.filter(
        (s) =>
          s.category === cat &&
          (!query || s.name.toLowerCase().includes(query) || s.symbol.toLowerCase().includes(query)),
      ),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  return (
    <section className="rounded-md border border-border bg-card p-3 flex flex-col gap-2 h-full">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Contracts</h2>
        <span className="text-[10px] font-mono text-muted-foreground">{tf} chg</span>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search contracts…"
        aria-label="Search contracts"
        className="w-full rounded-sm border border-input bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-ring"
      />
      <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 560 }}>
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">No contracts match “{q}”.</p>
        ) : (
          groups.map((g) => (
            <div key={g.category} className="flex flex-col">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-1 py-1 sticky top-0" style={{ background: "var(--card)" }}>
                {g.category}
              </p>
              {g.items.map((s) => (
                <PickerRow
                  key={s.symbol}
                  spec={s}
                  cell={cellBySym.get(s.symbol)}
                  active={selected === s.symbol}
                  loading={loading}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function PickerRow({
  spec, cell, active, loading, onSelect,
}: {
  spec: FuturesSpec;
  cell?: FutureCell;
  active: boolean;
  loading: boolean;
  onSelect: (s: string) => void;
}) {
  const pct = cell && !cell.error ? cell.changePct : null;
  const px = cell && !cell.error ? cell.price : null;
  const tone = pct == null ? "oklch(0.64 0.008 74)" : pct >= 0 ? "var(--positive)" : "var(--negative)";
  return (
    <button
      onClick={() => onSelect(spec.symbol)}
      aria-pressed={active}
      className="flex items-center gap-2 rounded-sm px-1.5 py-1.5 text-left transition-colors"
      style={{
        background: active ? "oklch(0.16 0.04 74)" : "transparent",
        borderLeft: `2px solid ${active ? "var(--primary)" : "transparent"}`,
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground truncate" style={active ? { color: "var(--primary)" } : undefined}>
          {spec.name}
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">{shortSymbol(spec.symbol)}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs font-mono tabular-nums text-foreground">
          {loading && px == null ? "…" : px != null ? fmtPx(px) : "—"}
        </div>
        <div className="text-[10px] font-mono tabular-nums" style={{ color: tone }}>
          {pct != null ? signedPct(pct) : "—"}
        </div>
      </div>
    </button>
  );
}

/* ─── Selected-contract detail: header + price chart + specs ─── */
function ContractDetail({
  symbol, spec, cell,
}: {
  symbol: string;
  spec: FuturesSpec | undefined;
  cell: FutureCell | null;
}) {
  if (!spec) {
    return (
      <section className="rounded-md border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">Select a contract to see details.</p>
      </section>
    );
  }

  const price = cell && !cell.error ? cell.price : null;
  const pct = cell && !cell.error ? cell.changePct : null;
  const tone = pct == null ? undefined : pct >= 0 ? "var(--positive)" : "var(--negative)";

  const pointVal = pointValueFor(symbol);
  const tickVal = tickValueFor(symbol);
  const notional = price != null ? price * spec.multiplier : null;

  return (
    <>
      <section className="rounded-md border border-border bg-card p-4 flex flex-col gap-4">
        {/* header */}
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-medium text-foreground leading-tight">{spec.name}</h2>
            <p className="text-xs font-mono text-muted-foreground">{symbol} · {spec.category}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-mono tabular-nums leading-none text-foreground">
              {price != null ? fmtPx(price) : "—"}
            </div>
            {pct != null && (
              <div className="text-sm font-mono tabular-nums mt-1" style={{ color: tone }}>{signedPct(pct)}</div>
            )}
          </div>
        </div>

        {/* price chart */}
        <ContractChart symbol={symbol} />

        {/* specs */}
        <div>
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Contract Specs</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-px rounded-sm overflow-hidden" style={{ background: "var(--border)" }}>
            <Spec label="Point value" value={formatCurrency(pointVal)} hint="per 1.00 move" />
            <Spec label="Tick size" value={spec.tickSize.toString()} />
            <Spec label="Tick value" value={formatCurrency(tickVal)} hint="per tick" />
            <Spec label="Multiplier" value={`×${spec.multiplier.toLocaleString()}`} />
            <Spec label="Init. margin" value={formatCurrency(spec.initialMargin)} hint="per contract" />
            <Spec label="Maint. margin" value={formatCurrency(spec.maintenanceMargin)} hint="per contract" />
          </div>
          <div className="flex items-center justify-between mt-2 px-1">
            <span className="text-xs text-muted-foreground">Notional · 1 contract</span>
            <span className="text-sm font-mono tabular-nums text-foreground">{notional != null ? formatCurrency(notional) : "—"}</span>
          </div>
        </div>
      </section>
    </>
  );
}

function Spec({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card px-3 py-2.5 flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-mono tabular-nums text-foreground">{value}</span>
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
  const gid = `px-${symbol.replace(/[^a-zA-Z0-9]/g, "")}`; // safe SVG id (symbols contain "=")

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

/* ─── Color legend (matches the standalone Futures tab) ─── */
function Legend({ tf }: { tf: FuturesTimeframe }) {
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
