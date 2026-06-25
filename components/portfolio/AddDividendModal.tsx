"use client";

import { useState, useEffect } from "react";
import { formatCurrency } from "@/lib/format";

interface Holding {
  id: string;
  ticker: string;
  name: string | null;
  shares: number;
}

interface Props {
  onClose: () => void;
  onAdded: () => void;
}

export function AddDividendModal({ onClose, onAdded }: Props) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [holdingId, setHoldingId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(() => {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  });
  const [amountPerShare, setAmountPerShare] = useState("");
  const [reinvested, setReinvested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/holdings")
      .then((r) => r.json())
      .then((d) => {
        const list: Holding[] = (d.holdings ?? []).map((h: Holding) => ({
          id: h.id,
          ticker: h.ticker,
          name: h.name,
          shares: Number(h.shares),
        }));
        setHoldings(list);
        if (list.length > 0) setHoldingId(list[0].id);
      });
  }, []);

  const selected = holdings.find((h) => h.id === holdingId);
  const perShareNum = parseFloat(amountPerShare);
  const estimated = selected && !isNaN(perShareNum) ? perShareNum * selected.shares : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!holdingId || !effectiveDate || !amountPerShare) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/holdings/dividends/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdingId, effectiveDate, amountPerShare: perShareNum, reinvested }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to add dividend");
      } else {
        onAdded();
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border p-6 flex flex-col gap-5"
        style={{ background: "var(--card)" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground tracking-wide">Add Dividend</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Holding select */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Holding</label>
            <select
              value={holdingId}
              onChange={(e) => setHoldingId(e.target.value)}
              className="w-full rounded border border-border bg-background text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
              required
            >
              {holdings.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.ticker} — {h.shares.toFixed(4)} sh{h.name ? ` (${h.name})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Ex-Dividend Date</label>
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              className="w-full rounded border border-border bg-background text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
              required
            />
          </div>

          {/* Amount per share */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Amount per Share ($)</label>
            <input
              type="number"
              min="0"
              step="0.0001"
              placeholder="0.00"
              value={amountPerShare}
              onChange={(e) => setAmountPerShare(e.target.value)}
              className="w-full rounded border border-border bg-background text-foreground font-mono text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
              required
            />
            {estimated != null && (
              <p className="text-xs font-mono" style={{ color: "var(--positive)" }}>
                ≈ {formatCurrency(estimated)} total ({selected!.shares.toFixed(4)} sh)
              </p>
            )}
          </div>

          {/* Cash / Reinvest toggle */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground">Payment</label>
            <div className="flex rounded border border-border overflow-hidden">
              {(["Cash", "Reinvest"] as const).map((opt) => {
                const active = (opt === "Reinvest") === reinvested;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setReinvested(opt === "Reinvest")}
                    className="flex-1 py-1.5 text-xs font-medium transition-colors"
                    style={
                      active
                        ? { background: "var(--primary)", color: "var(--primary-foreground)" }
                        : { background: "transparent", color: "var(--muted-foreground)" }
                    }
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            {reinvested && (
              <p className="text-xs text-muted-foreground">
                Shares will be bought at the current market price.
              </p>
            )}
          </div>

          {error && (
            <p className="text-xs" style={{ color: "var(--negative)" }}>{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !holdingId || !amountPerShare}
              className="flex-1 py-2 rounded text-xs font-medium transition-opacity disabled:opacity-40"
              style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
            >
              {submitting ? "Saving…" : "Add Dividend"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
