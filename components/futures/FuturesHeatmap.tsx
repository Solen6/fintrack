"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import type { FutureCell, FuturesTimeframe } from "@/app/api/futures/route";

const TF_OPTIONS: FuturesTimeframe[] = ["1D", "1W", "1M", "YTD"];

// % move that maps to full color intensity, per timeframe
const FULL_SCALE: Record<FuturesTimeframe, number> = {
  "1D": 3,
  "1W": 6,
  "1M": 12,
  "YTD": 40,
};

const CATEGORY_ORDER = ["Energy", "Metals", "Indices", "Rates", "Currencies", "Agriculture"];

function cellStyle(changePct: number, tf: FuturesTimeframe): React.CSSProperties {
  const scale = FULL_SCALE[tf];
  const intensity = Math.min(1, Math.abs(changePct) / scale);
  const alpha = (0.08 + intensity * 0.55).toFixed(3);
  const hue = changePct >= 0 ? "0.72 0.15 152" : "0.66 0.19 25"; // emerald / ruby
  return {
    background: `oklch(${hue} / ${alpha})`,
    borderColor: `oklch(${hue} / ${(Number(alpha) + 0.15).toFixed(3)})`,
  };
}

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

  const grouped = useMemo(() => {
    const map = new Map<string, FutureCell[]>();
    for (const c of cells) {
      if (c.error) continue;
      if (!map.has(c.category)) map.set(c.category, []);
      map.get(c.category)!.push(c);
    }
    return CATEGORY_ORDER.filter((cat) => map.has(cat)).map((cat) => ({
      category: cat,
      items: map.get(cat)!,
    }));
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

        <p className="text-xs text-muted-foreground">% change · colored by move</p>

        {lastRefreshed && (
          <p className="ml-auto text-xs text-muted-foreground">
            As of {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <p className="text-sm text-muted-foreground animate-pulse">Loading futures…</p>
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

function FutureTile({ c, tf }: { c: FutureCell; tf: FuturesTimeframe }) {
  const positive = c.changePct >= 0;
  return (
    <div
      className="rounded-sm border px-3 py-2.5 flex flex-col gap-1"
      style={cellStyle(c.changePct, tf)}
      title={`${c.name} (${c.symbol})`}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-sm font-medium text-foreground truncate">{c.name}</span>
      </div>
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-xs font-mono text-muted-foreground">
          {c.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}
        </span>
        <span className="text-sm font-mono font-medium text-foreground">
          {positive ? "+" : ""}{c.changePct.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}
