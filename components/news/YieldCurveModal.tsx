"use client";

import { useEffect, useRef } from "react";
import nextDynamic from "next/dynamic";
import type { TreasuryCurve } from "@/lib/treasury-curve";

/* Recharts (SSR-disabled — project convention) */
const LineChart = nextDynamic(() => import("recharts").then((m) => m.LineChart), { ssr: false });
const Line = nextDynamic(() => import("recharts").then((m) => m.Line), { ssr: false });
const XAxis = nextDynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = nextDynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const Tooltip = nextDynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const CartesianGrid = nextDynamic(() => import("recharts").then((m) => m.CartesianGrid), { ssr: false });
const ResponsiveContainer = nextDynamic(() => import("recharts").then((m) => m.ResponsiveContainer), { ssr: false });

function tenorLabel(years: number): string {
  if (years < 1) return `${Math.round(years * 12)}M`;
  return `${Math.round(years)}Y`;
}
function yieldAt(curve: TreasuryCurve, years: number): number | null {
  const p = curve.points.find((pt) => Math.abs(pt.years - years) < 1e-6);
  return p ? p.yield : null;
}

const SPREADS: { label: string; a: number; b: number }[] = [
  { label: "2s10s", a: 2, b: 10 },
  { label: "3m10y", a: 0.25, b: 10 },
  { label: "5s30s", a: 5, b: 30 },
  { label: "2s30s", a: 2, b: 30 },
];

export function YieldCurveModal({
  open,
  onClose,
  curve,
}: {
  open: boolean;
  onClose: () => void;
  curve: TreasuryCurve;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  const data = curve.points.map((p) => ({ t: tenorLabel(p.years), y: p.yield }));

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="app-dialog m-auto max-h-[94vh] w-[min(96vw,900px)] overflow-y-auto rounded-md border border-border bg-popover p-0 text-foreground"
    >
      <div className="flex flex-col gap-5 p-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2 min-w-0">
            <h2 className="text-lg font-medium text-foreground truncate">U.S. Treasury Yield Curve</h2>
            <span className="text-xs text-muted-foreground shrink-0">par yields · {curve.asOf}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Big chart */}
        <div style={{ height: 360 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 20, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="oklch(0.18 0 0)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="t" interval={0} tick={{ fontSize: 11, fill: "oklch(0.64 0.008 74)" }} stroke="oklch(0.24 0 0)" />
              <YAxis
                tick={{ fontSize: 11, fill: "oklch(0.64 0.008 74)" }}
                tickFormatter={(v: number) => `${v.toFixed(1)}%`}
                domain={["auto", "auto"]}
                width={46}
                stroke="oklch(0.24 0 0)"
              />
              <Tooltip
                contentStyle={{ background: "oklch(0.12 0 0)", border: "1px solid oklch(0.20 0 0)", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "oklch(0.64 0.008 74)" }}
                formatter={(v) => [`${Number(v).toFixed(2)}%`, "Yield"] as [string, string]}
              />
              <Line type="monotone" dataKey="y" stroke="var(--steel)" strokeWidth={2} dot={{ r: 2.5, fill: "var(--steel)" }} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Full tenor table */}
        <div>
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">All tenors</h3>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-px rounded-sm overflow-hidden" style={{ background: "var(--border)" }}>
            {curve.points.map((p) => (
              <div key={p.years} className="bg-card px-3 py-2 flex flex-col">
                <span className="text-muted-foreground" style={{ fontSize: "0.6rem" }}>{tenorLabel(p.years)}</span>
                <span className="text-sm font-mono text-foreground">{p.yield.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Spread analysis */}
        <div>
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Curve spreads</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-sm overflow-hidden" style={{ background: "var(--border)" }}>
            {SPREADS.map((s) => {
              const ya = yieldAt(curve, s.a);
              const yb = yieldAt(curve, s.b);
              const bp = ya != null && yb != null ? (yb - ya) * 100 : null;
              const inv = bp != null && bp < 0;
              return (
                <div key={s.label} className="bg-card px-3 py-2 flex flex-col">
                  <span className="text-muted-foreground" style={{ fontSize: "0.6rem" }}>{s.label}</span>
                  <span className="text-sm font-mono" style={{ color: bp == null ? "var(--foreground)" : inv ? "var(--negative)" : "var(--positive)" }}>
                    {bp == null ? "—" : `${bp > 0 ? "+" : ""}${bp.toFixed(0)}bp`}
                  </span>
                  {inv && <span className="text-[10px]" style={{ color: "var(--negative)" }}>inverted</span>}
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Source: {curve.source === "treasury" ? "U.S. Treasury daily par yield curve" : "Yahoo (approximate 4-point curve)"}.
          {" "}An inverted spread (short &gt; long) has historically preceded recessions.
        </p>
      </div>
    </dialog>
  );
}
