/* ──────────────────────────────────────────────────────────────────────────
   Loading a weight vector from somewhere else (the Rebalancer's saved targets,
   a saved portfolio, a model mix) into a tool's editable basket.

   Shared so the Optimizer and Monte Carlo behave identically — in particular
   both pull in any names the basket is missing, and both report what didn't fit
   rather than dropping it silently.
   ────────────────────────────────────────────────────────────────────────── */

/** One account's saved targets, as the Rebalancer stores them. */
export interface AccountTargets {
  account: string;
  /** ticker -> percent OF THAT ACCOUNT (cash included), used exactly as typed. */
  targets: Record<string, number>;
  updatedAt: string | null;
}

/**
 * Every account that has saved rebalance targets, most recently saved first.
 *
 * ⚠️ Targets are per-account and were re-keyed to (user, account) on 2026-08-01.
 * Fetching this endpoint with NO account silently falls back to the '__all__'
 * sentinel, which now only ever holds a pre-migration leftover — so the old
 * account-less call here loaded weeks-stale weights while looking like it had
 * worked. Callers must pick an account; there is no portfolio-wide vector to
 * fall back to, because each account's percentages are shares of that account
 * and combining them needs account values this layer doesn't have.
 */
export async function fetchRebalanceTargetAccounts(): Promise<AccountTargets[]> {
  const r = await fetch("/api/analysis/rebalance-targets?account=*");
  const j = (await r.json()) as { accounts?: AccountTargets[]; error?: string };
  if (!r.ok) throw new Error(j.error || "Failed to load rebalance targets");
  return (j.accounts ?? []).map((a) => ({
    account: a.account,
    targets: a.targets ?? {},
    updatedAt: a.updatedAt ?? null,
  }));
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
