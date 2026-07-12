/* Unit (share) method performance — a distortion-free time-weighted return.

   Each account is treated like a fund. At inception it's seeded from cost basis:
       seed_units = seed_cost_basis / base_price        (base_price = $10)
   Every day the unit price is  Pₜ = NAVₜ / unitsₜ, and a deposit/withdrawal
   just issues/redeems units at the current price (unitsₜ += flowₜ / Pₜ₋₁), so
   cash flows never move the price. Because the seed is a FIXED cost-basis
   anchor, the return captures your full gain-vs-cost (not just gains since the
   app started) and a rebalance — which is internal, not a flow — can't reset it.

       Total Return % = (P_today / base − 1) × 100
       Return at date t (chart) = (Pₜ / base − 1) × 100
       Total Return $ = NAV_today − (seed_cost_basis + Σdeposits − Σwithdrawals)

   Only external cash flows (deposits/withdrawals) count as flows — buys, sells,
   dividends and rebalances move money within the account and are excluded. */

export interface ReturnSnapshot {
  date: string; // YYYY-MM-DD
  value: number; // securities market value
  cash?: number;
  costBasis?: number;
  account: string | null; // null = legacy pre-per-account combined row
}

export interface ReturnFlow {
  date: string;
  account: string | null;
  amount: number; // signed: deposit +, withdrawal −
}

export interface AccountSeed {
  seedCostBasis: number;
  basePrice: number;
}

/** Live end-of-today NAV so the last point matches what the user sees now. */
export interface LiveNav {
  value: number; // live securities value
  cash: number; // live cash
}

export interface UnitReturn {
  totalPct: number; // Total Return % (unit price vs base)
  totalGain: number; // Total Return $ (NAV − contributed capital)
  byDate: Map<string, number>; // return % at each date, for the chart / period bars
}

const BASE_PRICE = 10;

/* Collapse per-account snapshots into one daily NAV, honoring the account
   filter (per-account rows win; a legacy combined row fills only dates with no
   per-account rows, and only when all accounts are enabled). Forces today's
   point to the live NAV so it matches the current display. */
function buildNavSeries(
  snapshots: ReturnSnapshot[],
  enabledAccounts: Set<string>,
  allOn: boolean,
  live: LiveNav,
): { date: string; nav: number }[] {
  type Acc = { value: number; cash: number };
  const perAccount = new Map<string, Acc>();
  const legacy = new Map<string, Acc>();
  for (const s of snapshots) {
    const cash = s.cash ?? 0;
    if (s.account === null) {
      legacy.set(s.date, { value: s.value, cash });
    } else if (enabledAccounts.has(s.account)) {
      const cur = perAccount.get(s.date) ?? { value: 0, cash: 0 };
      perAccount.set(s.date, { value: cur.value + s.value, cash: cur.cash + cash });
    }
  }
  const byDate = new Map<string, Acc>(perAccount);
  if (allOn) {
    for (const [date, acc] of legacy) if (!byDate.has(date)) byDate.set(date, acc);
  }
  const series = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, acc]) => ({ date, nav: acc.value + acc.cash }));

  // Always include today's live NAV as the final point — even with no stored
  // snapshots yet — so Total Return is available from day one (it's a snapshot
  // ratio vs the cost-basis seed, not a day-over-day change).
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const liveNav = live.value + live.cash;
  if (series.length > 0 && series[series.length - 1].date === todayStr) {
    series[series.length - 1].nav = liveNav;
  } else {
    series.push({ date: todayStr, nav: liveNav });
  }
  return series;
}

/**
 * Fallback seed anchor for accounts that don't have a persisted `portfolio_seed`
 * row yet: cost basis + cash as of the EARLIEST STORED snapshot (never live/
 * current values). This matters because `unitMethodReturn` starts its unit
 * count from this anchor and applies it to the earliest point in `series` —
 * using CURRENT cost basis would un-anchor the return on every rebalance (the
 * exact bug the unit method exists to fix), and using CURRENT cash would bake
 * every deposit/withdrawal made since inception into the anchor itself, on
 * top of the flow-loop separately minting/redeeming units for that same flow
 * — a double count that makes deposits look like losses and withdrawals look
 * like gains. Anchoring to the stored snapshot sidesteps both: it can't have
 * absorbed a rebalance or a flow that hasn't happened yet as of that date.
 * Returns null when there's no stored history at all (brand new account), OR
 * when every stored row predates cost-basis/cash tracking (both 0 — early
 * snapshots recorded only total_value before those columns existed): a zero
 * anchor would make the account read as a permanent, un-fixable 0% instead of
 * falling back sanely. Callers should fall back to LIVE cost basis + cash in
 * either case, which is safe because there's nothing after it yet to
 * double-count against.
 */
export function earliestStoredCapital(
  snapshots: ReturnSnapshot[],
  enabledAccounts: Set<string>,
  allOn: boolean,
): { costBasis: number; cash: number } | null {
  type Acc = { costBasis: number; cash: number };
  const perAccount = new Map<string, Acc>();
  const legacy = new Map<string, Acc>();
  for (const s of snapshots) {
    const cash = s.cash ?? 0;
    const costBasis = s.costBasis ?? 0;
    if (s.account === null) {
      legacy.set(s.date, { costBasis, cash });
    } else if (enabledAccounts.has(s.account)) {
      const cur = perAccount.get(s.date) ?? { costBasis: 0, cash: 0 };
      perAccount.set(s.date, { costBasis: cur.costBasis + costBasis, cash: cur.cash + cash });
    }
  }
  const byDate = new Map<string, Acc>(perAccount);
  if (allOn) {
    for (const [date, acc] of legacy) if (!byDate.has(date)) byDate.set(date, acc);
  }
  // Prefer the earliest date with a real cost-basis figure — early snapshots
  // recorded only total_value before the cost_basis column existed, so a date
  // with cash but costBasis===0 is ambiguous (untracked securities, or a
  // genuinely cash-only account) and costBasis-bearing dates resolve it. Only
  // an account with NO costBasis-bearing date EVER (truly cash-only, no
  // securities) falls back to its earliest cash-bearing date instead.
  const byCostBasis = [...byDate.entries()]
    .filter(([, acc]) => acc.costBasis > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (byCostBasis.length > 0) return byCostBasis[0][1];
  const byCash = [...byDate.entries()]
    .filter(([, acc]) => acc.cash > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  return byCash.length > 0 ? byCash[0][1] : null;
}

/* Net external flow per day, same account filter. */
function buildFlowByDate(
  flows: ReturnFlow[],
  enabledAccounts: Set<string>,
  allOn: boolean,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of flows) {
    if (f.account === null) {
      if (!allOn) continue;
    } else if (!enabledAccounts.has(f.account)) {
      continue;
    }
    m.set(f.date, (m.get(f.date) ?? 0) + f.amount);
  }
  return m;
}

/**
 * Unit-method return for the enabled accounts, treated as one fund.
 * @param seedCostBasis  Σ over enabled accounts of the fixed seed cost basis
 *   (caller resolves each account's stored seed, falling back to live cost basis).
 */
export function unitMethodReturn(
  snapshots: ReturnSnapshot[],
  flows: ReturnFlow[],
  enabledAccounts: Set<string>,
  allOn: boolean,
  live: LiveNav,
  seedCostBasis: number,
): UnitReturn {
  const byDate = new Map<string, number>();
  const series = buildNavSeries(snapshots, enabledAccounts, allOn, live);
  if (series.length === 0 || seedCostBasis <= 0) {
    return { totalPct: 0, totalGain: 0, byDate };
  }
  const flowByDate = buildFlowByDate(flows, enabledAccounts, allOn);

  let units = seedCostBasis / BASE_PRICE; // seed: price starts implied by NAV/units
  let prevPrice: number | null = null;
  let netFlow = 0;
  for (const { date, nav } of series) {
    // A deposit/withdrawal issues/redeems units at the PRIOR price, so it's
    // return-neutral. Skip the very first point (that flow is baked into the seed).
    const flow = flowByDate.get(date) ?? 0;
    if (flow !== 0 && prevPrice != null && prevPrice > 0) {
      units += flow / prevPrice;
      netFlow += flow;
    }
    const price = units > 0 ? nav / units : BASE_PRICE;
    byDate.set(date, (price / BASE_PRICE - 1) * 100);
    prevPrice = price;
  }

  const lastNav = series[series.length - 1].nav;
  const lastPrice = prevPrice ?? BASE_PRICE;
  return {
    totalPct: (lastPrice / BASE_PRICE - 1) * 100,
    totalGain: lastNav - (seedCostBasis + netFlow), // NAV − contributed capital
    byDate,
  };
}
