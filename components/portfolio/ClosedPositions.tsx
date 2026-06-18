"use client";

import { useState, useEffect } from "react";
import { formatCurrency, formatShares } from "@/lib/format";

interface ClosedPosition {
  id: string;
  ticker: string;
  name: string;
  shares: number;
  cost_basis: number;
  sale_price: number;
  realized_gain: number;
  account: string;
  closed_at: string;
  notes: string | null;
}

export function ClosedPositions() {
  const [positions, setPositions] = useState<ClosedPosition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/holdings/closed")
      .then((r) => r.json())
      .then((d) => setPositions(d.closed ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground animate-pulse">Loading closed positions…</p>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No closed positions yet.</p>
      </div>
    );
  }

  const totalGain = positions.reduce((s, p) => s + p.realized_gain, 0);

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-6 py-3 border-b border-border flex items-center gap-4">
        <span className="text-xs text-muted-foreground">
          {positions.length} closed position{positions.length !== 1 ? "s" : ""}
        </span>
        <span
          className="text-xs font-mono font-medium"
          style={{ color: totalGain >= 0 ? "var(--positive)" : "var(--negative)" }}
        >
          Total realized: {totalGain >= 0 ? "+" : ""}{formatCurrency(totalGain)}
        </span>
      </div>
      <table className="w-full text-sm border-collapse min-w-[700px]">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-left">Ticker</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-left min-w-[140px]">Name</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right">Shares</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right">Cost Basis</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right">Sale Price</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right">Realized P/L</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-center">Account</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right">Closed</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const gain = p.realized_gain;
            const color = gain >= 0 ? "var(--positive)" : "var(--negative)";
            return (
              <tr key={p.id} className="border-b border-border/50">
                <td className="px-4 py-3 font-mono font-semibold text-foreground">{p.ticker}</td>
                <td className="px-4 py-3 text-muted-foreground">{p.name}</td>
                <td className="px-4 py-3 text-right font-mono text-muted-foreground">{formatShares(p.shares)}</td>
                <td className="px-4 py-3 text-right font-mono text-muted-foreground">{formatCurrency(p.cost_basis)}</td>
                <td className="px-4 py-3 text-right font-mono text-foreground">{formatCurrency(p.sale_price)}</td>
                <td className="px-4 py-3 text-right font-mono" style={{ color }}>
                  {gain >= 0 ? "+" : ""}{formatCurrency(gain)}
                </td>
                <td className="px-4 py-3 text-center">
                  <span
                    className="inline-block text-xs px-2 py-0.5 rounded-sm"
                    style={{ background: "oklch(0.16 0 0)", color: "oklch(0.52 0.008 74)" }}
                  >
                    {p.account}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                  {new Date(p.closed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
