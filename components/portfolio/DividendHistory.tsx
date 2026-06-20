"use client";

import { useState, useEffect } from "react";
import { formatCurrency } from "@/lib/format";

interface DividendRecord {
  id: string;
  date: string;
  ticker: string;
  name: string | null;
  amount: number | null;
  reinvested: boolean | null;
  detail: string | null;
}

export function DividendHistory() {
  const [dividends, setDividends] = useState<DividendRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/holdings/dividends")
      .then((r) => r.json())
      .then((d) => setDividends(d.dividends ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground animate-pulse">Loading dividends…</p>
      </div>
    );
  }

  if (dividends.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-1">
        <p className="text-sm text-muted-foreground">No dividends recorded yet.</p>
        <p className="text-xs" style={{ color: "oklch(0.52 0.008 74)" }}>
          Dividends are logged automatically the day a holding goes ex-dividend.
        </p>
      </div>
    );
  }

  const total = dividends.reduce((s, d) => s + (d.amount ?? 0), 0);

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-6 py-3 border-b border-border flex items-center gap-4">
        <span className="text-xs text-muted-foreground">
          {dividends.length} dividend{dividends.length !== 1 ? "s" : ""}
        </span>
        <span className="text-xs font-mono font-medium" style={{ color: "var(--positive)" }}>
          Total received: {formatCurrency(total)}
        </span>
      </div>
      <table className="w-full text-sm border-collapse min-w-[640px]">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-left">Date</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-left">Security</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-left min-w-[160px]">Name</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right">Amount</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-center">Reinvested</th>
          </tr>
        </thead>
        <tbody>
          {dividends.map((d) => (
            <tr key={d.id} className="border-b border-border/50">
              <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                {new Date(`${d.date}T00:00:00`).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </td>
              <td className="px-4 py-3 font-mono font-semibold text-foreground">{d.ticker}</td>
              <td className="px-4 py-3 text-muted-foreground">{d.name ?? "—"}</td>
              <td className="px-4 py-3 text-right font-mono text-foreground">
                {d.amount != null ? formatCurrency(d.amount) : "—"}
              </td>
              <td className="px-4 py-3 text-center">
                {d.reinvested == null ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  <span
                    className="inline-block text-xs px-2 py-0.5 rounded-sm"
                    style={
                      d.reinvested
                        ? { background: "oklch(0.27 0.06 152)", color: "var(--positive)" }
                        : { background: "oklch(0.16 0 0)", color: "oklch(0.64 0.008 74)" }
                    }
                  >
                    {d.reinvested ? "Reinvested" : "Cash"}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
