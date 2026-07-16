"use client";

import { useState } from "react";
import { formatCurrency, formatShares } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";
import { isFaceValueBond, isDerivative } from "@/lib/types";
import type { HoldingWithMetrics } from "@/lib/types";

interface Props {
  holding: HoldingWithMetrics;
  onConfirm: (shares: number, salePrice: number) => Promise<void>;
  onCancel: () => void;
}

export function ClosePositionModal({ holding, onConfirm, onCancel }: Props) {
  const faceBond = isFaceValueBond(holding); // shares = face, price = clean/100
  const isDeriv = isDerivative(holding);
  const short = holding.direction === "SHORT";
  const multiplier = holding.multiplier || 1;
  // Derivatives are entered/closed in CONTRACTS; `holding.shares` is signed
  // effective units (contracts × multiplier × ±1) — unwind to a magnitude the
  // user actually recognizes, and re-scale back to effective units on submit.
  const heldContracts = Math.abs(holding.shares) / multiplier;
  const [shares, setShares] = useState(String(isDeriv ? heldContracts : holding.shares));
  const [salePrice, setSalePrice] = useState(String(faceBond ? holding.currentPrice * 100 : holding.currentPrice));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const closeMagnitude = parseFloat(shares) || 0; // contracts for derivatives, shares/face otherwise
  const effectiveToClose = isDeriv ? closeMagnitude * multiplier : closeMagnitude;
  const heldMagnitude = isDeriv ? heldContracts : holding.shares;
  const rawPrice = parseFloat(salePrice) || 0;
  // For bonds the user enters a clean price (98.50); realized-gain + storage use clean/100.
  const price = faceBond ? rawPrice / 100 : rawPrice;
  // Sign-aware: a SHORT profits when price falls below cost, so its realized
  // gain is the negative of the naive (price - cost) × qty (matches the
  // signed-shares convention /api/holdings/close computes server-side).
  const closedShares = (short ? -1 : 1) * effectiveToClose;
  const realizedGain = (price - holding.costBasis) * closedShares;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (closeMagnitude <= 0) { setError(faceBond ? "Face value must be > 0" : isDeriv ? "Contracts must be > 0" : "Shares must be > 0"); return; }
    if (closeMagnitude > heldMagnitude) {
      setError(
        faceBond ? `Max ${formatCurrency(heldMagnitude)} face`
        : isDeriv ? `Max ${heldMagnitude} contract${heldMagnitude === 1 ? "" : "s"}`
        : `Max ${formatShares(heldMagnitude)} shares`
      );
      return;
    }
    if (rawPrice <= 0) { setError("Sale price must be > 0"); return; }
    setSaving(true);
    try {
      await onConfirm(effectiveToClose, price);
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
          Holding:{" "}
          {faceBond ? (
            <>
              <Sensitive>{formatCurrency(holding.shares)}</Sensitive> face @ {(holding.costBasis * 100).toFixed(2)} avg
            </>
          ) : isDeriv ? (
            <>
              <Sensitive>{heldContracts}</Sensitive> contract{heldContracts === 1 ? "" : "s"} ({short ? "short" : "long"}) @{" "}
              <Sensitive>{formatCurrency(holding.costBasis)}</Sensitive> avg
            </>
          ) : (
            <>
              <Sensitive>{formatShares(holding.shares)}</Sensitive> shares @ <Sensitive>{formatCurrency(holding.costBasis)}</Sensitive> avg
            </>
          )}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {faceBond ? "Face value to close" : isDeriv ? "Contracts to close" : "Shares to close"}
            </label>
            <input
              className={inputClass}
              type="number"
              step="any"
              min="0"
              max={heldMagnitude}
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {faceBond ? "Sale price (per 100)" : isDeriv ? `${short ? "Buy-to-cover" : "Sale"} price per share` : "Sale price per share"}
            </label>
            <input
              className={inputClass}
              type="number"
              step="any"
              min="0"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
            />
          </div>

          {closeMagnitude > 0 && price > 0 && (
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
