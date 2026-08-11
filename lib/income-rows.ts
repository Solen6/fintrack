/**
 * Income-tab row assembly — pure, no I/O, no React.
 *
 * Extracted out of DividendHistory.tsx for the same reason lib/rebalance.ts and
 * lib/day-change.ts were: it is the part with an actual invariant to protect,
 * and inside a `useMemo` it could only ever be checked by eye in a browser.
 *
 * THE INVARIANT: a single coupon payment must appear exactly once. Paid coupons
 * are ledger rows (lib/bond-lifecycle.ts credits them to cash on the payment
 * date); upcoming ones are projected from the bond's own terms. Both describe
 * the same schedule, so on the day a payment is swept they collide — and the
 * projection has to yield.
 */

import { couponAmount, couponDatesBetween } from "./bond-coupons";

export interface DividendRecord {
  id: string;
  holdingId: string;
  /** Which ledger action this is. Coupons are real, already-paid cash. */
  kind: "dividend" | "coupon";
  /** Income date — the pay date when known, else the ex-date as a placeholder. */
  date: string;
  /** Ex-date: the ownership deadline. Entitlement, not income. */
  exDate?: string;
  /** Payable date. Null = not published (every ETF, and history older than the
      currently-declared dividend) — those rows stay Pending. */
  payDate?: string | null;
  /** True only when a pay date is known AND has arrived. */
  paid?: boolean;
  ticker: string;
  name: string | null;
  amount: number | null;
  reinvested: boolean | null;
  detail: string | null;
  sharesDelta: number;
  cashDelta: number;
  account: string | null;
  isManual: boolean;
}

/** A unified income event — a ledger record or a projected bond coupon. */
export interface IncomeRow {
  key: string;
  date: string;
  ticker: string;
  name: string | null;
  amount: number | null;
  account: string | null;
  kind: "dividend" | "coupon";
  upcoming?: boolean;
  dividend?: DividendRecord;
}

/** The bond fields this needs — a structural subset of HoldingWithMetrics. */
export interface CouponSource {
  id: string;
  ticker: string;
  name: string | null;
  account: string | null;
  shares: number;
  couponRate?: number | null;
  couponFreq?: number | null;
  maturityDate?: string | null;
}

export interface IncomeSummary {
  rows: IncomeRow[];
  divTotal: number;
  divPending: number;
  pendingCount: number;
  couponReceived: number;
}

/** Coupon payments strictly after `from`, through `to`. */
export function upcomingCoupons(
  bond: CouponSource,
  from: string,
  to: string,
): { date: string; amount: number }[] {
  if (!bond.maturityDate) return [];
  const spec = {
    faceValue: bond.shares,
    couponRate: bond.couponRate ?? 0,
    couponFreq: bond.couponFreq ?? 2,
    maturityDate: bond.maturityDate,
  };
  const amount = couponAmount(spec);
  if (amount <= 0) return [];
  return couponDatesBetween(spec, from, to)
    .filter((date) => date > from) // a payment dated today is the ledger's to record
    .map((date) => ({ date, amount }));
}

/**
 * Merge recorded income (dividends + paid coupons) with projected coupons,
 * newest first, and total them.
 *
 * `today` and `horizon` are passed in rather than read from the clock so this
 * is deterministic under test.
 */
export function buildIncomeRows(opts: {
  dividends: DividendRecord[];
  bonds: CouponSource[];
  today: string;
  horizon: string;
}): IncomeSummary {
  const { dividends, bonds, today, horizon } = opts;

  /* One ledger, two kinds. Split before doing any arithmetic — the dividend
     totals must not absorb coupons, and the coupon total must not absorb
     dividends. */
  const divRecords = dividends.filter((d) => d.kind !== "coupon");
  const couponRecords = dividends.filter((d) => d.kind === "coupon");

  /* A dividend is income on its PAY date, not its ex-date. Anything without a
     pay date that has arrived is `upcoming` — it shows a Pending badge and is
     excluded from the received total, exactly like an unpaid coupon. */
  const divRows: IncomeRow[] = divRecords.map((d) => ({
    key: `div-${d.id}`,
    date: d.date,
    ticker: d.ticker,
    name: d.name,
    amount: d.amount,
    account: d.account,
    kind: "dividend",
    upcoming: d.paid === false,
    dividend: d,
  }));

  // Coupons that actually paid — cash really moved for each of these.
  const paidCouponRows: IncomeRow[] = couponRecords.map((c) => ({
    key: `cpn-${c.id}`,
    date: c.date,
    ticker: c.ticker,
    name: c.name,
    amount: c.amount,
    account: c.account,
    kind: "coupon",
    upcoming: false,
  }));

  /* Coupons still to come. Anything the ledger already recorded is excluded by
     (holding, date) rather than by date alone — a date-only check would let a
     same-day payment show up twice on the day the sweep runs, and would also
     miss a late catch-up payment whose date is now in the past. */
  const recorded = new Set(couponRecords.map((c) => `${c.holdingId}|${c.date}`));
  const upcomingCouponRows: IncomeRow[] = [];
  for (const b of bonds) {
    for (const c of upcomingCoupons(b, today, horizon)) {
      if (recorded.has(`${b.id}|${c.date}`)) continue;
      upcomingCouponRows.push({
        key: `cpn-next-${b.id}-${c.date}`,
        date: c.date,
        ticker: b.ticker,
        name: b.name,
        amount: c.amount,
        account: b.account,
        kind: "coupon",
        upcoming: true,
      });
    }
  }

  const rows = [...divRows, ...paidCouponRows, ...upcomingCouponRows].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );

  // Received vs pending are reported separately rather than as one blended
  // number — money that hasn't been paid out shouldn't inflate income, but it
  // shouldn't be invisible either.
  const paidDivs = divRecords.filter((d) => d.paid !== false);
  const unpaidDivs = divRecords.filter((d) => d.paid === false);
  return {
    rows,
    divTotal: paidDivs.reduce((s, d) => s + (d.amount ?? 0), 0),
    divPending: unpaidDivs.reduce((s, d) => s + (d.amount ?? 0), 0),
    pendingCount: unpaidDivs.length,
    couponReceived: couponRecords.reduce((s, c) => s + (c.amount ?? 0), 0),
  };
}
