/* ──────────────────────────────────────────────────────────────────────────
   Return & risk statistics. Everything here works on *simple* daily returns
   (r_t = p_t / p_{t-1} − 1) unless noted, and annualizes with 252 trading days.
   Pure functions — no I/O, no Date.now — so they're unit-testable against
   known values (see scratchpad tests).
   ────────────────────────────────────────────────────────────────────────── */

import { type Mat, type Vec } from "./matrix";

export const TRADING_DAYS = 252;

/** Simple daily returns from a close-price series (length N → N-1 returns). */
export function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev > 0) out.push(closes[i] / prev - 1);
    else out.push(0);
  }
  return out;
}

export function mean(x: number[]): number {
  if (x.length === 0) return 0;
  let s = 0;
  for (const v of x) s += v;
  return s / x.length;
}

/** Sample variance (n-1). Population when sample=false. */
export function variance(x: number[], sample = true): number {
  const n = x.length;
  if (n < 2) return 0;
  const m = mean(x);
  let s = 0;
  for (const v of x) s += (v - m) * (v - m);
  return s / (sample ? n - 1 : n);
}

export function stdev(x: number[], sample = true): number {
  return Math.sqrt(variance(x, sample));
}

/** Annualized volatility from daily returns. */
export function annualizedVol(daily: number[]): number {
  return stdev(daily, true) * Math.sqrt(TRADING_DAYS);
}

/** Arithmetic annualized return (mean daily × 252) — the input the mean-variance
    optimizer expects for expected returns. */
export function annualizedMeanReturn(daily: number[]): number {
  return mean(daily) * TRADING_DAYS;
}

/** Geometric annualized return (CAGR) from a daily-return series. */
export function annualizedGeoReturn(daily: number[]): number {
  if (daily.length === 0) return 0;
  let growth = 1;
  for (const r of daily) growth *= 1 + r;
  return Math.pow(growth, TRADING_DAYS / daily.length) - 1;
}

/** Cumulative equity curve from daily returns, starting at `start`. */
export function equityCurve(daily: number[], start = 1): number[] {
  const out: number[] = [start];
  let v = start;
  for (const r of daily) {
    v *= 1 + r;
    out.push(v);
  }
  return out;
}

/** Covariance of two equal-length return series (sample, n-1). */
export function covariance(a: number[], b: number[], sample = true): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (sample ? n - 1 : n);
}

/** Beta of an asset vs the market: cov(asset, mkt) / var(mkt). */
export function beta(asset: number[], market: number[]): number {
  const v = variance(market, true);
  if (v === 0) return 0;
  return covariance(asset, market) / v;
}

/**
 * Sharpe ratio from a daily-return series.
 * rfAnnual is the annual risk-free rate (e.g. 0.043). Uses geometric annual
 * return in the numerator and annualized vol in the denominator.
 */
export function sharpe(daily: number[], rfAnnual = 0.043): number {
  const vol = annualizedVol(daily);
  if (vol === 0) return 0;
  return (annualizedGeoReturn(daily) - rfAnnual) / vol;
}

/** Downside deviation (annualized) below a daily target return. */
export function downsideDeviation(daily: number[], targetDaily = 0): number {
  if (daily.length === 0) return 0;
  let s = 0;
  for (const r of daily) {
    const d = Math.min(0, r - targetDaily);
    s += d * d;
  }
  return Math.sqrt(s / daily.length) * Math.sqrt(TRADING_DAYS);
}

/** Sortino ratio: excess geometric return over annualized downside deviation. */
export function sortino(daily: number[], rfAnnual = 0.043): number {
  const dd = downsideDeviation(daily, rfAnnual / TRADING_DAYS);
  if (dd === 0) return 0;
  return (annualizedGeoReturn(daily) - rfAnnual) / dd;
}

export interface Drawdown {
  /** Max drawdown as a negative fraction, e.g. -0.234 for -23.4%. */
  maxDrawdown: number;
  peakIndex: number;
  troughIndex: number;
}

/** Maximum drawdown of an equity curve (peak-to-trough). */
export function maxDrawdown(equity: number[]): Drawdown {
  let peak = equity[0] ?? 1;
  let peakIdx = 0;
  let maxDD = 0;
  let ddPeakIdx = 0;
  let ddTroughIdx = 0;
  for (let i = 0; i < equity.length; i++) {
    if (equity[i] > peak) {
      peak = equity[i];
      peakIdx = i;
    }
    const dd = equity[i] / peak - 1;
    if (dd < maxDD) {
      maxDD = dd;
      ddPeakIdx = peakIdx;
      ddTroughIdx = i;
    }
  }
  return { maxDrawdown: maxDD, peakIndex: ddPeakIdx, troughIndex: ddTroughIdx };
}

/** Max drawdown computed directly from a daily-return series. */
export function maxDrawdownFromReturns(daily: number[]): Drawdown {
  return maxDrawdown(equityCurve(daily, 1));
}

/**
 * Historical Value-at-Risk and Conditional VaR at a confidence level (e.g.
 * 0.95). Returns positive magnitudes of the daily loss (0.021 = 2.1% loss).
 */
export function historicalVaR(daily: number[], confidence = 0.95): { var: number; cvar: number } {
  if (daily.length === 0) return { var: 0, cvar: 0 };
  const sorted = [...daily].sort((a, b) => a - b); // worst first
  const idx = Math.max(0, Math.floor((1 - confidence) * sorted.length) - 1);
  const varLoss = -sorted[idx];
  let tailSum = 0;
  let count = 0;
  for (let i = 0; i <= idx; i++) {
    tailSum += sorted[i];
    count++;
  }
  const cvar = count > 0 ? -(tailSum / count) : varLoss;
  return { var: Math.max(0, varLoss), cvar: Math.max(0, cvar) };
}

/**
 * Weighted portfolio daily-return series from a matrix of per-asset daily
 * returns (assets × T) and weights (length = assets).
 */
export function portfolioReturns(returnsByAsset: Mat, weights: Vec): number[] {
  const n = returnsByAsset.length;
  if (n === 0) return [];
  const T = returnsByAsset[0].length;
  const out = new Array(T).fill(0);
  for (let a = 0; a < n; a++) {
    const w = weights[a];
    const row = returnsByAsset[a];
    for (let t = 0; t < T; t++) out[t] += w * row[t];
  }
  return out;
}

/** Daily covariance matrix from per-asset daily returns (assets × T). */
export function covarianceMatrix(returnsByAsset: Mat, sample = true): Mat {
  const n = returnsByAsset.length;
  const cov: Mat = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const c = covariance(returnsByAsset[i], returnsByAsset[j], sample);
      cov[i][j] = c;
      cov[j][i] = c;
    }
  }
  return cov;
}

/** Correlation matrix from per-asset daily returns (assets × T). */
export function correlationMatrix(returnsByAsset: Mat): Mat {
  const cov = covarianceMatrix(returnsByAsset);
  const n = cov.length;
  const sd = cov.map((_, i) => Math.sqrt(cov[i][i]));
  const corr: Mat = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const denom = sd[i] * sd[j];
      corr[i][j] = denom > 0 ? cov[i][j] / denom : i === j ? 1 : 0;
    }
  }
  return corr;
}

/** Annualize a daily covariance matrix (×252). */
export function annualizeCov(dailyCov: Mat): Mat {
  return dailyCov.map((row) => row.map((v) => v * TRADING_DAYS));
}

/**
 * Herfindahl-Hirschman Index of a set of weights (each in [0,1]). Uses absolute
 * weights so shorts still count as concentration. 1/HHI ≈ effective N.
 */
export function herfindahl(weights: number[]): number {
  const total = weights.reduce((s, w) => s + Math.abs(w), 0);
  if (total === 0) return 0;
  let hhi = 0;
  for (const w of weights) {
    const p = Math.abs(w) / total;
    hhi += p * p;
  }
  return hhi;
}
