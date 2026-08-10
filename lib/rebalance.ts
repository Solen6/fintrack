/** Trades smaller than this (in dollars) are treated as noise, not a trade. */
export const TRADE_EPS = 1;

/** How the plan is allowed to trade.
 *  - `buy-only`: nothing is sold. Spare cash is spread across the underweight
 *    holdings, most underweight first — the "I just deposited money" case.
 *  - `both`: buys and sells freely to land every holding on its target. */
export type RebalanceMode = "buy-only" | "both";

export interface RebalanceHolding {
  ticker: string;
  name: string;
  /** Current market value of the position in this account. */
  value: number;
  /** The target the user typed: a percent OF THE WHOLE ACCOUNT, cash included. */
  targetShown: number;
}

export interface RebalanceInput {
  holdings: RebalanceHolding[];
  /** Cash sitting in the account today. */
  cash: number;
  /** New money being added to the account. Raises the account total. */
  deposit?: number;
  mode?: RebalanceMode;
}

export interface RebalanceRow {
  ticker: string;
  name: string;
  value: number;
  /** Percent of the account today, counting a pending deposit as cash. */
  currentPct: number;
  /** The number the user typed. */
  targetShown: number;
  /** The target actually used. Equals `targetShown` unless the column was
   *  over-allocated (summed past 100) and had to be scaled back. */
  targetPct: number;
  /** currentPct − targetPct. Positive = overweight. */
  driftPct: number;
  /** Dollars to trade: positive buys, negative sells. */
  tradeDollar: number;
  /** Percent of the account this holding ends at once the plan runs. */
  afterPct: number;
  /** afterPct − targetPct. Nonzero only when buy-only can't close the gap. */
  driftAfterPct: number;
}

export interface RebalancePlan {
  rows: RebalanceRow[];
  /** Sum of the entered target numbers — the "targets sum" readout. */
  targetSum: number;
  /** The share of the account left over for cash: 100 − targetSum, floored at
   *  0. This is a real target, not a remainder the plan ignores. */
  cashTargetPct: number;
  /** True when the entered targets summed past 100 and were scaled back to fit
   *  — you can't hold more than the whole account. */
  overAllocated: boolean;
  /** Largest |drift| before trading. */
  maxDrift: number;
  /** Largest |drift| left once the plan runs. ~0 unless buy-only fell short. */
  maxDriftAfter: number;
  nTrades: number;
  /** One-way dollars traded = max(total buys, total sells). */
  turnover: number;
  /** Total account value, deposit included. A plan only moves money between
   *  the cash and invested sleeves, so it's the same before and after. */
  totalValue: number;
  investedBefore: number;
  investedAfter: number;
  /** Cash on hand once the deposit lands, and what's left after the plan. */
  cashNow: number;
  cashAfter: number;
  cashPct: number;
  cashPctAfter: number;
  /** Dollars of cash the plan puts into securities (net of any sells). */
  cashDeployed: number;
  /** Cash above the cash target — what buy-only has to work with. */
  investableCash: number;
}

/**
 * One definition of the rebalance plan, shared by both modes so they can't
 * drift apart.
 *
 * A target is a percent OF THE WHOLE ACCOUNT, cash included — type 45 and you
 * are asking for 45% of everything in the account, not 45% of the invested
 * part. Targets are used exactly as entered; they are never renormalized to
 * sum to 100. That is what makes **cash a first-class target**: whatever share
 * of the account you don't allocate is the share meant to stay in cash. Enter
 * targets summing to 90 and you're asking to hold 10% cash; enter 100 and
 * you're asking to be fully invested.
 *
 * A deposit counts as cash from the moment it's entered, so it raises the
 * account total and dilutes every holding — and the plan then closes exactly
 * that gap, splitting the new money between securities and cash in whatever
 * proportion your targets imply.
 */
export function planRebalance(input: RebalanceInput): RebalancePlan {
  const holdings = input.holdings;
  const cash = Math.max(0, input.cash);
  const deposit = Math.max(0, input.deposit ?? 0);
  const mode = input.mode ?? "both";

  const investedBefore = holdings.reduce((s, h) => s + h.value, 0);
  const cashNow = cash + deposit;
  const totalValue = investedBefore + cashNow;

  const targetSum = holdings.reduce((s, h) => s + Math.max(0, h.targetShown), 0);
  // You can't hold more than the whole account. Past 100 the entries are read
  // as relative weights of a fully-invested account rather than refused, so
  // the plan stays executable — the UI says so out loud.
  const overAllocated = targetSum > 100;
  const scale = overAllocated ? 100 / targetSum : 1;

  const pcts = holdings.map((h) => Math.max(0, h.targetShown) * scale);
  const cashTargetPct = Math.max(0, 100 - pcts.reduce((s, p) => s + p, 0));

  const targetValues = pcts.map((p) => (p / 100) * totalValue);
  const cashTargetValue = (cashTargetPct / 100) * totalValue;
  // What buy-only may spend: cash sitting above the cash target. Negative
  // means the account is already short of its cash target, and raising cash
  // would mean selling — which buy-only won't do.
  const investableCash = Math.max(0, cashNow - cashTargetValue);

  const trades =
    mode === "buy-only"
      ? waterFillBuys(
          holdings.map((h) => h.value),
          pcts.map((p) => p / 100),
          investableCash,
        )
      : holdings.map((h, i) => targetValues[i] - h.value);

  let buys = 0;
  let sells = 0;
  for (const t of trades) {
    if (t > 0) buys += t;
    else sells -= t;
  }
  const cashDeployed = buys - sells;
  const cashAfter = cashNow - cashDeployed;

  const pct = (v: number) => (totalValue > 0 ? (v / totalValue) * 100 : 0);

  const rows: RebalanceRow[] = holdings
    .map((h, i) => {
      const currentPct = pct(h.value);
      const afterPct = pct(h.value + trades[i]);
      return {
        ticker: h.ticker,
        name: h.name,
        value: h.value,
        currentPct,
        targetShown: h.targetShown,
        targetPct: pcts[i],
        driftPct: currentPct - pcts[i],
        tradeDollar: trades[i],
        afterPct,
        driftAfterPct: afterPct - pcts[i],
      };
    })
    .sort((a, b) => b.currentPct - a.currentPct);

  return {
    rows,
    targetSum,
    cashTargetPct,
    overAllocated,
    maxDrift: rows.reduce((m, r) => Math.max(m, Math.abs(r.driftPct)), 0),
    maxDriftAfter: rows.reduce((m, r) => Math.max(m, Math.abs(r.driftAfterPct)), 0),
    nTrades: trades.filter((t) => Math.abs(t) > TRADE_EPS).length,
    // Buys and sells net out only when no cash moves, so this can't be the
    // classic Σ|trade| ÷ 2 — halving it would understate a plan that is
    // mostly (or entirely) funded by cash.
    turnover: Math.max(buys, sells),
    totalValue,
    investedBefore,
    investedAfter: investedBefore + cashDeployed,
    cashNow,
    cashAfter,
    cashPct: pct(cashNow),
    cashPctAfter: pct(cashAfter),
    cashDeployed,
    investableCash,
  };
}

/**
 * Spread `cash` across holdings without selling anything.
 *
 * Level-filling: raise a common "dollars per point of target" level until the
 * cash runs out. A holding is bought only while it sits below that level, so
 * the money lands on the most underweight names first and stops the moment
 * they've caught up with the next one — the allocation that closes the largest
 * relative shortfall it can afford. Anything already above the level is left
 * alone, since correcting it would mean selling.
 *
 * Spends the cash exactly whenever at least one holding carries a target.
 */
function waterFillBuys(values: number[], fracs: number[], cash: number): number[] {
  const buys = values.map(() => 0);
  if (!(cash > 0)) return buys;

  const active: number[] = [];
  for (let i = 0; i < values.length; i++) if (fracs[i] > 0) active.push(i);
  if (active.length === 0) return buys;

  const ratio = (i: number) => values[i] / fracs[i];
  active.sort((a, b) => ratio(a) - ratio(b));

  // Sweep the breakpoints: with the first k holdings funded, the level that
  // exactly spends the cash is (cash + Σvalue) ÷ Σfrac. It's the answer as
  // soon as it doesn't reach past the next holding's ratio — otherwise that
  // holding belongs in the funded set too, so keep going.
  let level = 0;
  for (let k = 0, sumV = 0, sumF = 0; k < active.length; k++) {
    sumV += values[active[k]];
    sumF += fracs[active[k]];
    const candidate = (cash + sumV) / sumF;
    const next = k + 1 < active.length ? ratio(active[k + 1]) : Infinity;
    if (candidate <= next) {
      level = candidate;
      break;
    }
  }

  for (const i of active) {
    const want = level * fracs[i] - values[i];
    if (want > 0) buys[i] = want;
  }
  return buys;
}
