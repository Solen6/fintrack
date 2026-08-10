/** Trades smaller than this (in dollars) are treated as noise, not a trade. */
export const TRADE_EPS = 1;

/** How the plan is allowed to trade.
 *  - `buy-only`: nothing is sold. Cash is spread across the underweight
 *    holdings, most underweight first — the "I just deposited money" case.
 *  - `both`: buys and sells freely to land every holding on its target. */
export type RebalanceMode = "buy-only" | "both";

export interface RebalanceHolding {
  ticker: string;
  name: string;
  /** Current market value of the position in this account. */
  value: number;
  /** The number the user typed. Read as a share of the other entries, not as
   *  an absolute percent — the column need not sum to 100 by hand. */
  targetShown: number;
}

export interface RebalanceInput {
  holdings: RebalanceHolding[];
  /** Cash sitting in the account today. */
  cash: number;
  /** New money being added to the account. Raises the account total. */
  deposit?: number;
  /** How much of the EXISTING `cash` to put to work. Clamped to [0, cash]. */
  idleDeploy?: number;
  mode?: RebalanceMode;
}

export interface RebalanceRow {
  ticker: string;
  name: string;
  value: number;
  /** Percent of the account today, counting a pending deposit as cash. */
  currentPct: number;
  /** The number the user typed, echoed back for the input. */
  targetShown: number;
  /** Normalized target as a percent of the whole account. */
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
  /** Largest |drift| before trading. */
  maxDrift: number;
  /** Largest |drift| left once the plan runs. ~0 unless buy-only fell short. */
  maxDriftAfter: number;
  nTrades: number;
  /** One-way dollars traded = max(total buys, total sells). */
  turnover: number;
  /** Total account value, deposit included, before and after — they're equal;
   *  a plan only moves money between the cash and invested sleeves. */
  totalValue: number;
  /** Market value of the invested sleeve today and after the plan. */
  investedBefore: number;
  investedAfter: number;
  /** Cash on hand once the deposit lands, and what's left after the plan. */
  cashNow: number;
  cashAfter: number;
  cashPct: number;
  cashPctAfter: number;
  /** Cash the plan was asked to put to work = deposit + idle cash deployed. */
  cashToInvest: number;
  /** Cash the plan actually spends (net of any sells). */
  cashDeployed: number;
  /** Contribution the plan couldn't place — only nonzero if every target is 0. */
  cashLeftOver: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * One definition of the rebalance plan, shared by every mode so the cash and
 * no-cash paths can't drift apart.
 *
 * Everything is expressed against ONE denominator: the account's total value
 * with a pending deposit counted as cash already sitting in it. That keeps
 * Current %, Target %, and After % on the same basis — a deposit shows up as
 * the cash row swelling and every holding diluting, which is exactly the drift
 * the plan then closes. With no deposit and no idle cash deployed this reduces
 * to a straight rebalance of the invested sleeve, identical to the numbers the
 * tool produced before cash was modeled at all.
 *
 * Cash is never a target: it's what funds the plan, not a holding to hit a
 * weight on. Whatever isn't deployed simply stays in cash.
 */
export function planRebalance(input: RebalanceInput): RebalancePlan {
  const holdings = input.holdings;
  const cash = Math.max(0, input.cash);
  const deposit = Math.max(0, input.deposit ?? 0);
  const idleDeploy = clamp(input.idleDeploy ?? 0, 0, cash);
  const mode = input.mode ?? "both";

  const investedBefore = holdings.reduce((s, h) => s + h.value, 0);
  const cashNow = cash + deposit;
  const totalValue = investedBefore + cashNow;
  const cashToInvest = deposit + idleDeploy;
  // Both modes intend to put the whole contribution to work, so this is the
  // sleeve the targets are measured against either way. Buy-only can leave
  // some of it unplaced (see cashLeftOver); the target it aimed at doesn't
  // move because of that — that's what makes the shortfall visible.
  const investedAfter = investedBefore + cashToInvest;

  const targetSum = holdings.reduce((s, h) => s + h.targetShown, 0);
  const fracs = holdings.map((h) => (targetSum > 0 ? h.targetShown / targetSum : 0));

  const trades =
    mode === "buy-only"
      ? waterFillBuys(
          holdings.map((h) => h.value),
          fracs,
          cashToInvest,
        )
      : holdings.map((h, i) => fracs[i] * investedAfter - h.value);

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
      const targetPct = pct(fracs[i] * investedAfter);
      const afterPct = pct(h.value + trades[i]);
      return {
        ticker: h.ticker,
        name: h.name,
        value: h.value,
        currentPct,
        targetShown: h.targetShown,
        targetPct,
        driftPct: currentPct - targetPct,
        tradeDollar: trades[i],
        afterPct,
        driftAfterPct: afterPct - targetPct,
      };
    })
    .sort((a, b) => b.currentPct - a.currentPct);

  return {
    rows,
    targetSum,
    maxDrift: rows.reduce((m, r) => Math.max(m, Math.abs(r.driftPct)), 0),
    maxDriftAfter: rows.reduce((m, r) => Math.max(m, Math.abs(r.driftAfterPct)), 0),
    nTrades: trades.filter((t) => Math.abs(t) > TRADE_EPS).length,
    // Buys and sells net out in `both` mode, so this matches the classic
    // Σ|trade| ÷ 2. In buy-only there is nothing to net against and the halved
    // figure would understate the plan by exactly half.
    turnover: Math.max(buys, sells),
    totalValue,
    investedBefore,
    investedAfter,
    cashNow,
    cashAfter,
    cashPct: pct(cashNow),
    cashPctAfter: pct(cashAfter),
    cashToInvest,
    cashDeployed,
    cashLeftOver: cashToInvest - cashDeployed,
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
