"use client";

import { useEffect, useState } from "react";
import type { MacroRateItem } from "@/app/api/macro/route";

export function MacroPanel() {
  const [rates, setRates] = useState<MacroRateItem[]>([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/macro")
      .then((r) => r.json())
      .then((d) => {
        setRates(d.rates ?? []);
        setUpdatedAt(d.updatedAt ? new Date(d.updatedAt) : null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-r border-border flex flex-col">
      {/* Rates */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-medium text-foreground leading-none">Rates &amp; Macro</h2>
          {updatedAt && (
            <p className="text-xs" style={{ color: "oklch(0.38 0.008 74)" }}>
              {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>

        {loading ? <RatesSkeleton /> : (
          <div className="flex flex-col gap-2.5">
            {rates.map((r) => <RateRow key={r.label} rate={r} />)}
          </div>
        )}
      </div>
    </aside>
  );
}

/* ─── Single rate row ─── */
function RateRow({ rate: r }: { rate: MacroRateItem }) {
  const positive = r.change > 0;
  const negative = r.change < 0;
  const changeColor = positive
    ? "var(--positive)"
    : negative
    ? "var(--negative)"
    : "oklch(0.44 0.008 74)";

  const changeLabel =
    r.change === 0
      ? null
      : r.unit === "bps"
      ? `${r.change > 0 ? "+" : ""}${r.change}bp`
      : `${r.change > 0 ? "+" : ""}${r.change}%`;

  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <span className="text-sm text-muted-foreground">{r.label}</span>
        {r.note && (
          <p className="text-muted-foreground" style={{ fontSize: "0.65rem", opacity: 0.6 }}>
            {r.note}
          </p>
        )}
      </div>
      <div className="flex items-baseline gap-2 shrink-0">
        <span className="text-sm font-mono text-foreground">{r.value}</span>
        {changeLabel && (
          <span className="text-xs font-mono" style={{ color: changeColor }}>
            {changeLabel}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Loading skeleton ─── */
function RatesSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 animate-pulse">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <div className="h-4 w-24 rounded-sm" style={{ background: "oklch(0.16 0 0)" }} />
          <div className="h-4 w-14 rounded-sm" style={{ background: "oklch(0.16 0 0)" }} />
        </div>
      ))}
    </div>
  );
}
