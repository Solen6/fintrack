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
  /** The resolved seed. 0 means no capital anchor could be established, and
   *  totalPct/totalGain are placeholders — callers should fall back. */
  seedCostBasis: number;
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

// ── Seed resolution (ONE definition, shared by every caller) ────────────────

export interface SeedResolutionInput {
  /** The accounts in scope (enabled / selected). */
  accounts: Iterable<string>;
  snapshots: ReturnSnapshot[];
  flows: ReturnFlow[];
  /** Persisted `portfolio_seed` anchors, by account. */
  storedSeeds: Map<string, number>;
  /** Live cost basis + cash for an account, used only when it has no history. */
  liveCapital: (account: string) => number;
  /** The dates `unitCumReturns` will actually walk, ascending. */
  seriesDates: string[];
  /** Today (ET), the anchor moment for an account with no stored snapshot. */
  today: string;
}

export interface SeedResolution {
  /** Σ capital that was already in the portfolio at `seriesDates[0]`. */
  seedCostBasis: number;
  /** Capital that arrived LATER, to be minted at the price prevailing on its
   *  arrival date. Merge into the caller's flow map before running the loop. */
  lateFlows: ReturnFlow[];
  /** Per-account trace, for tests and diagnostics. */
  perAccount: {
    account: string;
    via: "portfolio_seed" | "earliest snapshot" | "live";
    anchorDate: string;
    anchorCapital: number;
    seeded: number;
    minted: number;
  }[];
}

/**
 * Resolve the unit-method seed for a set of accounts.
 *
 * Each account's capital is anchored the usual way — stored `portfolio_seed` →
 * cost basis + cash at its EARLIEST STORED snapshot → live cost basis + cash
 * (only when it has no history at all). The addition here is *when* that
 * capital is allowed to mint units.
 *
 * Seed units are minted at $10 as of `seriesDates[0]`. So capital may only go
 * into the seed if it was actually there on that date. An account that joined
 * LATER — a newly added account, a first CSV import, an account funded after
 * you started tracking — must instead mint its units at the price prevailing
 * when it arrived, exactly like a deposit. Seeding it would do two damaging
 * things at once:
 *
 *   1. DOUBLE-COUNT the money. Its funding deposit is already in `flows`, so
 *      the loop mints units for it; adding the same dollars to the seed mints
 *      them a second time. Contributed capital then exceeds the money that
 *      actually exists, `totalGain` (NAV − contributed capital) is understated
 *      by exactly the deposit, and the return craters. This is the bug where
 *      opening a $500 account dropped Overall Return by 21.66 points and Total
 *      Gain by exactly $500.
 *   2. Dilute history the money was never in. Seed units exist from
 *      `seriesDates[0]`, so every past point gets re-divided by a unit count
 *      inflated with capital that hadn't arrived — the whole chart shifts down,
 *      not just today.
 *
 * So: `anchorDate <= seriesDates[0]` → seed it. Otherwise contribute 0 and emit
 * a late flow for whatever the recorded flows don't already cover (that
 * remainder is 0 for a plain deposit, and the full balance for a silent CSV
 * import that recorded no deposit). Either way the arrival is return-neutral,
 * which is the whole premise of the unit method.
 */
export function resolveSeedCapital(input: SeedResolutionInput): SeedResolution {
  const { snapshots, flows, storedSeeds, liveCapital, seriesDates, today } = input;
  const seriesStart = seriesDates[0] ?? today;
  const inSeries = new Set(seriesDates);

  // Earliest stored snapshot date per account = the moment its anchor describes.
  const firstSnapDate = new Map<string, string>();
  for (const s of snapshots) {
    if (s.account == null) continue;
    const cur = firstSnapDate.get(s.account);
    if (cur == null || s.date < cur) firstSnapDate.set(s.account, s.date);
  }

  const perAccount: SeedResolution["perAccount"] = [];
  const lateFlows: ReturnFlow[] = [];
  let seedCostBasis = 0;

  for (const account of input.accounts) {
    const stored = storedSeeds.get(account);
    const anchor = stored != null ? null : earliestStoredCapital(snapshots, new Set([account]), false);
    const via: SeedResolution["perAccount"][number]["via"] =
      stored != null ? "portfolio_seed" : anchor ? "earliest snapshot" : "live";
    const anchorCapital =
      stored != null ? stored : anchor ? anchor.costBasis + anchor.cash : liveCapital(account);
    const anchorDate = firstSnapDate.get(account) ?? today;

    if (anchorDate <= seriesStart) {
      seedCostBasis += anchorCapital;
      perAccount.push({ account, via, anchorDate, anchorCapital, seeded: anchorCapital, minted: 0 });
      continue;
    }

    /* Late arrival. Whatever recorded flows the loop will ALREADY mint on or
       before the anchor date is capital it has accounted for; mint only the
       remainder. A flow dated on a day absent from the series is never applied,
       and one dated at seriesStart is skipped by the loop (prevPrice is null
       there) — so neither counts as already-minted. */
    const alreadyMinted = flows
      .filter(
        (f) =>
          f.account === account &&
          f.date <= anchorDate &&
          inSeries.has(f.date) &&
          f.date !== seriesStart,
      )
      .reduce((s, f) => s + f.amount, 0);
    const remainder = anchorCapital - alreadyMinted;
    // Mint on the anchor date itself when the loop visits it, else the first
    // series date after it (a flow on an unvisited date would silently vanish).
    const mintDate = inSeries.has(anchorDate)
      ? anchorDate
      : seriesDates.find((d) => d > anchorDate) ?? seriesDates[seriesDates.length - 1] ?? today;
    // Half-a-cent floor: anchor − flows is a difference of floats, so an
    // exactly-covered account lands on ~1e-13 rather than 0. Minting that as a
    // "flow" is noise in the ledger and in any diagnostic that prints it.
    if (Math.abs(remainder) >= 0.005 && mintDate !== seriesStart) {
      lateFlows.push({ date: mintDate, account, amount: remainder });
    }
    perAccount.push({ account, via, anchorDate, anchorCapital, seeded: 0, minted: remainder });
  }

  /* Guard: the loop returns a flat 0% when the seed is non-positive. That can
     only happen if every account in scope is "late" — the series then has no
     owner at its own start date — so fall back to seeding the earliest one
     rather than reporting a bogus 0%. */
  if (seedCostBasis <= 0 && perAccount.length > 0) {
    const earliest = [...perAccount].sort((a, b) => a.anchorDate.localeCompare(b.anchorDate))[0];
    if (earliest.anchorCapital > 0) {
      seedCostBasis = earliest.anchorCapital;
      earliest.seeded = earliest.anchorCapital;
      earliest.minted = 0;
      const i = lateFlows.findIndex((f) => f.account === earliest.account);
      if (i >= 0) lateFlows.splice(i, 1);
    }
  }

  return { seedCostBasis, lateFlows, perAccount };
}

/** Merge resolved late flows into a caller's date→net-flow map, in place. */
export function applyLateFlows(flowByDate: Map<string, number>, lateFlows: ReturnFlow[]): void {
  for (const f of lateFlows) flowByDate.set(f.date, (flowByDate.get(f.date) ?? 0) + f.amount);
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

// ── Shared unit-method core (dashboard + monthly reports) ───────────────────
// The dashboard's hero/chart and the monthly-report generator both call these,
// so a "monthly return" can never mean two different formulas again.

export interface DatedNav {
  date: string; // YYYY-MM-DD
  nav: number; // securities + cash
}

/** Effective return anchor: the earliest snapshot whose NAV is ≥ 50% of the
 *  largest NAV in `reference` (defaults to the whole series — the dashboard
 *  passes stored history only, excluding its live "today" point). Skips
 *  partial onboarding days that would blow the % up. Null when empty. */
export function inceptionDateFor(series: DatedNav[], reference?: DatedNav[]): string | null {
  if (series.length === 0) return null;
  const ref = reference && reference.length > 0 ? reference : series;
  const threshold = 0.5 * Math.max(...ref.map((s) => s.nav));
  return (series.find((s) => s.nav >= threshold) ?? series[0]).date;
}

export interface UnitCumReturns {
  /** Return % per date, dates ≥ inception only, in series order. */
  cumByDate: Map<string, number>;
  /** NAV − contributed capital per date, dates ≥ inception only. */
  gainByDate: Map<string, number>;
  totalReturnPct: number;
  totalGain: number;
}

/** The unit-method loop itself: seed units from cost basis, mint/redeem units
 *  for each date's net external flow at the PRIOR day's price (flows on dates
 *  with no snapshot are intentionally not applied — identical to the
 *  dashboard), price = NAV / units. Dates before `inceptionDate` still update
 *  units/price but aren't exposed. */
export function unitCumReturns(
  series: DatedNav[],
  flowByDate: Map<string, number>,
  seedCostBasis: number,
  inceptionDate: string | null,
): UnitCumReturns {
  const cumByDate = new Map<string, number>();
  const gainByDate = new Map<string, number>();
  if (series.length === 0 || seedCostBasis <= 0) {
    return { cumByDate, gainByDate, totalReturnPct: 0, totalGain: 0 };
  }
  const inception = inceptionDate ?? series[0].date;
  let units = seedCostBasis / BASE_PRICE;
  let prevPrice: number | null = null;
  let netFlow = 0; // Σ (deposits − withdrawals), running
  for (const s of series) {
    const flow = flowByDate.get(s.date) ?? 0;
    if (flow !== 0 && prevPrice != null && prevPrice > 0) {
      units += flow / prevPrice; // issue/redeem units at the prior price
      netFlow += flow;
    }
    const price = units > 0 ? s.nav / units : BASE_PRICE;
    if (s.date >= inception) {
      cumByDate.set(s.date, (price / BASE_PRICE - 1) * 100);
      gainByDate.set(s.date, s.nav - (seedCostBasis + netFlow));
    }
    prevPrice = price;
  }
  const last = series[series.length - 1];
  return {
    cumByDate,
    gainByDate,
    totalReturnPct: ((prevPrice ?? BASE_PRICE) / BASE_PRICE - 1) * 100,
    totalGain: last.nav - (seedCostBasis + netFlow),
  };
}

/** Per-period return chain-linked off the prior period's ending cumulative:
 *  (1 + cumEnd) / (1 + cumPrevEnd) − 1. The first period measures vs the
 *  inception baseline (0%). Flow-adjusted and rebalance-proof because
 *  `cumByDate` already is. Relies on cumByDate's insertion order being
 *  series (date) order — which `unitCumReturns` guarantees. */
export function chainedPeriodReturns(
  cumByDate: Map<string, number>,
  keyFn: (date: string) => string,
): { key: string; pct: number }[] {
  const order: string[] = [];
  const lastCum = new Map<string, number>();
  for (const [d, cum] of cumByDate) {
    const k = keyFn(d);
    if (!lastCum.has(k)) order.push(k);
    lastCum.set(k, cum);
  }
  return order.map((k, i) => {
    const cumEnd = lastCum.get(k)! / 100;
    const cumPrev = i > 0 ? lastCum.get(order[i - 1])! / 100 : 0;
    return { key: k, pct: ((1 + cumEnd) / (1 + cumPrev) - 1) * 100 };
  });
}

/**
 * Unit-method return for the enabled accounts, treated as one fund.
 * @param seedSources  Where each account's capital anchor comes from. The seed
 *   is resolved internally by `resolveSeedCapital` — off the same NAV series
 *   this function walks — so an account that joined after inception mints its
 *   units as a flow instead of diluting history it was never in.
 */
export function unitMethodReturn(
  snapshots: ReturnSnapshot[],
  flows: ReturnFlow[],
  enabledAccounts: Set<string>,
  allOn: boolean,
  live: LiveNav,
  seedSources: {
    storedSeeds: Map<string, number>;
    liveCapital: (account: string) => number;
    today?: string;
  },
): UnitReturn {
  const byDate = new Map<string, number>();
  const series = buildNavSeries(snapshots, enabledAccounts, allOn, live);
  const today =
    seedSources.today ??
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const { seedCostBasis, lateFlows } = resolveSeedCapital({
    accounts: enabledAccounts,
    snapshots,
    flows,
    storedSeeds: seedSources.storedSeeds,
    liveCapital: seedSources.liveCapital,
    seriesDates: series.map((s) => s.date),
    today,
  });
  if (series.length === 0 || seedCostBasis <= 0) {
    return { totalPct: 0, totalGain: 0, byDate, seedCostBasis: 0 };
  }
  const flowByDate = buildFlowByDate(flows, enabledAccounts, allOn);
  applyLateFlows(flowByDate, lateFlows);

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
    seedCostBasis,
  };
}
