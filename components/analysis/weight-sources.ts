/* ──────────────────────────────────────────────────────────────────────────
   Loading a weight vector from somewhere else (the Rebalancer's saved targets,
   a saved portfolio, a model mix) into a tool's editable basket.

   Shared so the Optimizer and Monte Carlo behave identically — in particular
   both pull in any names the basket is missing, and both report what didn't fit
   rather than dropping it silently.
   ────────────────────────────────────────────────────────────────────────── */

/** The Rebalancer's saved target weights (ticker -> percent). */
export async function fetchRebalanceTargets(): Promise<Record<string, number>> {
  const r = await fetch("/api/analysis/rebalance-targets");
  const j = (await r.json()) as { targets?: Record<string, number>; error?: string };
  if (!r.ok) throw new Error(j.error || "Failed to load rebalance targets");
  return j.targets ?? {};
}

export interface WeightLoadPlan {
  /** Positive-weight entries, ready to become the new mix. */
  weights: Record<string, number>;
  /** Names to append to the basket so they get priced. */
  toAdd: string[];
  /** Names that didn't fit under the basket cap. */
  overflow: string[];
  empty: boolean;
}

/**
 * Work out how to apply a ticker→percent map to a basket that currently holds
 * `have`, without exceeding `max` tickers.
 */
export function planWeightLoad(
  weights: Record<string, number>,
  have: string[],
  max: number,
): WeightLoadPlan {
  const entries = Object.entries(weights).filter(([, v]) => Number(v) > 0);
  if (entries.length === 0) {
    return { weights: {}, toAdd: [], overflow: [], empty: true };
  }
  const present = new Set(have);
  const absent = entries.map(([t]) => t).filter((t) => !present.has(t));
  const room = Math.max(0, max - have.length);
  return {
    weights: Object.fromEntries(entries.map(([t, v]) => [t, Number(v)])),
    toAdd: absent.slice(0, room),
    overflow: absent.slice(room),
    empty: false,
  };
}

/** Human-readable outcome of a load, or null when everything fit. */
export function overflowMessage(plan: WeightLoadPlan, max: number): string | null {
  return plan.overflow.length > 0
    ? `Basket is full at ${max} — couldn't add ${plan.overflow.join(", ")}. Remove a ticker and load again.`
    : null;
}
