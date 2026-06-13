"use client";

import { useState, useMemo } from "react";
import nextDynamic from "next/dynamic";
import type { HoldingWithMetrics } from "@/lib/types";

const HoldingsTreemap = nextDynamic(
  () => import("./HoldingsTreemap").then((m) => m.HoldingsTreemap),
  { ssr: false, loading: () => <div className="skeleton h-full w-full rounded-sm" /> }
);

interface Props {
  holdings: HoldingWithMetrics[];
  account: string;
}

const EMERALD = "0.72 0.15 152";
const RUBY = "0.66 0.19 25";

export function HoldingsHeatmap({ holdings, account }: Props) {
  const [colorBy, setColorBy] = useState<"daily" | "total">("daily");
  const [includeCash, setIncludeCash] = useState(true);

  const filtered = useMemo(() => {
    // 1. Account filter
    let list = account === "all"
      ? holdings
      : holdings.filter((h) => h.account === account);

    // 2. Cash filter
    if (!includeCash) {
      list = list.filter((h) => {
        const t = h.ticker.toUpperCase();
        const s = h.sector.toLowerCase();
        const a = h.account.toLowerCase();
        const isCash = t === "CASH" || s === "cash" || ["cash", "hysa", "checking", "savings"].some((w) => a.includes(w));
        return !isCash;
      });
    }

    return list;
  }, [holdings, account, includeCash]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-[400px]">
      {/* Heatmap Toolbar */}
      <div className="px-6 py-3 border-b border-border shrink-0 flex items-center gap-4 flex-wrap bg-sidebar/40">
        {/* Color by option */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Color by:</span>
          <div className="flex items-center rounded-sm border border-border overflow-hidden">
            <button
              onClick={() => setColorBy("daily")}
              className="text-xs px-2.5 py-1 transition-colors duration-150"
              style={{
                background: colorBy === "daily" ? "oklch(0.16 0 0)" : "transparent",
                color: colorBy === "daily" ? "var(--primary)" : "oklch(0.64 0.008 74)",
              }}
            >
              Daily Change
            </button>
            <button
              onClick={() => setColorBy("total")}
              className="text-xs px-2.5 py-1 transition-colors duration-150"
              style={{
                background: colorBy === "total" ? "oklch(0.16 0 0)" : "transparent",
                color: colorBy === "total" ? "var(--primary)" : "oklch(0.64 0.008 74)",
              }}
            >
              Total Return
            </button>
          </div>
        </div>

        {/* Cash toggle */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Cash:</span>
          <div className="flex items-center rounded-sm border border-border overflow-hidden">
            <button
              onClick={() => setIncludeCash(true)}
              className="text-xs px-2.5 py-1 transition-colors duration-150"
              style={{
                background: includeCash ? "oklch(0.16 0 0)" : "transparent",
                color: includeCash ? "var(--primary)" : "oklch(0.64 0.008 74)",
              }}
            >
              Include Cash
            </button>
            <button
              onClick={() => setIncludeCash(false)}
              className="text-xs px-2.5 py-1 transition-colors duration-150"
              style={{
                background: !includeCash ? "oklch(0.16 0 0)" : "transparent",
                color: !includeCash ? "var(--primary)" : "oklch(0.64 0.008 74)",
              }}
            >
              Exclude Cash
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2" aria-hidden>
          <span className="text-xs font-mono text-muted-foreground">
            {colorBy === "daily" ? "−3%" : "−20%"}
          </span>
          <div
            className="h-2.5 w-24 rounded-sm border border-border"
            style={{
              background: `linear-gradient(to right,
                oklch(${RUBY} / 0.63),
                oklch(${RUBY} / 0.10),
                oklch(0.20 0 0),
                oklch(${EMERALD} / 0.10),
                oklch(${EMERALD} / 0.63))`,
            }}
          />
          <span className="text-xs font-mono text-muted-foreground">
            {colorBy === "daily" ? "+3%" : "+20%"}
          </span>
        </div>
      </div>

      {/* Treemap Area */}
      <div className="flex-1 p-6 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No positions to show in heatmap.</p>
          </div>
        ) : (
          <HoldingsTreemap holdings={filtered} colorBy={colorBy} />
        )}
      </div>
    </div>
  );
}
