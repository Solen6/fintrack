export type AccountType = string;

export type InstrumentType = "equity" | "bond" | "option" | "future";
export type BondType = "treasury" | "cd" | "corporate" | "muni" | "agency" | "etf";
export type DayCount = "actual/actual" | "30/360" | "actual/365";
export type BondPriceSource = "auto" | "manual" | "cost" | "curve";
export type OptionType = "CALL" | "PUT";
export type Direction = "LONG" | "SHORT";

/**
 * Bond fields carried on a Holding when `instrumentType === "bond"`. See
 * supabase/bonds.sql for the "face-value trick": for a bond, `shares` is the
 * face value in dollars of par and `currentPrice`/`costBasis` are the clean
 * price / 100, so all value/cost/gain math is unchanged.
 */
export interface BondFields {
  bondType?: BondType;
  cusip?: string;
  /** Annual coupon rate as a percent of par, e.g. 4.25. */
  couponRate?: number;
  /** Coupon payments per year (2 = semiannual). */
  couponFreq?: number;
  maturityDate?: string;
  issueDate?: string;
  dayCount?: DayCount;
  priceSource?: BondPriceSource;
  /** User clean-price override (per 100 of par), used when priceSource === "manual". */
  manualPrice?: number;
  creditSpreadBps?: number;
}

/**
 * Option/future fields carried on a Holding when `instrumentType` is
 * "option" or "future". See supabase/holdings-derivatives.sql for the
 * "effective shares" trick: `shares` is contracts × multiplier × sign(direction),
 * `currentPrice`/`costBasis` are price PER UNIT (not per contract), so all
 * value/cost/gain math is unchanged — a SHORT position's costTotal comes out
 * negative, correctly representing a credit received rather than a cost paid.
 */
export interface DerivativeFields {
  underlying?: string;
  expiry?: string;
  strike?: number;
  optionType?: OptionType;
  /** $ per 1.00 price move per contract — 100 for options, varies for futures. */
  multiplier?: number;
  direction?: Direction;
  /** Legs of one multi-leg strategy (iron condor, spread, …) share a combo id. */
  comboId?: string;
  /** Live implied vol (decimal) from the option chain — attached at merge time, not stored. */
  iv?: number;
  /** Live underlying spot price — attached at merge time, not stored. */
  underlyingSpot?: number;
}

/** Live fixed-income analytics for a bond row, computed by lib/bond-math. */
export interface BondMetrics {
  /** Live clean price per 100 of par, e.g. 98.50. */
  cleanPrice: number;
  /** Clean + accrued, per 100 of par. */
  dirtyPrice: number;
  /** Accrued interest in dollars for the held face value. */
  accrued: number;
  /** Yield to maturity, percent. */
  ytm: number;
  /** Current yield (annual coupon / clean price), percent. */
  currentYield: number;
  /** Modified duration, years. */
  modifiedDuration: number;
  macaulayDuration: number;
  /** Dollar value change for a 1bp yield move (DV01), for the held face value. */
  dv01: number;
  /** Projected annual coupon income in dollars for the held face value. */
  annualIncome: number;
  nextCouponDate: string | null;
  /** Next coupon payment in dollars for the held face value. */
  nextCouponAmount: number;
  source: BondPriceSource;
}

export interface Holding extends BondFields, DerivativeFields {
  id: string;
  ticker: string;
  name: string;
  sector: string;
  shares: number;
  costBasis: number;
  currentPrice: number;
  account: AccountType;
  notes?: string;
  /* Dividend handling: true = reinvest (DRIP), false = pay to cash. */
  drip?: boolean;
  instrumentType?: InstrumentType;
  /** When the position was acquired — a same-day buy measures its daily gain
      from cost instead of yesterday's close. Null = predates the app. */
  acquiredAt?: string | null;
  /** Present on bond rows once priced by /api/bonds/marks. */
  bondMetrics?: BondMetrics;
}

/** True when a holding should render/behave as a bond rather than an equity. */
export function isBond(h: { instrumentType?: InstrumentType }): boolean {
  return h.instrumentType === "bond";
}

/**
 * True when a holding uses the face-value encoding (shares = par, price =
 * clean/100). Bond ETFs are bonds but keep normal per-share equity semantics,
 * so they return false here.
 */
export function isFaceValueBond(h: { instrumentType?: InstrumentType; bondType?: BondType }): boolean {
  return h.instrumentType === "bond" && h.bondType !== "etf";
}

/** True for a real-brokerage option or future position (not the paper simulator). */
export function isDerivative(h: { instrumentType?: InstrumentType }): boolean {
  return h.instrumentType === "option" || h.instrumentType === "future";
}

export type SortField =
  | "ticker"
  | "name"
  | "sector"
  | "shares"
  | "value"
  | "gainDollar"
  | "gainPercent";

export type SortDir = "asc" | "desc";

export interface SortState {
  field: SortField;
  dir: SortDir;
}

export interface HoldingWithMetrics extends Holding {
  value: number;
  costTotal: number;
  gainDollar: number;
  gainPercent: number;
  todayChangePct: number;
}

export interface Quote {
  ticker: string;
  price: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
}

export function computeMetrics(h: Holding, todayChangePct = 0): HoldingWithMetrics {
  const value = h.shares * h.currentPrice;
  const costTotal = h.shares * h.costBasis;
  const gainDollar = value - costTotal;
  // A short derivative's costTotal is negative (it's a credit received, not
  // a cost paid) — divide by magnitude so gainPercent keeps the right sign
  // instead of silently returning 0 whenever costTotal < 0.
  const gainPercent = costTotal !== 0 ? (gainDollar / Math.abs(costTotal)) * 100 : 0;
  return { ...h, value, costTotal, gainDollar, gainPercent, todayChangePct };
}
