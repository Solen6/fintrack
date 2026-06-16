"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import nextDynamic from "next/dynamic";
import type { FutureCell, FuturesTimeframe } from "@/app/api/futures/route";

const FuturesTreemap = nextDynamic(
  () => import("@/components/futures/FuturesTreemap").then((m) => m.FuturesTreemap),
  { ssr: false, loading: () => <div className="skeleton h-full w-full rounded-sm" /> }
);

type ViewMode = "grid" | "treemap";

const TF_OPTIONS: FuturesTimeframe[] = ["1D", "1W", "1M", "YTD"];

// % move that maps to full color intensity, per timeframe
const FULL_SCALE: Record<FuturesTimeframe, number> = {
  "1D": 3,
  "1W": 6,
  "1M": 12,
  "YTD": 40,
};

const CATEGORY_ORDER = ["Energy", "Metals", "Agriculture", "Indices", "Rates", "Currencies"];

const EMERALD = "0.72 0.15 152";
const RUBY = "0.66 0.19 25";

function cellStyle(changePct: number, tf: FuturesTimeframe): React.CSSProperties {
  const scale = FULL_SCALE[tf];
  // Power curve + raised floor so even small moves read clearly as green/red.
  const intensity = Math.min(1, Math.abs(changePct) / scale) ** 0.7;
  const alpha = (0.22 + intensity * 0.58).toFixed(3);
  const hue = changePct >= 0 ? EMERALD : RUBY;
  return {
    background: `oklch(${hue} / ${alpha})`,
    borderColor: `oklch(${hue} / ${(Number(alpha) + 0.18).toFixed(3)})`,
    // Dark shadow keeps text legible over the colored tile.
    textShadow: "0 1px 2px oklch(0.08 0 0 / 0.85)",
  };
}

function fmtPrice(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtChange(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function FuturesHeatmap() {
  const [cells, setCells] = useState<FutureCell[]>([]);
  const [timeframe, setTimeframe] = useState<FuturesTimeframe>("1D");
  const [view, setView] = useState<ViewMode>("grid");
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

  // Group by category; valid cells sorted by move size (desc), errored cells last.
  const grouped = useMemo(() => {
    const map = new Map<string, { valid: FutureCell[]; errored: FutureCell[] }>();
    for (const c of cells) {
      if (!map.has(c.category)) map.set(c.category, { valid: [], errored: [] });
      const bucket = map.get(c.category)!;
      if (c.error) bucket.errored.push(c);
      else bucket.valid.push(c);
    }
    return CATEGORY_ORDER.filter((cat) => map.has(cat)).map((cat) => {
      const { valid, errored } = map.get(cat)!;
      valid.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
      return { category: cat, items: [...valid, ...errored] };
    });
  }, [cells]);

  // Biggest movers across all valid cells
  const movers = useMemo(() => {
    const valid = cells.filter((c) => !c.error);
    const byMove = [...valid].sort((a, b) => b.changePct - a.changePct);
    return {
      gainers: byMove.slice(0, 3),
      losers: byMove.slice(-3).reverse(),
    };
  }, [cells]);

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0 flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-medium text-foreground leading-none">Futures</h2>

        {/* Timeframe selector */}
        <div className="relative" ref={tfRef}>
          <button
            onClick={() => setTfOpen((o) => !o)}
            className="flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-sm border border-border text-foreground hover:border-foreground/30 transition-colors duration-150"
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

        {/* View toggle */}
        <div className="flex items-center rounded-sm border border-border overflow-hidden">
          {(["grid", "treemap"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="text-xs px-2.5 py-1 transition-colors duration-150 capitalize"
              style={{
                background: view === v ? "oklch(0.16 0 0)" : "transparent",
                color: view === v ? "var(--primary)" : "oklch(0.64 0.008 74)",
              }}
              aria-pressed={view === v}
            >
              {v}
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">% change · colored by move</p>

        {/* Color legend */}
        <Legend tf={timeframe} />

        {lastRefreshed && (
          <p className="ml-auto text-xs text-muted-foreground">
            As of {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        )}
      </div>

      {/* Movers strip */}
      {!loading && (movers.gainers.length > 0 || movers.losers.length > 0) && (
        <div className="px-6 py-2.5 border-b border-border shrink-0 flex items-center gap-x-6 gap-y-1.5 flex-wrap">
          <MoversGroup label="Top gainers" items={movers.gainers} />
          <MoversGroup label="Top losers" items={movers.losers} />
        </div>
      )}

      {/* Grid / Treemap */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <LoadingSkeleton />
        ) : view === "treemap" ? (
          <div className="h-full min-h-[480px]">
            <FuturesTreemap cells={cells} tf={timeframe} />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {grouped.map(({ category, items }) => (
              <section key={category}>
                <p className="text-xs font-medium text-muted-foreground mb-2.5" style={{ letterSpacing: "0.04em" }}>
                  {category}
                </p>
                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))" }}
                >
                  {items.map((c) => (
                    <FutureTile key={c.symbol} c={c} tf={timeframe} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
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

/* ─── Movers strip group ─── */
function MoversGroup({ label, items }: { label: string; items: FutureCell[] }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {items.map((c) => {
          const positive = c.changePct >= 0;
          return (
            <span
              key={c.symbol}
              className="text-xs font-mono px-1.5 py-0.5 rounded-sm"
              style={{
                background: positive ? `oklch(${EMERALD} / 0.12)` : `oklch(${RUBY} / 0.12)`,
                color: positive ? "var(--positive)" : "var(--negative)",
              }}
              title={`${c.name} (${c.symbol})`}
            >
              {c.name} {positive ? "+" : ""}{c.changePct.toFixed(2)}%
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Skeleton tiles ─── */
function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {[8, 5].map((count, i) => (
        <section key={i}>
          <div className="skeleton h-3 w-20 mb-2.5 rounded-sm" />
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))" }}
          >
            {Array.from({ length: count }).map((_, j) => (
              <div key={j} className="skeleton rounded-sm" style={{ height: 64 }} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function FutureTile({ c, tf }: { c: FutureCell; tf: FuturesTimeframe }) {
  if (c.error) {
    return (
      <div
        className="rounded-sm border border-dashed px-3 py-2.5 flex flex-col gap-1 opacity-60"
        style={{ borderColor: "oklch(0.26 0 0)", background: "oklch(0.11 0 0)" }}
        title={`${c.name} (${c.symbol}) — no data`}
      >
        <div className="flex items-baseline justify-between gap-1">
          <span className="text-sm font-medium text-muted-foreground truncate">{c.name}</span>
          <span className="font-mono text-muted-foreground" style={{ fontSize: "0.6rem" }}>
            {c.symbol}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">no data</span>
      </div>
    );
  }

  const positive = c.changePct >= 0;
  return (
    <div
      className="rounded-sm border px-3 py-2.5 flex flex-col gap-1"
      style={cellStyle(c.changePct, tf)}
      title={`${c.name} (${c.symbol})\nPrice ${fmtPrice(c.price)}\nChange ${fmtChange(c.change)} (${positive ? "+" : ""}${c.changePct.toFixed(2)}%)`}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-sm font-semibold text-foreground truncate">{c.name}</span>
        <span className="font-mono text-foreground/70 shrink-0" style={{ fontSize: "0.6rem" }}>
          {c.symbol}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-xs font-mono text-foreground/70">{fmtPrice(c.price)}</span>
        <span className="text-sm font-mono font-semibold text-foreground">
          {positive ? "+" : ""}{c.changePct.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}
