/* ──────────────────────────────────────────────────────────────────────────
   Turning a ticker -> percent map into a weight vector that can be priced
   against a covariance matrix. Used to plot saved portfolios on the efficient
   frontier. Pure; no I/O.
   ────────────────────────────────────────────────────────────────────────── */

/**
 * Project a ticker→percent map onto an ordered ticker list, normalized to sum
 * to 1. Tickers missing from `order` are dropped and their weight redistributed
 * (so a portfolio still plots when one of its names has no usable history).
 * Returns null when nothing usable is left.
 */
export function weightVector(
  weights: Record<string, number>,
  order: string[],
): number[] | null {
  const raw = order.map((t) => Math.max(0, Number(weights[t]) || 0));
  const sum = raw.reduce((s, x) => s + x, 0);
  if (sum <= 1e-9) return null;
  return raw.map((w) => w / sum);
}

/** Tickers a portfolio references that aren't priceable in `available`. */
export function missingTickers(weights: Record<string, number>, available: Set<string>): string[] {
  return Object.entries(weights)
    .filter(([t, w]) => (Number(w) || 0) > 0 && !available.has(t))
    .map(([t]) => t);
}
