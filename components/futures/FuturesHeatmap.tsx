"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import nextDynamic from "next/dynamic";
import type { FutureCell, FuturesTimeframe } from "@/app/api/futures/route";

const FuturesTreemap = nextDynamic(
  () => import("@/components/futures/FuturesTreemap").then((m) => m.FuturesTreemap),
  { ssr: false, loading: () => <div className="skeleton h-full w-full rounded-sm" /> }
);

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

export function FuturesHeatmap() {
  const [cells, setCells] = useState<FutureCell[]>([]);
  const [timeframe, setTimeframe] = useState<FuturesTimeframe>("1D");
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

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
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
          <MoversGroup label="Top gainers" items={movers.gainers} />
          <MoversGroup label="Top losers" items={movers.losers} />
        </div>
      )}

      {/* Treemap */}
      {loading ? (
        <div className="flex-1 min-h-0 p-px">
          <div className="skeleton h-full w-full rounded-sm" />
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <FuturesTreemap cells={cells} tf={timeframe} />
        </div>
      )}
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

