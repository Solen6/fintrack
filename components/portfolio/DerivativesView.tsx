"use client";

import { useMemo } from "react";
import type { HoldingWithMetrics } from "@/lib/types";
import { isDerivative } from "@/lib/types";
import { formatCurrency, formatPercent } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";

interface Props {
  holdings: HoldingWithMetrics[];
  onClose?: (holding: HoldingWithMetrics) => void;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

function dte(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

export function DerivativesView({ holdings, onClose }: Props) {
  const rows = useMemo(() => holdings.filter(isDerivative), [holdings]);

  const stats = useMemo(() => {
    const totalValue = rows.reduce((s, r) => s + r.value, 0);
    const totalGain = rows.reduce((s, r) => s + r.gainDollar, 0);
    const longs = rows.filter((r) => r.direction !== "SHORT").length;
    const shorts = rows.filter((r) => r.direction === "SHORT").length;
    return { totalValue, totalGain, longs, shorts, count: rows.length };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          No options or futures yet — use “Add” → “Option” or “Future” to track a position.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-sm overflow-hidden">
        <Stat label="Market value"><Sensitive>{formatCurrency(stats.totalValue)}</Sensitive></Stat>
        <Stat label="Unrealized P/L">
          <span style={{ color: stats.totalGain >= 0 ? "var(--positive)" : "var(--negative)" }}>
            <Sensitive>{stats.totalGain >= 0 ? "+" : ""}{formatCurrency(stats.totalGain)}</Sensitive>
          </span>
        </Stat>
        <Stat label="Positions">{stats.count}</Stat>
        <Stat label="Long / Short">{stats.longs} / {stats.shorts}</Stat>
      </div>

      <section className="bg-card border border-border rounded-sm overflow-x-auto">
        <table className="w-full text-xs min-w-[900px]">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="px-3 py-2 font-medium">Position</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Direction</th>
              <th className="px-3 py-2 font-medium text-right">Strike</th>
              <th className="px-3 py-2 font-medium text-right">Expiry</th>
              <th className="px-3 py-2 font-medium text-right">Contracts</th>
              <th className="px-3 py-2 font-medium text-right">Entry</th>
              <th className="px-3 py-2 font-medium text-right">Live</th>
              <th className="px-3 py-2 font-medium text-right">Value</th>
              <th className="px-3 py-2 font-medium text-right">P/L</th>
              <th className="px-3 py-2 font-medium text-right">P/L %</th>
              <th className="px-3 py-2 font-medium text-center">Account</th>
              {onClose && <th className="px-3 py-2 font-medium text-center">Actions</th>}
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((r) => {
              const isOption = r.instrumentType === "option";
              const multiplier = r.multiplier || 1;
              const contracts = Math.abs(r.shares) / multiplier;
              const short = r.direction === "SHORT";
              const gainColor = r.gainDollar >= 0 ? "var(--positive)" : "var(--negative)";
              const days = isOption ? dte(r.expiry) : null;
              return (
                <tr key={r.id} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2 font-sans text-foreground max-w-[200px] truncate" title={r.name}>
                    {r.underlying ?? r.ticker}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {isOption ? (r.optionType === "PUT" ? "Put" : "Call") : "Future"}
                  </td>
                  <td className="px-3 py-2">
                    <span style={{ color: short ? "var(--negative)" : "var(--positive)" }}>
                      {short ? "Short" : "Long"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">{isOption ? formatCurrency(r.strike ?? 0) : "—"}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">
                    {isOption ? (
                      <>
                        {fmtDate(r.expiry)}
                        {days != null && <span className="ml-1">({days <= 0 ? "expired" : `${days}d`})</span>}
                      </>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">{contracts % 1 === 0 ? contracts : contracts.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(r.costBasis)}</td>
                  <td className="px-3 py-2 text-right text-foreground">{formatCurrency(r.currentPrice)}</td>
                  <td className="px-3 py-2 text-right text-foreground"><Sensitive>{formatCurrency(r.value)}</Sensitive></td>
                  <td className="px-3 py-2 text-right" style={{ color: gainColor }}>
                    <Sensitive>{r.gainDollar >= 0 ? "+" : ""}{formatCurrency(r.gainDollar)}</Sensitive>
                  </td>
                  <td className="px-3 py-2 text-right" style={{ color: gainColor }}>
                    <Sensitive>{formatPercent(r.gainPercent)}</Sensitive>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className="inline-block text-xs px-2 py-0.5 rounded-sm"
                      style={{ background: "oklch(0.16 0 0)", color: "oklch(0.52 0.008 74)" }}
                    >
                      {r.account}
                    </span>
                  </td>
                  {onClose && (
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => onClose(r)}
                        className="text-xs px-1.5 py-0.5 rounded-sm hover:bg-accent transition-colors"
                        style={{ color: "var(--negative)" }}
                        title="Close position"
                      >
                        Close
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-card px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-mono text-foreground mt-0.5">{children}</div>
    </div>
  );
}
