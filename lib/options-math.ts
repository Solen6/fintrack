/**
 * Options math — a self-contained Black-Scholes engine for the strategy builder.
 *
 * Everything here is pure and unit-testable. We compute our own Greeks because
 * Yahoo's option chain (lib/yahoo.ts) returns price/IV but no Greeks.
 *
 * Simplifications (clearly a sim, surfaced in the UI footnote):
 *  - No dividend yield (q = 0).
 *  - Flat risk-free rate (RISK_FREE).
 *  - Payoff/breakevens are at expiry (intrinsic value), single-expiry strategies only.
 */

export const RISK_FREE = 0.043; // ~current 1Y T-bill; could later read 10Y from /api/macro
export const OPTION_MULTIPLIER = 100;

export type OptionType = "call" | "put" | "stock";
export type Side = "long" | "short";

export interface Leg {
  type: OptionType;
  side: Side;
  /** Option strike. For a stock leg this is the entry price (= spot at open). */
  strike: number;
  /** Expiry in unix seconds. Ignored for stock legs. */
  expiry: number;
  /** Contracts for options, shares for stock. */
  qty: number;
  /** Per-share premium for options; entry price per share for stock. */
  premium: number;
  /** Implied vol as a decimal (0.30 = 30%). 0 for stock. */
  iv: number;
}

export interface PayoffPoint {
  price: number;
  pl: number;
}

export interface Greeks {
  delta: number; // share-equivalents
  gamma: number;
  theta: number; // $ per day
  vega: number; // $ per 1 vol point (1%)
}

const sign = (s: Side) => (s === "long" ? 1 : -1);
const mult = (l: Leg) => (l.type === "stock" ? l.qty : l.qty * OPTION_MULTIPLIER);

/* ─── Normal distribution helpers ─── */

// Abramowitz & Stegun 7.1.26 erf approximation.
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

/** Standard normal CDF. */
export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Standard normal PDF. */
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/* ─── Black-Scholes ─── */

interface BSInputs {
  type: "call" | "put";
  S: number;
  K: number;
  T: number; // years
  r: number;
  sigma: number;
}

function d1d2({ S, K, T, r, sigma }: BSInputs) {
  const vt = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / vt;
  return { d1, d2: d1 - vt };
}

/** Black-Scholes fair value of one option (per share). */
export function bsPrice(args: BSInputs): number {
  const { type, S, K, T, r, sigma } = args;
  if (T <= 0 || sigma <= 0) {
    return type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  const { d1, d2 } = d1d2(args);
  const disc = K * Math.exp(-r * T);
  return type === "call"
    ? S * normCdf(d1) - disc * normCdf(d2)
    : disc * normCdf(-d2) - S * normCdf(-d1);
}

/**
 * Recover implied volatility from an option's market price by inverting
 * Black-Scholes (bisection — no derivative, robust at the wings). Used as a
 * fallback when the data feed doesn't supply IV for a contract. Returns null if
 * the price sits outside the no-arbitrage band or it fails to converge.
 */
export function impliedVol(args: { type: "call" | "put"; S: number; K: number; T: number; r: number; price: number }): number | null {
  const { type, S, K, T, r, price } = args;
  if (T <= 0 || price <= 0 || S <= 0 || K <= 0) return null;
  const disc = K * Math.exp(-r * T);
  const intrinsic = type === "call" ? Math.max(S - disc, 0) : Math.max(disc - S, 0);
  const upper = type === "call" ? S : disc; // call ≤ S, put ≤ discounted strike
  if (price <= intrinsic + 1e-6 || price >= upper) return null;

  const f = (sigma: number) => bsPrice({ type, S, K, T, r, sigma }) - price;
  let lo = 1e-4, hi = 5; // 0.01% … 500% vol
  if (f(lo) > 0 || f(hi) < 0) return null; // price not bracketed
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (Math.abs(fm) < 1e-5) return mid;
    if (fm > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Per-share Greeks for one option (theta in $/day, vega per 1% vol). */
export function bsGreeks(args: BSInputs): Greeks {
  const { type, S, K, T, r, sigma } = args;
  if (T <= 0 || sigma <= 0) {
    const itm = type === "call" ? S > K : S < K;
    return { delta: itm ? (type === "call" ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0 };
  }
  const { d1, d2 } = d1d2(args);
  const pdf = normPdf(d1);
  const sqrtT = Math.sqrt(T);
  const disc = K * Math.exp(-r * T);

  const delta = type === "call" ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (S * sigma * sqrtT);
  const vega = (S * pdf * sqrtT) / 100;
  const thetaAnnual =
    type === "call"
      ? -(S * pdf * sigma) / (2 * sqrtT) - r * disc * normCdf(d2)
      : -(S * pdf * sigma) / (2 * sqrtT) + r * disc * normCdf(-d2);

  return { delta, gamma, vega, theta: thetaAnnual / 365 };
}

/* ─── Payoff at expiry ─── */

function intrinsic(type: OptionType, S_T: number, K: number): number {
  if (type === "call") return Math.max(S_T - K, 0);
  if (type === "put") return Math.max(K - S_T, 0);
  return S_T; // stock: value = price
}

/** Total position P/L ($) if the underlying settles at S_T (premiums netted in). */
export function payoffAt(legs: Leg[], S_T: number): number {
  let pl = 0;
  for (const l of legs) {
    const value = intrinsic(l.type, S_T, l.strike) - l.premium; // per share, vs entry
    pl += sign(l.side) * value * mult(l);
  }
  return pl;
}

/**
 * Total position P/L ($) if the underlying is at `S` at calendar time `tSec`
 * (unix seconds). Before expiry, option legs are valued with Black-Scholes on
 * their *remaining* time, so this captures time decay — the basis for the
 * price×date P/L matrix. At/after a leg's expiry it falls back to intrinsic
 * value, so at expiry this equals payoffAt().
 */
export function payoffAtTime(legs: Leg[], S: number, tSec: number, r = RISK_FREE, ivScale = 1): number {
  let pl = 0;
  for (const l of legs) {
    let value: number;
    if (l.type === "stock") {
      value = S;
    } else {
      const T = Math.max((l.expiry - tSec) / (365 * 86400), 0);
      // ivScale lets the UI model an IV shift (e.g. post-earnings crush). The
      // entry premium is unchanged — only the live mark re-prices.
      value = bsPrice({ type: l.type, S, K: l.strike, T, r, sigma: l.iv * ivScale });
    }
    pl += sign(l.side) * (value - l.premium) * mult(l);
  }
  return pl;
}

/** Build a payoff curve from S_T = 0 up to `hi` over `steps` points. */
export function aggregatePayoff(legs: Leg[], hi: number, steps = 240): PayoffPoint[] {
  const out: PayoffPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const price = (hi * i) / steps;
    out.push({ price, pl: payoffAt(legs, price) });
  }
  return out;
}

/** Suggested upper bound for the price axis — covers all strikes and ~2.2× spot. */
export function priceAxisMax(legs: Leg[], spot: number): number {
  const strikes = legs.filter((l) => l.type !== "stock").map((l) => l.strike);
  return Math.max(spot * 2.2, ...strikes.map((k) => k * 1.4), spot * 1.1);
}

/** Underlying prices where total P/L crosses zero (linear interpolation). */
export function breakevens(points: PayoffPoint[]): number[] {
  const bes: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.pl === 0) bes.push(a.price);
    else if (a.pl < 0 !== b.pl < 0) {
      const t = -a.pl / (b.pl - a.pl);
      bes.push(a.price + t * (b.price - a.price));
    }
  }
  return bes;
}

export interface PayoffSummary {
  maxProfit: number; // Infinity = unbounded
  maxLoss: number; // negative; -Infinity = unbounded
  breakevens: number[];
  netCost: number; // >0 debit paid, <0 credit received
}

/** Net cost to open: >0 = debit (you pay), <0 = credit (you receive). */
export function netCost(legs: Leg[]): number {
  let cost = 0;
  for (const l of legs) cost += sign(l.side) * l.premium * mult(l);
  return cost;
}

/** Max profit / loss over the curve, with right-edge slope used to flag unbounded P/L.
 *  The left edge is S_T = 0 (a real floor — the underlying can't go negative). */
export function summarize(legs: Leg[], points: PayoffPoint[]): PayoffSummary {
  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  for (const p of points) {
    if (p.pl > maxProfit) maxProfit = p.pl;
    if (p.pl < maxLoss) maxLoss = p.pl;
  }
  const n = points.length;
  const slope = points[n - 1].pl - points[n - 2].pl;
  if (slope > 1e-6) maxProfit = Infinity;
  if (slope < -1e-6) maxLoss = -Infinity;
  return { maxProfit, maxLoss, breakevens: breakevens(points), netCost: netCost(legs) };
}

/* ─── Net Greeks ─── */

/** Position Greeks (delta in share-equivalents; gamma/theta/vega summed across option legs). */
export function netGreeks(legs: Leg[], S: number, r = RISK_FREE): Greeks {
  const acc: Greeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  const nowSec = Date.now() / 1000;
  for (const l of legs) {
    if (l.type === "stock") {
      acc.delta += sign(l.side) * l.qty; // 1 share-delta per share
      continue;
    }
    const T = Math.max((l.expiry - nowSec) / (365 * 86400), 0);
    const g = bsGreeks({ type: l.type, S, K: l.strike, T, r, sigma: l.iv });
    const s = sign(l.side);
    const m = l.qty * OPTION_MULTIPLIER;
    acc.delta += s * g.delta * m;
    acc.gamma += s * g.gamma * m;
    acc.theta += s * g.theta * m;
    acc.vega += s * g.vega * m;
  }
  return acc;
}

/* ─── Probability of profit ─── */

/**
 * Probability that the position is profitable at expiry, under a lognormal
 * terminal-price model: ln(S_T) ~ N(ln S + (r − σ²/2)T, σ²T).
 * Integrates that density over the price regions where payoff > 0.
 */
export function probabilityOfProfit(
  points: PayoffPoint[],
  S: number,
  sigma: number,
  T: number,
  r = RISK_FREE
): number {
  if (sigma <= 0 || T <= 0 || S <= 0) return NaN;
  const sqrtT = sigma * Math.sqrt(T);
  const mu = Math.log(S) + (r - (sigma * sigma) / 2) * T;
  // CDF of S_T at price p.
  const cdf = (p: number) => (p <= 0 ? 0 : normCdf((Math.log(p) - mu) / sqrtT));

  let prob = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    // Use the midpoint sign to decide if this slice is profitable.
    if ((a.pl + b.pl) / 2 > 0) prob += cdf(b.price) - cdf(a.price);
  }
  // The grid stops at a finite max; if profit extends beyond (e.g. long call),
  // add the remaining upper tail.
  const last = points[points.length - 1];
  if (last.pl > 0) prob += 1 - cdf(last.price);
  return Math.min(Math.max(prob, 0), 1);
}
