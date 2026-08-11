/**
 * Coupon + redemption schedule math — pure functions, no I/O.
 *
 * lib/bond-math.ts answers "what is this bond worth right now"; this answers
 * "what does it PAY, and when". The two were previously the same gap: coupons
 * existed only as a projection (`nextCouponDate` on the analytics, drawn as the
 * ladder in FixedIncomeView) and nothing ever turned one into cash. The applier
 * that does that lives in lib/bond-lifecycle.ts — everything here stays pure so
 * it tests without a database or a browser.
 *
 * Amounts are in dollars, scaled to the held face value. A coupon's SIZE never
 * depends on the day count — that only weights accrued interest between dates.
 * A period's coupon is always `face × rate / freq`.
 */

import { addMonths } from "./bond-math";

export interface CouponBond {
  /** Face value held, in dollars of par. */
  faceValue: number;
  /** Annual coupon rate, percent of par (e.g. 4.25). 0 = zero-coupon. */
  couponRate: number;
  /** Coupon payments per year (2 = semiannual). */
  couponFreq: number;
  /** Maturity date (ISO yyyy-mm-dd) — the anchor the whole schedule hangs off. */
  maturityDate: string;
}

export interface CouponPayment {
  /** Payment date, ISO yyyy-mm-dd. */
  date: string;
  /** Dollars paid on that date for the held face value. */
  amount: number;
}

/** A bond's life can't plausibly exceed this many coupon periods (100y monthly). */
const MAX_PERIODS = 1200;

function toDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Dollars paid per coupon period. 0 for a zero-coupon bond. */
export function couponAmount(bond: CouponBond): number {
  const freq = Math.trunc(bond.couponFreq);
  if (!Number.isFinite(bond.couponRate) || bond.couponRate <= 0) return 0;
  if (!Number.isFinite(freq) || freq <= 0) return 0;
  if (!Number.isFinite(bond.faceValue) || bond.faceValue <= 0) return 0;
  return (bond.faceValue * bond.couponRate) / 100 / freq;
}

/**
 * Every coupon payment date in `[from, to]` (both inclusive), ascending.
 *
 * Generated backwards from maturity, exactly like bond-math's forward-looking
 * `couponSchedule`, and anchored on the maturity date the same way — the k-th
 * date back is `maturity − k periods` computed from maturity itself, so an
 * Aug-31 maturity keeps yielding Aug-31 / Feb-28 rather than drifting onto the
 * 28th permanently after the first short month.
 *
 * The final coupon falls ON the maturity date; that is the payment the
 * redemption sweep has to let through before it closes the position.
 */
export function couponDatesBetween(bond: CouponBond, from: string, to: string): string[] {
  const freq = Math.trunc(bond.couponFreq);
  if (!Number.isFinite(freq) || freq <= 0) return [];
  if (!bond.maturityDate) return [];
  const step = Math.max(1, Math.round(12 / freq));
  const maturity = toDate(bond.maturityDate);
  const fromMs = toDate(from).getTime();
  const toMs = toDate(to).getTime();
  if (fromMs > toMs) return [];

  const out: string[] = [];
  for (let k = 0; k < MAX_PERIODS; k++) {
    const d = addMonths(maturity, -k * step);
    const ms = d.getTime();
    if (ms < fromMs) break; // walking backwards — everything earlier is earlier still
    if (ms <= toMs) out.push(isoOf(d));
  }
  return out.reverse();
}

/**
 * Coupons the HOLDER is entitled to in `[from, to]`.
 *
 * Entitlement mirrors the dividend rule in lib/corporate-actions.ts: the
 * position must have been owned BEFORE the payment date. Buying on the day a
 * coupon pays does not earn it — the seller does, via the accrued interest the
 * buyer pays them at settlement. `acquiredDate: null` means the holding
 * predates the app (unknown acquisition), which is treated as entitled, again
 * matching the dividend path.
 *
 * ⚠️ Known asymmetry, deliberate: we credit the FULL coupon to whoever holds
 * the bond on the payment date, but the Add Bond form records only the clean
 * purchase price — it never debits the accrued interest a buyer actually pays
 * the seller at settlement. So a bond bought mid-period collects a full coupon
 * it only partly earned. Fixing that belongs on the purchase side (capture
 * accrued at entry), not here; crediting a partial coupon instead would be
 * wrong in the opposite direction, since the full coupon is what really lands.
 */
export function couponsDue(
  bond: CouponBond,
  opts: { from: string; to: string; acquiredDate?: string | null },
): CouponPayment[] {
  const amount = couponAmount(bond);
  if (amount <= 0) return []; // zero-coupon / malformed → nothing to pay, no $0 rows
  const acquired = opts.acquiredDate ?? null;
  return couponDatesBetween(bond, opts.from, opts.to)
    .filter((date) => acquired === null || acquired < date)
    .map((date) => ({ date, amount }));
}

/** True once `asOf` is on or past the maturity date. */
export function isMatured(maturityDate: string | null | undefined, asOf: string): boolean {
  if (!maturityDate) return false;
  return maturityDate.slice(0, 10) <= asOf.slice(0, 10);
}

/**
 * Principal returned at maturity. Par redemption — dollars of face value.
 *
 * Split out rather than inlined as `faceValue` so that a called bond or a
 * premium redemption has one obvious place to land later, and so the caller
 * reads as "proceeds", not "shares".
 */
export function redemptionProceeds(faceValue: number): number {
  return Number.isFinite(faceValue) && faceValue > 0 ? faceValue : 0;
}

/**
 * The clean price a redemption books at, per the face-value trick used
 * throughout (holdings.cost_basis = clean price / 100). Par = 1.00, so a bond
 * bought at 97 records a realized gain of (1.00 − 0.97) × face.
 */
export const REDEMPTION_PRICE = 1;
