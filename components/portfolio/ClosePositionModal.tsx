"use client";

import { useState } from "react";
import { formatCurrency, formatShares } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";
import type { HoldingWithMetrics } from "@/lib/types";

interface Props {
  holding: HoldingWithMetrics;
  onConfirm: (shares: number, salePrice: number) => Promise<void>;
  onCancel: () => void;
}

export function ClosePositionModal({ holding, onConfirm, onCancel }: Props) {
  const [shares, setShares] = useState(String(holding.shares));
  const [salePrice, setSalePrice] = useState(String(holding.currentPrice));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const sharesToClose = parseFloat(shares) || 0;
  const price = parseFloat(salePrice) || 0;
  const realizedGain = (price - holding.costBasis) * sharesToClose;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (sharesToClose <= 0) { setError("Shares must be > 0"); return; }
    if (sharesToClose > holding.shares) { setError(`Max ${formatShares(holding.shares)} shares`); return; }
    if (price <= 0) { setError("Sale price must be > 0"); return; }
    setSaving(true);
    try {
      await onConfirm(sharesToClose, price);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close position");
      setSaving(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2 text-sm rounded-sm border border-border bg-transparent text-foreground focus:outline-none focus:border-[var(--primary)] font-mono";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-sm rounded-md border border-border p-6 space-y-4"
        style={{ background: "oklch(0.12 0 0)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-medium text-foreground">
          Close <span className="font-mono">{holding.ticker}</span>
        </h3>
        <p className="text-xs text-muted-foreground">
          Holding: {formatShares(holding.shares)} shares @ <Sensitive>{formatCurrency(holding.costBasis)}</Sensitive> avg
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Shares to close</label>
            <input
              className={inputClass}
              type="number"
              step="any"
              min="0"
              max={holding.shares}
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Sale price per share</label>
            <input
              className={inputClass}
              type="number"
              step="any"
              min="0"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
            />
          </div>

          {sharesToClose > 0 && price > 0 && (
            <div className="text-xs py-2 border-t border-border">
              <span className="text-muted-foreground">Realized P/L: </span>
              <span
                className="font-mono font-medium"
                style={{ color: realizedGain >= 0 ? "var(--positive)" : "var(--negative)" }}
              >
                <Sensitive>{realizedGain >= 0 ? "+" : ""}{formatCurrency(realizedGain)}</Sensitive>
              </span>
            </div>
          )}

          {error && <p className="text-xs" style={{ color: "var(--negative)" }}>{error}</p>}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="text-xs px-4 py-2 rounded-sm font-medium disabled:opacity-50"
              style={{ background: "var(--negative)", color: "oklch(0.98 0 0)" }}
            >
              {saving ? "Closing…" : "Close Position"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="text-xs px-3 py-2 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
