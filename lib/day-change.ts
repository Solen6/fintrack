import type { HoldingWithMetrics } from "./types";

/** Today's move for a set of positions: dollars, and the percent that is of
 *  what those same positions were worth at yesterday's close. */
export interface DayChange {
  /** Change in dollars since the prior close (or since entry, for today's buys). */
  dollar: number;
  /** `dollar` as a percent of `priorValue`. 0 when there is nothing priceable. */
  pct: number;
  /** What the positions were worth before today's move — the percent's denominator. */
  priorValue: number;
  /** Current market value of the positions this was measured over. */
  value: number;
  /** True when at least one position actually carries a live day move. */
  hasMoves: boolean;
}

const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

/**
 * ONE definition of "today's change", shared by the portfolio summary strip and
 * the account sidebar so a single account can never show one number in the
 * header and a different one in the list.
 *
 * Cash is deliberately excluded — it doesn't move, and folding it into the
 * denominator would quietly shrink the percent of a cash-heavy account below
 * the market move it actually experienced. Bonds and derivatives carry a
 * `todayChangePct` of 0 (no prior close is fetched for them), so they
 * contribute nothing rather than a fabricated move.
 */
export function computeDayChange(holdings: HoldingWithMetrics[], now = new Date()): DayChange {
  const todayET = ET_DATE.format(now);
  let dollar = 0;
  let value = 0;
  let priorValue = 0;
  let hasMoves = false;

  for (const h of holdings) {
    value += h.value;

    // A position bought today is measured from your entry, not from a prior
    // close it never held through — this is what the broker shows too.
    if (h.acquiredAt != null && ET_DATE.format(new Date(h.acquiredAt)) === todayET) {
      dollar += h.value - h.costTotal;
      priorValue += h.costTotal;
      hasMoves = true;
      continue;
    }

    const pct = h.todayChangePct / 100;
    const prior = h.value / (1 + pct);
    // A -100% quote (or any garbage that divides to a non-finite prior value)
    // would poison the whole sum — treat it as flat instead.
    if (!Number.isFinite(prior)) {
      priorValue += h.value;
      continue;
    }
    dollar += h.value - prior;
    priorValue += prior;
    if (h.todayChangePct !== 0) hasMoves = true;
  }

  return {
    dollar,
    pct: priorValue > 0 ? (dollar / priorValue) * 100 : 0,
    priorValue,
    value,
    hasMoves,
  };
}
