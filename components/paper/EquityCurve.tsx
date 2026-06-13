"use client";

import { useEffect, useState } from "react";
import nextDynamic from "next/dynamic";
import { formatCurrency } from "@/lib/format";

const AreaChart = nextDynamic(() => import("recharts").then((m) => m.AreaChart), { ssr: false });
const Area = nextDynamic(() => import("recharts").then((m) => m.Area), { ssr: false });
const XAxis = nextDynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = nextDynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const Tooltip = nextDynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const ResponsiveContainer = nextDynamic(() => import("recharts").then((m) => m.ResponsiveContainer), { ssr: false });

interface Snap { date: string; equity: number; cash: number }

export function EquityCurve({ accountId, refreshKey }: { accountId: string; refreshKey: number }) {
  const [snaps, setSnaps] = useState<Snap[] | null>(null);
  const [startingCash, setStartingCash] = useState(100_000);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/paper/snapshots?account=${encodeURIComponent(accountId)}`);
        const json = await res.json();
        if (cancelled || !res.ok) return;
        setSnaps(json.snapshots ?? []);
        setStartingCash(json.startingCash ?? 100_000);
      } catch { /* leave null */ }
    })();
    return () => { cancelled = true; };
  }, [accountId, refreshKey]);

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Equity Curve</h2>
      {snaps === null ? (
        <div className="skeleton rounded-md" style={{ height: 200 }} />
      ) : snaps.length < 2 ? (
        <div className="flex flex-col items-center justify-center text-center gap-1 py-12">
          <p className="text-sm text-foreground">Tracking from today</p>
          <p className="text-xs text-muted-foreground">
            Your equity is snapshotted once a day. The curve appears after a couple of days of activity.
          </p>
        </div>
      ) : (
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={snaps} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "oklch(0.64 0.008 74)" }}
                tickFormatter={(d: string) => d.slice(5)}
                stroke="oklch(0.20 0 0)"
              />
              <YAxis
                tick={{ fontSize: 10, fill: "oklch(0.64 0.008 74)" }}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                domain={["auto", "auto"]}
                width={44}
                stroke="oklch(0.20 0 0)"
              />
              <Tooltip
                contentStyle={{ background: "oklch(0.12 0 0)", border: "1px solid oklch(0.20 0 0)", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "oklch(0.64 0.008 74)" }}
                formatter={(v) => [formatCurrency(Number(v)), "Equity"] as [string, string]}
              />
              <Area
                type="monotone"
                dataKey="equity"
                stroke="var(--primary)"
                strokeWidth={1.5}
                fill="url(#eqFill)"
                isAnimationActive={false}
                baseValue={startingCash}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
