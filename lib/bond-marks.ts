/**
 * Turn stored bond holdings into live marks + analytics. Shared by
 * /api/bonds/marks (Accounts + dashboard pricing) and the snapshot writers so
 * bond value in daily history matches what the UI shows.
 *
 * "Smart auto" pricing by bond_type:
 *   • treasury / agency → discount cash flows at the interpolated Treasury curve
 *   • corporate / muni  → hold at cost, unless a manual mark or explicit
 *                         curve+spread is set (no reliable free credit feed)
 *   • cd                → par (held to maturity, non-tradable)
 *   • etf               → NOT handled here — priced by the normal /api/quotes path
 * A `manual` price_source always wins; `cost` forces hold-at-cost.
 */

import { bondAnalytics, priceAtYield, yearsToMaturity, type BondSpec } from "./bond-math";
import { getTreasuryCurve, interpolateYield, type TreasuryCurve } from "./treasury-curve";
import type { BondMetrics, BondPriceSource, DayCount } from "./types";

/** Minimal DB shape needed to mark a bond (a subset of a holdings row). */
export interface BondRow {
  id: string;
  ticker?: string | null;
  shares: number; // face value
  cost_basis: number; // clean purchase price / 100
  bond_type?: string | null;
  coupon_rate?: number | null;
  coupon_freq?: number | null;
  maturity_date?: string | null;
  day_count?: string | null;
  price_source?: string | null;
  manual_price?: number | null; // clean price per 100
  credit_spread_bps?: number | null;
}

export interface BondMark extends BondMetrics {
  id: string;
  /** Clean price / 100 — drops straight into `currentPrice` (the face-value trick). */
  currentPrice: number;
}

function cleanPriceFor(row: BondRow, curve: TreasuryCurve | null, asOf: Date): { clean: number; source: BondPriceSource } {
  const costClean = row.cost_basis * 100;
  const source = (row.price_source as BondPriceSource) ?? "auto";

  if (source === "manual" && row.manual_price != null) return { clean: row.manual_price, source: "manual" };
  if (source === "cost") return { clean: costClean, source: "cost" };

  const type = row.bond_type ?? "";
  const spec = specOf(row);

  if (type === "cd") return { clean: 100, source: "auto" };

  const wantsCurve = type === "treasury" || type === "agency" || source === "curve";
  if (wantsCurve && curve && row.maturity_date) {
    const yrs = yearsToMaturity(row.maturity_date, asOf);
    const base = interpolateYield(curve, yrs);
    const spread = (row.credit_spread_bps ?? 0) / 100; // bps → percent
    const clean = priceAtYield(spec, base + spread, asOf);
    if (Number.isFinite(clean) && clean > 0) return { clean, source: source === "curve" ? "curve" : "auto" };
  }

  // corporate / muni with no manual mark, or any bond when the curve is down.
  return { clean: costClean, source: "cost" };
}

function specOf(row: BondRow): BondSpec {
  return {
    faceValue: row.shares,
    couponRate: row.coupon_rate ?? 0,
    couponFreq: row.coupon_freq ?? 2,
    maturityDate: row.maturity_date ?? "",
    dayCount: (row.day_count as DayCount) ?? "actual/actual",
  };
}

/** Mark one bond row. Returns null for ETFs and rows lacking a maturity. */
export function markBond(row: BondRow, curve: TreasuryCurve | null, asOf: Date): BondMark | null {
  if (row.bond_type === "etf") return null; // priced via /api/quotes
  if (!row.maturity_date) {
    // Not enough to model — hold at cost so value/gain still work.
    const clean = row.cost_basis * 100;
    return { id: row.id, currentPrice: row.cost_basis, ...zeroMetrics(clean, "cost") };
  }
  const { clean, source } = cleanPriceFor(row, curve, asOf);
  const a = bondAnalytics(specOf(row), clean, asOf);
  return {
    id: row.id,
    currentPrice: clean / 100,
    cleanPrice: a.cleanPrice,
    dirtyPrice: a.dirtyPrice,
    accrued: a.accrued,
    ytm: a.ytm,
    currentYield: a.currentYield,
    modifiedDuration: a.modifiedDuration,
    macaulayDuration: a.macaulayDuration,
    dv01: a.dv01,
    annualIncome: a.annualIncome,
    nextCouponDate: a.nextCouponDate,
    nextCouponAmount: a.nextCouponAmount,
    source,
  };
}

function zeroMetrics(clean: number, source: BondPriceSource): BondMetrics {
  return {
    cleanPrice: clean,
    dirtyPrice: clean,
    accrued: 0,
    ytm: 0,
    currentYield: 0,
    modifiedDuration: 0,
    macaulayDuration: 0,
    dv01: 0,
    annualIncome: 0,
    nextCouponDate: null,
    nextCouponAmount: 0,
    source,
  };
}

/** Mark many bond rows; fetches the Treasury curve once. Keyed by holding id. */
export async function computeBondMarks(rows: BondRow[], asOf = new Date()): Promise<Record<string, BondMark>> {
  const nonEtf = rows.filter((r) => r.bond_type !== "etf");
  if (nonEtf.length === 0) return {};
  const needsCurve = nonEtf.some(
    (r) => r.bond_type === "treasury" || r.bond_type === "agency" || r.price_source === "curve",
  );
  const curve = needsCurve ? await getTreasuryCurve() : null;
  const out: Record<string, BondMark> = {};
  for (const r of nonEtf) {
    const m = markBond(r, curve, asOf);
    if (m) out[r.id] = m;
  }
  return out;
}
