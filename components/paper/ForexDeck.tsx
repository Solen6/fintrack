"use client";

import { useEffect, useMemo, useState } from "react";
import nextDynamic from "next/dynamic";
import { formatCurrency } from "@/lib/format";
import {
  FOREX_SPECS,
  FOREX_LEVERAGE,
  FOREX_STANDARD_LOT,
  pipSizeFor,
  pipValueUsd,
  notionalUsd,
  type ForexSpec,
} from "@/lib/contract-specs";
import { TradeTicket } from "./TradeTicket";
import type { ForexCell, ForexTimeframe } from "@/app/api/forex/route";
import type { SeriesRange } from "@/app/api/paper/series/route";

/* Recharts (SSR-disabled — project convention to avoid prerender errors) */
const AreaChart = nextDynamic(() => import("recharts").then((m) => m.AreaChart), { ssr: false });
const Area = nextDynamic(() => import("recharts").then((m) => m.Area), { ssr: false });
const XAxis = nextDynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = nextDynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const Tooltip = nextDynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const ResponsiveContainer = nextDynamic(() => import("recharts").then((m) => m.ResponsiveContainer), { ssr: false });

const TF_OPTIONS: ForexTimeframe[] = ["1D", "1W", "1M", "YTD"];
// FX moves are far smaller than futures — retuned so a normal day reads as a mid-tone.
const FULL_SCALE: Record<ForexTimeframe, number> = { "1D": 0.8, "1W": 1.6, "1M": 3.5, "YTD": 10 };
const EMERALD = "0.72 0.15 152";
const RUBY = "0.66 0.19 25";
const AMBER = "0.72 0.14 74";

// Fixed keystone layout: USD-quote majors on top, USD-base majors below.
const USD_QUOTE = ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD"];
const USD_BASE = ["USDJPY", "USDCHF", "USDCAD"];

function fxPx(symbol: string, n: number): string {
  return symbol.includes("JPY") ? n.toFixed(3) : n.toFixed(5);
}
function signedPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
function pairLabel(symbol: string): string {
  return `${symbol.slice(0, 3)}/${symbol.slice(3)}`;
}
function tileColor(pct: number, tf: ForexTimeframe) {
  const scale = FULL_SCALE[tf];
  const intensity = Math.min(1, Math.abs(pct) / scale) ** 0.7;
  const alpha = 0.2 + intensity * 0.62;
  const hue = pct >= 0 ? EMERALD : RUBY;
  return {
    fill: `oklch(${hue} / ${alpha.toFixed(3)})`,
    border: `oklch(${hue} / ${Math.min(1, alpha + 0.16).toFixed(3)})`,
    hoverBorder: `oklch(${hue} / 0.95)`,
  };
}

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

export function ForexDeck({ accountId, onPlaced }: { accountId: string; onPlaced: () => void }) {
  const [selected, setSelected] = useState<string>("EURUSD");
  const [tf, setTf] = useState<ForexTimeframe>("1D");
  const [cells, setCells] = useState<ForexCell[]>([]);
  const [dxy, setDxy] = useState<{ price: number; changePct: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  useEffect(() => {
    setLoading(true);
    let cancelled = false;
    fetch(`/api/forex?range=${tf}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setCells(d.cells ?? []);
        setDxy(d.dxy ?? null);
        setLastRefreshed(new Date());
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tf]);

  const cellBySym = useMemo(() => new Map(cells.map((c) => [c.symbol, c])), [cells]);
  const selectedCell = cellBySym.get(selected) ?? null;
  const spec = FOREX_SPECS[selected];

  // USD aggregate strength across all 7 pairs (USD is in every one → robust).
  // base=USD → USD strengthens as the pair rises (+); else USD is the quote → (−).
  const usdStrength = useMemo(() => {
    const valid = cells.filter((c) => !c.error);
    if (valid.length === 0) return null;
    const sum = valid.reduce((s, c) => s + (c.base === "USD" ? c.changePct : -c.changePct), 0);
    return sum / valid.length;
  }, [cells]);

  return (
    <div className="flex flex-col gap-4">
      <style>{`.fxtile:focus-visible{outline:2px solid oklch(${AMBER});outline-offset:-2px;z-index:6;}`}</style>
      {/* ── Majors heat grid (market overview + picker) ── */}
      <section className="rounded-md border border-border bg-card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Majors</h2>
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
        <p className="text-xs text-muted-foreground -mt-1">Click a pair to load it into the trade ticket.</p>

        {loading ? (
          <div className="skeleton rounded-sm w-full" style={{ height: 250 }} />
        ) : (
          <div className="flex flex-col gap-2">
            <Caption>USD quote</Caption>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px">
              {USD_QUOTE.map((sym) => (
                <PairTile key={sym} symbol={sym} cell={cellBySym.get(sym)} tf={tf} selected={selected === sym} onSelect={setSelected} />
              ))}
            </div>
            <Caption>USD base</Caption>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-px">
              {USD_BASE.map((sym) => (
                <PairTile key={sym} symbol={sym} cell={cellBySym.get(sym)} tf={tf} selected={selected === sym} onSelect={setSelected} />
              ))}
            </div>
            <UsdStrengthRibbon strength={usdStrength} dxy={dxy} tf={tf} />
          </div>
        )}
      </section>

      {/* ── ticket · detail ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-4">
          <TradeTicket
            accountId={accountId}
            onPlaced={onPlaced}
            assetClass="FOREX"
            fxSymbol={selected}
            onFxSymbolChange={setSelected}
          />
        </div>
        <div className="lg:col-span-8 flex flex-col gap-4">
          <PairDetail symbol={selected} spec={spec} cell={selectedCell} />
        </div>
      </div>
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "oklch(0.52 0.008 74)", letterSpacing: "0.07em" }}>
      {children}
    </p>
  );
}

/* ─── A single clickable pair tile ─── */
function PairTile({
  symbol, cell, tf, selected, onSelect,
}: {
  symbol: string;
  cell?: ForexCell;
  tf: ForexTimeframe;
  selected: boolean;
  onSelect: (s: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const reduce = usePrefersReducedMotion();
  const errored = !cell || cell.error;
  const pct = errored ? 0 : cell!.changePct;
  const positive = pct >= 0;

  let bg: string, borderColor: string, hoverBorder: string;
  if (errored) {
    bg = "oklch(0.105 0 0)"; borderColor = "oklch(0.18 0 0)"; hoverBorder = "oklch(0.3 0 0)";
  } else {
    const c = tileColor(pct, tf);
    bg = c.fill; borderColor = c.border; hoverBorder = c.hoverBorder;
  }
  const textShadow = "0 1px 2px oklch(0.06 0 0 / 0.7)";
  const ariaDir = errored ? "no data" : `${positive ? "up" : "down"} ${Math.abs(pct).toFixed(2)} percent`;

  return (
    <button
      onClick={() => onSelect(symbol)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      aria-pressed={selected}
      aria-label={`${FOREX_SPECS[symbol]?.name ?? symbol}, ${ariaDir}, select to trade`}
      className="fxtile relative flex flex-col items-start justify-between overflow-hidden text-left focus:outline-none"
      style={{
        height: 104, padding: 12,
        background: bg,
        border: `1px solid ${selected ? `oklch(${AMBER})` : hover ? hoverBorder : borderColor}`,
        boxShadow: selected ? `inset 0 0 0 2px oklch(${AMBER}), 0 0 0 1px oklch(${AMBER} / 0.5)` : "none",
        boxSizing: "border-box",
        filter: hover && !errored ? "brightness(1.12)" : "none",
        transition: reduce ? "none" : "filter 150ms ease, border-color 150ms ease",
        zIndex: selected ? 6 : hover ? 5 : 1,
        cursor: "pointer",
      }}
    >
      <span className="font-sans" style={{ fontSize: 12.5, fontWeight: 600, color: "oklch(0.99 0.005 74)", textShadow }}>
        {pairLabel(symbol)}
      </span>
      {errored ? (
        <span className="font-mono" style={{ fontSize: 11, color: "oklch(0.55 0.006 74)" }}>—</span>
      ) : (
        <div className="flex flex-col">
          <span className="font-mono tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: "oklch(0.99 0.005 74)", textShadow }}>
            {fxPx(symbol, cell!.price)}
          </span>
          <span className="font-mono tabular-nums" style={{ fontSize: 12.5, fontWeight: 700, color: "oklch(0.99 0.005 74)", textShadow, marginTop: 1 }}>
            {signedPct(pct)} <span style={{ fontWeight: 400, opacity: 0.75 }}>({cell!.change >= 0 ? "+" : ""}{fxPx(symbol, cell!.change)})</span>
          </span>
        </div>
      )}
    </button>
  );
}

/* ─── USD aggregate-strength ribbon (robust: USD is in all 7 pairs) ─── */
function UsdStrengthRibbon({ strength, dxy, tf }: { strength: number | null; dxy: { price: number; changePct: number } | null; tf: ForexTimeframe }) {
  const scale = FULL_SCALE[tf];
  const s = strength ?? 0;
  const positive = s >= 0;
  const fill = Math.min(1, Math.abs(s) / scale) * 50; // % width from center
  const tone = positive ? "var(--positive)" : "var(--negative)";
  const hue = positive ? EMERALD : RUBY;

  return (
    <div className="flex items-center gap-3 mt-1 px-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground whitespace-nowrap">USD strength</span>
      <div className="relative h-2 flex-1 rounded-sm overflow-hidden" style={{ background: "oklch(0.10 0 0)" }} role="img"
        aria-label={`US Dollar aggregate ${positive ? "strength" : "weakness"} ${Math.abs(s).toFixed(2)} percent over ${tf}, from 7 pairs`}>
        {strength != null && (
          <div className="absolute top-0 bottom-0" style={{ left: positive ? "50%" : `${50 - fill}%`, width: `${fill}%`, background: `oklch(${hue} / 0.8)` }} />
        )}
        <div className="absolute top-0 bottom-0" style={{ left: "50%", width: 1, background: "oklch(0.32 0 0)" }} />
      </div>
      <span className="font-mono tabular-nums text-xs whitespace-nowrap" style={{ color: strength != null ? tone : "oklch(0.64 0.008 74)" }}>
        {strength != null ? signedPct(s) : "—"}
      </span>
      <span className="text-[10px] px-1.5 py-0.5 rounded-sm whitespace-nowrap" style={{ background: "oklch(0.16 0 0)", color: "var(--steel)" }}>7 pairs</span>
      {dxy && (
        <span className="font-mono tabular-nums text-xs text-muted-foreground whitespace-nowrap" title="US Dollar Index">
          DXY {dxy.price.toFixed(2)}
        </span>
      )}
    </div>
  );
}

/* ─── Selected-pair detail: header + chart + specs ─── */
function PairDetail({ symbol, spec, cell }: { symbol: string; spec: ForexSpec | undefined; cell: ForexCell | null }) {
  if (!spec) {
    return (
      <section className="rounded-md border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">Select a pair to see details.</p>
      </section>
    );
  }
  const price = cell && !cell.error ? cell.price : null;
  const pct = cell && !cell.error ? cell.changePct : null;
  const tone = pct == null ? undefined : pct >= 0 ? "var(--positive)" : "var(--negative)";

  const pip = pipSizeFor(symbol);
  const pipVal = price != null ? pipValueUsd(symbol, price) : null;
  const notionalLot = price != null ? notionalUsd({ assetClass: "FOREX", symbol }, price, FOREX_STANDARD_LOT) : null;
  const marginLot = notionalLot != null ? notionalLot / FOREX_LEVERAGE : null;
  const base = symbol.slice(0, 3), quote = symbol.slice(3);

  return (
    <section className="rounded-md border border-border bg-card p-4 flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-medium text-foreground leading-tight">{spec.name}</h2>
          <p className="text-xs font-mono text-muted-foreground">{pairLabel(symbol)} · FX</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono tabular-nums leading-none text-foreground">
            {price != null ? fxPx(symbol, price) : "—"}
          </div>
          {pct != null && <div className="text-sm font-mono tabular-nums mt-1" style={{ color: tone }}>{signedPct(pct)}</div>}
        </div>
      </div>

      <PairChart symbol={symbol} />

      <div>
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Pair Specs</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-px rounded-sm overflow-hidden" style={{ background: "var(--border)" }}>
          <Spec label="Pip size" value={pip.toString()} />
          <Spec label="Pip value" value={pipVal != null ? formatCurrency(pipVal) : "—"} hint="per standard lot" />
          <Spec label="Leverage" value={`${FOREX_LEVERAGE}:1`} />
          <Spec label="Standard lot" value={FOREX_STANDARD_LOT.toLocaleString()} hint="units" />
          <Spec label="Margin / lot" value={marginLot != null ? formatCurrency(marginLot) : "—"} hint={`notional ÷ ${FOREX_LEVERAGE}`} />
          <Spec label="Base · Quote" value={`${base} · ${quote}`} />
        </div>
        <div className="flex items-center justify-between mt-2 px-1">
          <span className="text-xs text-muted-foreground">Notional · 1 standard lot</span>
          <span className="text-sm font-mono tabular-nums text-foreground">{notionalLot != null ? formatCurrency(notionalLot) : "—"}</span>
        </div>
      </div>
    </section>
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

/* ─── Per-pair price chart with range toggle ─── */
const CHART_RANGES: SeriesRange[] = ["1D", "5D", "1M", "6M", "YTD"];

function PairChart({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<SeriesRange>("1M");
  const [series, setSeries] = useState<{ date: string; price: number }[] | null>(null);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSeries(null);
    // Yahoo wants the "=X" suffix for FX.
    fetch(`/api/paper/series?symbol=${encodeURIComponent(`${symbol}=X`)}&range=${range}`)
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
  const gid = `fx-${symbol.replace(/[^a-zA-Z0-9]/g, "")}`;

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
                tickFormatter={(v: number) => fxPx(symbol, v)}
                domain={["auto", "auto"]}
                width={60}
                stroke="oklch(0.20 0 0)"
              />
              <Tooltip
                contentStyle={{ background: "oklch(0.12 0 0)", border: "1px solid oklch(0.20 0 0)", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "oklch(0.64 0.008 74)" }}
                labelFormatter={(d) => (intraday ? String(d).slice(0, 16).replace("T", " ") : String(d))}
                formatter={(v) => [fxPx(symbol, Number(v)), "Price"] as [string, string]}
              />
              <Area type="monotone" dataKey="price" stroke={color} strokeWidth={1.5} fill={`url(#${gid})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

/* ─── Color legend ─── */
function Legend({ tf }: { tf: ForexTimeframe }) {
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
