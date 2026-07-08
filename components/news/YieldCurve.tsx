"use client";

import { useEffect, useState } from "react";
import nextDynamic from "next/dynamic";
import type { TreasuryCurve } from "@/lib/treasury-curve";
import { YieldCurveModal } from "./YieldCurveModal";

/* Recharts (SSR-disabled — project convention) */
const LineChart = nextDynamic(() => import("recharts").then((m) => m.LineChart), { ssr: false });
const Line = nextDynamic(() => import("recharts").then((m) => m.Line), { ssr: false });
const XAxis = nextDynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = nextDynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const Tooltip = nextDynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const ResponsiveContainer = nextDynamic(() => import("recharts").then((m) => m.ResponsiveContainer), { ssr: false });

function tenorLabel(years: number): string {
  if (years < 1) return `${Math.round(years * 12)}M`;
  return `${Math.round(years)}Y`;
}

function yieldAt(curve: TreasuryCurve, years: number): number | null {
  const p = curve.points.find((pt) => Math.abs(pt.years - years) < 1e-6);
  return p ? p.yield : null;
}

export function YieldCurve() {
  const [curve, setCurve] = useState<TreasuryCurve | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch("/api/treasury-curve")
      .then((r) => r.json())
      .then((d) => setCurve(d.curve ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="px-5 py-4 border-b border-border">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-medium text-foreground leading-none">Yield Curve</h2>
        <div className="flex items-center gap-2">
          {curve && (
            <p className="text-xs" style={{ color: "oklch(0.38 0.008 74)" }}>
              {curve.asOf.slice(5)}
            </p>
          )}
          {curve && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label="Expand yield curve"
              title="Expand"
              className="grid h-6 w-6 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="h-[150px] rounded-sm animate-pulse" style={{ background: "oklch(0.16 0 0)" }} />
      ) : !curve ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Yield curve unavailable.</p>
      ) : (
        <div onClick={() => setExpanded(true)} style={{ cursor: "zoom-in" }} title="Click to expand">
          <Curve curve={curve} />
        </div>
      )}

      {curve && <YieldCurveModal open={expanded} onClose={() => setExpanded(false)} curve={curve} />}
    </div>
  );
}

function Curve({ curve }: { curve: TreasuryCurve }) {
  const data = curve.points.map((p) => ({ t: tenorLabel(p.years), y: p.yield }));
  const preferred = ["3M", "1Y", "2Y", "5Y", "10Y", "30Y"];
  const present = new Set(data.map((d) => d.t));
  const ticks = preferred.filter((t) => present.has(t));

  const y2 = yieldAt(curve, 2);
  const y10 = yieldAt(curve, 10);
  const spread = y2 != null && y10 != null ? (y10 - y2) * 100 : null; // bps
  const inverted = spread != null && spread < 0;

  const keyPoints: { label: string; years: number }[] = [
    { label: "3M", years: 0.25 },
    { label: "2Y", years: 2 },
    { label: "10Y", years: 10 },
    { label: "30Y", years: 30 },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div style={{ height: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
            <XAxis
              dataKey="t"
              ticks={ticks.length ? ticks : undefined}
              tick={{ fontSize: 9, fill: "oklch(0.64 0.008 74)" }}
              stroke="oklch(0.20 0 0)"
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "oklch(0.64 0.008 74)" }}
              tickFormatter={(v: number) => v.toFixed(1)}
              domain={["auto", "auto"]}
              width={34}
              stroke="oklch(0.20 0 0)"
            />
            <Tooltip
              contentStyle={{ background: "oklch(0.12 0 0)", border: "1px solid oklch(0.20 0 0)", borderRadius: 6, fontSize: 11 }}
              labelStyle={{ color: "oklch(0.64 0.008 74)" }}
              formatter={(v) => [`${Number(v).toFixed(2)}%`, "Yield"] as [string, string]}
            />
            <Line
              type="monotone"
              dataKey="y"
              stroke="var(--steel)"
              strokeWidth={1.75}
              dot={{ r: 1.5, fill: "var(--steel)" }}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Key tenors */}
      <div className="grid grid-cols-4 gap-1.5">
        {keyPoints.map((k) => {
          const v = yieldAt(curve, k.years);
          return (
            <div key={k.label} className="flex flex-col">
              <span className="text-muted-foreground" style={{ fontSize: "0.6rem" }}>{k.label}</span>
              <span className="text-xs font-mono text-foreground">{v != null ? `${v.toFixed(2)}%` : "—"}</span>
            </div>
          );
        })}
      </div>

      {/* 2s10s spread — inversion signal */}
      {spread != null && (
        <div className="flex items-center justify-between pt-1 border-t border-border/60">
          <span className="text-xs text-muted-foreground">2s10s spread</span>
          <span
            className="text-xs font-mono"
            style={{ color: inverted ? "var(--negative)" : "var(--positive)" }}
          >
            {spread > 0 ? "+" : ""}{spread.toFixed(0)}bp{inverted ? " · inverted" : ""}
          </span>
        </div>
      )}

      {curve.source === "yahoo" && (
        <p className="text-muted-foreground" style={{ fontSize: "0.6rem", opacity: 0.7 }}>
          Approx. (4-point) — Treasury feed unavailable.
        </p>
      )}
    </div>
  );
}
