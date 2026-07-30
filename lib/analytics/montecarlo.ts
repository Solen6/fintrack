/* ──────────────────────────────────────────────────────────────────────────
   Monte-Carlo projection of a portfolio's future value.

   Everything is driven by a seeded PRNG (mulberry32) so results are
   deterministic and reproducible — no Math.random, so it's safe to run during
   render without hydration drift.

   ── Engines ──
   • bootstrap-iid   resample the portfolio's own historical daily returns with
                     replacement, one day at a time. Non-parametric, keeps the
                     fat tails and skew the market actually showed, but destroys
                     volatility clustering: real crashes are RUNS of bad days,
                     and drawing days independently sprinkles them across the
                     horizon. Terminal vol comes out about right; drawdown risk
                     is understated.
   • bootstrap-block stationary bootstrap (Politis & Romano 1994). Resamples
                     contiguous stretches whose lengths are geometric with mean
                     `blockDays`, so momentum, mean-reversion and vol clustering
                     survive. This is the honest bootstrap for a long horizon.
   • normal          lognormal GBM from an annualized drift μ and vol σ.
   • student-t       same moments, but innovations are a standardized Student-t
                     with `df` degrees of freedom — far more weight in the tails
                     than a normal, which is what equity crashes actually look
                     like.

   ── Structure ──
   Assets are simulated INDIVIDUALLY unless the rebalance policy is
   "continuous", because a fixed-weight portfolio return series *is* a
   continuously-rebalanced portfolio. Simulating per asset is what makes
   "annual", "quarterly" and "never" (buy-and-hold, weights drift as winners
   compound) expressible at all. The bootstrap does it by resampling whole
   DATES across the asset matrix, so cross-asset correlation is preserved
   exactly and non-parametrically; the parametric engines use a Cholesky factor
   of the daily covariance.

   Both structures support contributions (with an annual escalation), taxable
   withdrawals under three rules, one-off lump sums, a fee drag, inflation, and
   reporting in today's dollars.
   ────────────────────────────────────────────────────────────────────────── */

import { TRADING_DAYS, annualizedGeoReturn, annualizedMeanReturn, annualizedVol, covarianceMatrix, portfolioReturns } from "./stats";
import { cholesky, type Mat, type Vec } from "./matrix";

/** Deterministic PRNG (mulberry32). Same seed → same stream. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard-normal sample via Box-Muller, using an injected uniform RNG. */
function gauss(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Box-Muller that keeps its second companion instead of throwing it away —
 * one log/sqrt/sin/cos per TWO normals rather than per one. Worth roughly a 2×
 * speedup on the parametric engines, where drawing normals is the whole cost.
 *
 * Stateful, so it must be built per path: an antithetic twin replays the same
 * uniform stream and needs the same normals to negate, which only holds if the
 * spare starts empty at each path boundary.
 */
function makeGauss(rng: () => number): () => number {
  let spare = 0;
  let hasSpare = false;
  return () => {
    if (hasSpare) {
      hasSpare = false;
      return spare;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const r = Math.sqrt(-2 * Math.log(u));
    const theta = 2 * Math.PI * v;
    spare = r * Math.sin(theta);
    hasSpare = true;
    return r * Math.cos(theta);
  };
}

/**
 * Gamma(shape, 1) sample — Marsaglia & Tsang (2000). Constant time, unlike
 * summing `df` squared normals, which is what makes Student-t affordable inside
 * a 190-million-step simulation.
 */
function gammaSample(rng: () => number, normal: () => number, shape: number): number {
  if (shape < 1) {
    // Boost into the shape ≥ 1 regime: G(k) = G(k+1) · U^(1/k).
    return gammaSample(rng, normal, shape + 1) * Math.pow(rng() || 1e-12, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const z = normal();
    const v0 = 1 + c * z;
    if (v0 <= 0) continue;
    const v = v0 * v0 * v0;
    const u = rng();
    if (u < 1 - 0.0331 * z * z * z * z) return d * v;
    if (Math.log(u || 1e-12) < 0.5 * z * z + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Chi-square with `df` degrees of freedom = 2·Gamma(df/2, 1). */
function chiSquare(rng: () => number, normal: () => number, df: number): number {
  return 2 * gammaSample(rng, normal, df / 2);
}

/* ─── Configuration ─── */

export type McEngineKind = "bootstrap-iid" | "bootstrap-block" | "normal" | "student-t";
export type RebalancePolicy = "continuous" | "annual" | "quarterly" | "never";
/** How a withdrawal amount is determined each period. */
export type WithdrawalKind = "fixed-real" | "fixed-nominal" | "percent-of-balance";

export interface McFlows {
  /** Dollars added every `contributionEveryDays` (0 = none). */
  contribution: number;
  contributionEveryDays: number;
  /** Annual % raise applied to the contribution each year (0 = flat). */
  contributionEscalationPct: number;
  /** Year contributions stop — retirement mode sets this. null = never stop. */
  contributionStopYear: number | null;
  /** Dollars taken out every `withdrawalEveryDays` (0 = none). */
  withdrawal: number;
  withdrawalEveryDays: number;
  withdrawalKind: WithdrawalKind;
  /** Annual % of balance, for `percent-of-balance`. Prorated per period. */
  withdrawalPct: number;
  /** Year withdrawals begin (0 = immediately). */
  withdrawalStartYear: number;
  /** One-off signed flows: + inflow (inheritance), − outflow (down payment). */
  lumpSums: { year: number; amount: number }[];
  /** All-in annual cost drag in basis points — expense ratios, advisory fees. */
  feeAnnualBps: number;
  /** Annual inflation as a percent. Drives fixed-real withdrawals and, when
      `reportReal` is set, the deflator applied to every reported number. */
  inflationPct: number;
  /** Report every value in today's dollars instead of future nominal dollars. */
  reportReal: boolean;
}

export const NO_FLOWS: McFlows = {
  contribution: 0,
  contributionEveryDays: 21,
  contributionEscalationPct: 0,
  contributionStopYear: null,
  withdrawal: 0,
  withdrawalEveryDays: 21,
  withdrawalKind: "fixed-real",
  withdrawalPct: 4,
  withdrawalStartYear: 0,
  lumpSums: [],
  feeAnnualBps: 0,
  inflationPct: 0,
  reportReal: false,
};

export interface McSpec {
  engine: McEngineKind;
  /** Mean block length in trading days for the stationary bootstrap. */
  blockDays: number;
  /** Degrees of freedom for Student-t innovations. Clamped to > 2 so the
      variance is finite (a t with df ≤ 2 has none). */
  df: number;
  rebalance: RebalancePolicy;
  /** Per-asset daily simple returns, assets × T. */
  returnsByAsset: Mat;
  /** Target weights, one per asset. Need not sum to 1 — normalized here. */
  weights: Vec;
  /**
   * Annualized assumptions to force instead of estimating from history. Either
   * field may be null to keep the historical estimate.
   *
   * `drift` is a target COMPOUND annual return and applies to every engine: the
   * bootstrap honors it by re-centering the resampled returns (a uniform daily
   * offset, which shifts the target-weight portfolio by exactly that offset).
   * `vol` only affects the parametric engines — rescaling a bootstrap's draws
   * would distort the very fat tails it exists to preserve.
   */
  assume: { drift: number | null; vol: number | null };
  /**
   * Escape hatch: hand the parametric engines an annualized ARITHMETIC mean
   * directly, skipping both history and `assume.drift`. Exists because that is
   * the form `gbmProjection` has always taken its drift in.
   */
  muArith?: number | null;
  /**
   * Draw each path's expected return from the sampling distribution of the
   * mean, SE ≈ σ/√years. An expected return estimated off two years of data
   * carries an error bar of roughly ±12%/yr; pretending the point estimate is
   * the truth is the single biggest way a 30-year projection lies.
   */
  parameterUncertainty: boolean;
  horizonDays: number;
  paths: number;
  seed: number;
  initialValue: number;
  flows: McFlows;
  /** How many individual paths to keep in full, for the spaghetti overlay. */
  keepPaths: number;
  /** Pair each parametric path with its mirror image to cut sampling error.
      Ignored by the bootstrap engines, where it has no meaning. */
  antithetic: boolean;
}

/** A spec with everything defaulted — spread over it and override what matters. */
export function defaultSpec(): McSpec {
  return {
    engine: "bootstrap-block",
    blockDays: 21,
    df: 5,
    rebalance: "annual",
    returnsByAsset: [],
    weights: [],
    assume: { drift: null, vol: null },
    parameterUncertainty: false,
    horizonDays: 10 * TRADING_DAYS,
    paths: 1000,
    seed: 20240501,
    initialValue: 10000,
    flows: { ...NO_FLOWS },
    keepPaths: 0,
    antithetic: false,
  };
}

/* ─── Results ─── */

export interface McBand {
  day: number;
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
}

export interface McRun {
  /** Trading-day offsets the bands and columns are sampled at. */
  sampleDays: number[];
  bands: McBand[];
  /** Sorted values at each sampled day, `[sampleDays.length][paths]`. Lets the
      client recompute goal probabilities at any threshold or date without
      re-running the simulation. */
  columns: Float64Array[];
  /** Terminal values, sorted ascending. Same array as the last column. */
  terminal: Float64Array;
  /** A handful of individual paths over `sampleDays`, in their real order —
      the bands are smooth, and no single future is. */
  samplePaths: number[][];
  /** Per-path worst peak-to-trough decline, sorted ascending (most negative
      first). Measured over every day, not just the sampled ones. */
  maxDrawdowns: Float64Array;
  /** Years-to-depletion for paths that ran out of money, sorted ascending. */
  depletionYears: Float64Array;
  /** Fraction of paths that hit zero at any point. */
  ruinFraction: number;
  median: number;
  p10: number;
  p90: number;
  mean: number;
  paths: number;
  /** Compound annual return and vol actually fed to the simulation, after any
      override, re-centering and (for the bootstrap) the historical series. */
  simDrift: number;
  simVol: number;
  /** True when the covariance matrix needed a ridge to factor — the assets are
      collinear or history is short relative to the asset count. */
  covRidged: boolean;
}

function percentile(sorted: ArrayLike<number>, q: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export { percentile as mcPercentile };

/** Fraction of a sorted ascending array that is ≥ `goal`. Binary search. */
export function probAbove(sorted: ArrayLike<number>, goal: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < goal) lo = mid + 1;
    else hi = mid;
  }
  return (n - lo) / n;
}

/** Probability of sitting at or above `goal` at each sampled day. */
export function goalCurve(run: McRun, goal: number): number[] {
  return run.columns.map((col) => probAbove(col, goal));
}

/**
 * Monte-Carlo standard error of a sample quantile:
 *   SE ≈ √(q(1−q)/n) / f(x_q)
 * with the density estimated by a finite difference on the sorted sample. This
 * is what tells you whether a P10 that moved when you hit Resample moved
 * because the inputs changed or because 1,000 paths just isn't many.
 */
export function quantileStdError(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n < 20) return 0;
  const h = Math.min(0.05, Math.max(1.5 / n, 0.005));
  const lo = percentile(sorted, Math.max(0, q - h));
  const hi = percentile(sorted, Math.min(1, q + h));
  const density = (Math.min(1, q + h) - Math.max(0, q - h)) / Math.max(1e-12, hi - lo);
  if (density <= 0) return 0;
  return Math.sqrt((q * (1 - q)) / n) / density;
}

/** ~48 evenly spaced sample days (always including day 0 and the horizon). */
function sampleDaysFor(horizonDays: number): number[] {
  const target = 48;
  const stepDays = Math.max(1, Math.floor(horizonDays / target));
  const days = new Set<number>([0, horizonDays]);
  for (let d = 0; d <= horizonDays; d += stepDays) days.add(d);
  return [...days].sort((a, b) => a - b);
}

/* ─── Moments & re-centering ─── */

function normalizeWeights(weights: Vec, n: number): Vec {
  const w = Array.from({ length: n }, (_, i) => Math.max(0, weights[i] ?? 0));
  const sum = w.reduce((s, x) => s + x, 0);
  if (sum <= 1e-12) return w.map(() => 1 / Math.max(1, n));
  return w.map((x) => x / sum);
}

/**
 * The daily offset that makes a return series compound to `targetAnnual`.
 * Monotone in the offset, so bisection nails it; bracketed to keep every
 * 1 + r + δ strictly positive.
 */
export function recenterOffset(daily: number[], targetAnnual: number): number {
  if (daily.length === 0) return 0;
  let minR = Infinity;
  for (const r of daily) if (r < minR) minR = r;
  let lo = -(1 + minR) + 1e-9;
  let hi = 1;
  const at = (delta: number) => {
    let growth = 1;
    for (const r of daily) growth *= 1 + r + delta;
    return Math.pow(growth, TRADING_DAYS / daily.length) - 1;
  };
  if (at(lo) > targetAnnual) return lo;
  if (at(hi) < targetAnnual) return hi;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < targetAnnual) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Cholesky factor of a daily covariance matrix, ridging the diagonal until it
 * factors. Short history relative to the asset count, or two share classes of
 * the same fund, both produce a matrix that is only semi-definite.
 */
function choleskyRidged(cov: Mat): { L: Mat; ridged: boolean } {
  const direct = cholesky(cov);
  if (direct) return { L: direct, ridged: false };
  const n = cov.length;
  let scale = 0;
  for (let i = 0; i < n; i++) scale += cov[i][i];
  scale = Math.max(1e-16, scale / Math.max(1, n));
  for (let k = 0; k < 12; k++) {
    const lambda = scale * Math.pow(10, -8 + k);
    const shifted = cov.map((row, i) => row.map((v, j) => (i === j ? v + lambda : v)));
    const L = cholesky(shifted);
    if (L) return { L, ridged: true };
  }
  // Last resort: uncorrelated, variances only.
  return {
    L: cov.map((row, i) => row.map((_, j) => (i === j ? Math.sqrt(Math.max(0, row[i])) : 0))),
    ridged: true,
  };
}

/* ─── Simulation ─── */

interface Resolved {
  weights: Vec;
  /** Collapsed target-weight portfolio daily series (empty if no history). */
  port: number[];
  /** Uniform daily offset applied to every drawn return (drift override). */
  offset: number;
  /** Annualized arithmetic mean and vol used by the parametric engines. */
  muArith: number;
  vol: number;
  /** Standard error of the annual mean, for parameter uncertainty. */
  muStdErr: number;
  simDrift: number;
  simVol: number;
}

function resolve(spec: McSpec): Resolved {
  const n = spec.returnsByAsset.length;
  const weights = normalizeWeights(spec.weights, n);
  const port = n > 0 ? portfolioReturns(spec.returnsByAsset, weights) : [];

  const offset = spec.assume.drift != null && port.length > 0 ? recenterOffset(port, spec.assume.drift) : 0;
  const shifted = offset === 0 ? port : port.map((r) => r + offset);

  const vol = spec.assume.vol ?? annualizedVol(shifted);
  /* The parametric engines want the ARITHMETIC annualized mean. GBM's −σ²/2
     step is exactly what turns an arithmetic drift into the right median, so
     handing it a compound return double-counts the volatility drag — which is
     what the old call site did, projecting the "Normal" engine's median about
     σ²/2 below "Bootstrap" on identical data. Given a target COMPOUND return,
     invert the lognormal median instead: μ_arith = ln(1+g) + σ²/2. */
  const muArith =
    spec.muArith ??
    (spec.assume.drift != null
      ? Math.log(1 + spec.assume.drift) + (vol * vol) / 2
      : annualizedMeanReturn(shifted));

  const years = port.length > 0 ? port.length / TRADING_DAYS : 0;
  const muStdErr = years > 0 ? vol / Math.sqrt(years) : 0;

  const simDrift =
    spec.assume.drift ??
    (port.length > 0 && spec.muArith == null
      ? annualizedGeoReturn(shifted)
      : Math.exp(muArith - (vol * vol) / 2) - 1);

  return { weights, port, offset, muArith, vol, muStdErr, simDrift, simVol: vol };
}

/** Rebalance interval in trading days. 0 = never. */
function rebalanceEvery(policy: RebalancePolicy): number {
  switch (policy) {
    case "continuous":
      return 1;
    case "quarterly":
      return 63;
    case "annual":
      return TRADING_DAYS;
    case "never":
      return 0;
  }
}

/**
 * Run the simulation. Deterministic in `spec.seed`.
 *
 * Per-day order of operations, which is what makes the numbers reproducible by
 * hand: market return → fee drag → contribution → withdrawal → lump sum →
 * floor at zero → rebalance → record.
 */
export function runSimulation(spec: McSpec): McRun {
  const nAssets = spec.returnsByAsset.length;
  const T = nAssets > 0 ? spec.returnsByAsset[0].length : 0;
  const { weights, port, offset, muArith, vol, muStdErr, simDrift, simVol } = resolve(spec);

  const horizon = Math.max(1, Math.round(spec.horizonDays));
  const paths = Math.max(1, Math.round(spec.paths));
  const df = Math.max(2.1, spec.df);
  const parametric = spec.engine === "normal" || spec.engine === "student-t";
  const perAsset = spec.rebalance !== "continuous" && nAssets > 1;
  const rebEvery = rebalanceEvery(spec.rebalance);

  const f = spec.flows;
  const infl = f.inflationPct / 100;
  const feeDaily = f.feeAnnualBps > 0 ? Math.pow(1 - f.feeAnnualBps / 10000, 1 / TRADING_DAYS) : 1;
  const lumpByDay = new Map<number, number>();
  for (const l of f.lumpSums) {
    if (!Number.isFinite(l.year) || !Number.isFinite(l.amount) || l.amount === 0) continue;
    const day = Math.round(l.year * TRADING_DAYS);
    if (day < 1 || day > horizon) continue;
    lumpByDay.set(day, (lumpByDay.get(day) ?? 0) + l.amount);
  }
  const contribStopDay = f.contributionStopYear != null ? f.contributionStopYear * TRADING_DAYS : Infinity;
  const withdrawStartDay = f.withdrawalStartYear * TRADING_DAYS;
  const withdrawPeriodYears = Math.max(1, f.withdrawalEveryDays) / TRADING_DAYS;

  /** Deflator per day — 1 when reporting nominal. */
  const deflate = f.reportReal && infl !== 0;
  const deflator = new Float64Array(horizon + 1);
  for (let d = 0; d <= horizon; d++) {
    deflator[d] = deflate ? Math.pow(1 + infl, -d / TRADING_DAYS) : 1;
  }
  /** Cumulative inflation, for fixed-real withdrawals (always applies). */
  const inflator = new Float64Array(horizon + 1);
  for (let d = 0; d <= horizon; d++) {
    inflator[d] = infl !== 0 ? Math.pow(1 + infl, d / TRADING_DAYS) : 1;
  }

  const sampleDays = sampleDaysFor(horizon);
  const dayToCol = new Map<number, number>();
  sampleDays.forEach((d, i) => dayToCol.set(d, i));
  const columns: Float64Array[] = sampleDays.map(() => new Float64Array(paths));

  const keep = Math.max(0, Math.min(spec.keepPaths, paths));
  const samplePaths: number[][] = [];
  const maxDrawdowns = new Float64Array(paths);
  const depletion: number[] = [];

  // Parametric daily parameters.
  const sigD = vol / Math.sqrt(TRADING_DAYS);
  const muLogD = muArith / TRADING_DAYS - (sigD * sigD) / 2;
  const muSimpleD = muArith / TRADING_DAYS;
  const tScale = Math.sqrt(df - 2);

  // Per-asset scaffolding.
  const assetMu = new Float64Array(Math.max(1, nAssets));
  const zbuf = new Float64Array(Math.max(1, nAssets));
  const values = new Float64Array(Math.max(1, nAssets));
  /* The Cholesky factor is packed into a flat lower triangle rather than an
     array-of-arrays: at 60 assets the inner product runs 1,800 times a day per
     path, and chasing 60 separate row objects wrecks cache locality. */
  let Lflat = new Float64Array(0);
  const rowStart = new Int32Array(Math.max(1, nAssets));
  let covRidged = false;
  if (perAsset && parametric && nAssets > 0 && T > 1) {
    // An additive offset doesn't move covariance, so the raw returns are fine.
    const cov = covarianceMatrix(spec.returnsByAsset);
    const fac = choleskyRidged(cov);
    covRidged = fac.ridged;
    const volScale = spec.assume.vol != null ? spec.assume.vol / Math.max(1e-12, annualizedVol(port)) : 1;
    Lflat = new Float64Array((nAssets * (nAssets + 1)) / 2);
    let at = 0;
    for (let a = 0; a < nAssets; a++) {
      rowStart[a] = at;
      for (let k = 0; k <= a; k++) Lflat[at++] = fac.L[a][k] * volScale;
    }
    const portMuDaily = annualizedMeanReturn(port) / TRADING_DAYS;
    for (let a = 0; a < nAssets; a++) {
      const series = spec.returnsByAsset[a];
      let m = 0;
      for (const r of series) m += r;
      const own = series.length > 0 ? m / series.length : 0;
      // Per-asset arithmetic daily mean, plus the uniform drift offset. A
      // uniform per-asset offset shifts the target-weight portfolio by exactly
      // that offset, which is what makes the drift override land on target.
      assetMu[a] = own + offset + (spec.muArith != null ? spec.muArith / TRADING_DAYS - portMuDaily : 0);
    }
  }

  const antithetic = spec.antithetic && parametric;
  const baseRng = mulberry32(spec.seed);

  for (let p = 0; p < paths; p++) {
    // Antithetic pairs share a stream so the twin can mirror it exactly.
    let sign = 1;
    let rng = baseRng;
    if (antithetic) {
      const pair = p >> 1;
      rng = mulberry32((spec.seed ^ Math.imul(pair, 0x9e3779b1)) >>> 0);
      sign = p % 2 === 0 ? 1 : -1;
    }
    // Built per path so an antithetic twin sees the same normals to negate.
    const normal = makeGauss(rng);

    // Path-level expected-return draw. Deliberately consumes no randomness
    // when disabled, so the legacy wrappers keep their exact old streams.
    let muShiftDaily = 0;
    if (spec.parameterUncertainty && muStdErr > 0) {
      muShiftDaily = (sign * gauss(rng) * muStdErr) / TRADING_DAYS;
    }

    // Bootstrap index state (stationary bootstrap carries it across days).
    const blockP = 1 / Math.max(1, spec.blockDays);
    let idx = 0;
    if (spec.engine === "bootstrap-block" && T > 0) idx = Math.floor(rng() * T) % T;

    let total = spec.initialValue;
    if (perAsset) {
      for (let a = 0; a < nAssets; a++) values[a] = total * weights[a];
    }
    let peak = total * deflator[0];
    let worstDD = 0;
    let depletedDay = -1;
    const col0 = dayToCol.get(0);
    if (col0 != null) columns[col0][p] = total * deflator[0];
    const trace: number[] | null = p < keep ? [total * deflator[0]] : null;

    for (let d = 1; d <= horizon; d++) {
      /* ── 1. Market return ── */
      if (perAsset) {
        if (parametric) {
          for (let a = 0; a < nAssets; a++) zbuf[a] = sign * normal();
          let tMul = 1;
          if (spec.engine === "student-t") tMul = tScale / Math.sqrt(chiSquare(rng, normal, df));
          // Correlate, then apply, in one pass. Simple returns (floored) rather
          // than lognormal here: the Cholesky shock and the drift offset are
          // both additive in simple-return space, so E[r] lands exactly on the
          // arithmetic mean without a per-asset −σ²/2 correction that the
          // offset would then break.
          for (let a = 0; a < nAssets; a++) {
            let s = 0;
            const start = rowStart[a];
            for (let k = 0; k <= a; k++) s += Lflat[start + k] * zbuf[k];
            const r = assetMu[a] + muShiftDaily + s * tMul;
            values[a] *= 1 + (r < -0.95 ? -0.95 : r);
            if (values[a] < 0) values[a] = 0;
          }
        } else if (T > 0) {
          // Resample a whole DATE, so cross-asset correlation is exact.
          let t: number;
          if (spec.engine === "bootstrap-block") {
            t = idx;
            if (rng() < blockP) idx = Math.floor(rng() * T) % T;
            else idx = (idx + 1) % T;
          } else {
            t = Math.floor(rng() * T) % T;
          }
          for (let a = 0; a < nAssets; a++) {
            values[a] *= 1 + spec.returnsByAsset[a][t] + offset + muShiftDaily;
            if (values[a] < 0) values[a] = 0;
          }
        }
        total = 0;
        for (let a = 0; a < nAssets; a++) total += values[a];
      } else {
        let r: number;
        if (spec.engine === "normal") {
          r = Math.exp(muLogD + muShiftDaily + sigD * (sign * normal())) - 1;
        } else if (spec.engine === "student-t") {
          const t = (sign * normal() * tScale) / Math.sqrt(chiSquare(rng, normal, df));
          // Simple returns here, not lognormal: e^t has no finite mean for a
          // Student-t, which would make the projected average diverge.
          r = Math.max(-0.95, muSimpleD + muShiftDaily + sigD * t);
        } else if (spec.engine === "bootstrap-block" && T > 0) {
          r = port[idx] + offset + muShiftDaily;
          if (rng() < blockP) idx = Math.floor(rng() * T) % T;
          else idx = (idx + 1) % T;
        } else if (T > 0) {
          r = port[Math.floor(rng() * T) % T] + offset + muShiftDaily;
        } else {
          r = 0;
        }
        total *= 1 + r;
      }

      /* ── 2. Fee drag ── */
      if (feeDaily !== 1) total *= feeDaily;

      /* ── 3-5. Cash flows ── */
      let flow = 0;
      if (f.contribution > 0 && f.contributionEveryDays > 0 && d % f.contributionEveryDays === 0 && d < contribStopDay) {
        const years = Math.floor(d / TRADING_DAYS);
        flow += f.contribution * Math.pow(1 + f.contributionEscalationPct / 100, years);
      }
      if (f.withdrawalEveryDays > 0 && d % f.withdrawalEveryDays === 0 && d >= withdrawStartDay) {
        if (f.withdrawalKind === "percent-of-balance") {
          flow -= Math.max(0, total) * (f.withdrawalPct / 100) * withdrawPeriodYears;
        } else if (f.withdrawal > 0) {
          // fixed-real keeps the same purchasing power, so the nominal cheque
          // grows with inflation — the mechanic behind the 4% rule.
          flow -= f.withdrawalKind === "fixed-real" ? f.withdrawal * inflator[d] : f.withdrawal;
        }
      }
      const lump = lumpByDay.get(d);
      if (lump != null) flow += lump;

      if (flow !== 0) {
        const before = total;
        total += flow;
        if (total < 0) total = 0;
        if (perAsset) {
          if (before > 1e-9) {
            const k = total / before;
            for (let a = 0; a < nAssets; a++) values[a] *= k;
          } else {
            // Nothing left to scale — put new money in at target weights.
            for (let a = 0; a < nAssets; a++) values[a] = total * weights[a];
          }
        }
      } else if (total < 0) {
        total = 0;
        if (perAsset) for (let a = 0; a < nAssets; a++) values[a] = 0;
      }

      if (total <= 0 && depletedDay < 0) depletedDay = d;

      /* ── 6. Rebalance ── */
      if (perAsset && rebEvery > 0 && d % rebEvery === 0) {
        for (let a = 0; a < nAssets; a++) values[a] = total * weights[a];
      }

      /* ── 7. Record ── */
      const reported = total * deflator[d];
      if (reported > peak) peak = reported;
      if (peak > 0) {
        const dd = reported / peak - 1;
        if (dd < worstDD) worstDD = dd;
      }
      const ci = dayToCol.get(d);
      if (ci != null) {
        columns[ci][p] = reported;
        if (trace) trace.push(reported);
      }
    }

    maxDrawdowns[p] = worstDD;
    if (depletedDay >= 0) depletion.push(depletedDay / TRADING_DAYS);
    if (trace) samplePaths.push(trace);
  }

  for (const col of columns) col.sort();
  maxDrawdowns.sort();
  const depletionYears = Float64Array.from(depletion).sort();

  const terminal = columns[columns.length - 1];
  let sum = 0;
  for (let i = 0; i < terminal.length; i++) sum += terminal[i];

  const bands: McBand[] = sampleDays.map((day, i) => {
    const col = columns[i];
    return {
      day,
      p5: percentile(col, 0.05),
      p10: percentile(col, 0.1),
      p25: percentile(col, 0.25),
      p50: percentile(col, 0.5),
      p75: percentile(col, 0.75),
      p90: percentile(col, 0.9),
      p95: percentile(col, 0.95),
    };
  });

  return {
    sampleDays,
    bands,
    columns,
    terminal,
    samplePaths,
    maxDrawdowns,
    depletionYears,
    ruinFraction: depletion.length / paths,
    median: percentile(terminal, 0.5),
    p10: percentile(terminal, 0.1),
    p90: percentile(terminal, 0.9),
    mean: sum / (terminal.length || 1),
    paths,
    simDrift,
    simVol,
    covRidged,
  };
}

/* ─── Cost model ───
   Simulation cost varies by more than 100× across the settings the UI exposes,
   so it has to be shown rather than discovered. These coefficients are
   nanoseconds per path-day, measured by `scratchpad/mc-bench.ts` on an Apple
   Silicon laptop — an order-of-magnitude guide, not a promise, and slower
   hardware will run proportionally longer.

   The dominant term is the O(n²) Cholesky product on the parametric per-asset
   path: at 60 assets it is ~1,830 multiply-adds every day of every path, which
   is why a 60-name basket on "Normal" with real rebalancing costs ~90s at 5,000
   paths while the same run on a bootstrap engine costs ~6s. The bootstrap is
   also the better model there — it reproduces the observed correlation exactly
   instead of estimating 1,830 covariance parameters from ~500 days. */

export function estimateRuntimeMs(spec: McSpec): number {
  const n = Math.max(1, spec.returnsByAsset.length);
  const perAsset = spec.rebalance !== "continuous" && n > 1;
  const parametric = spec.engine === "normal" || spec.engine === "student-t";
  const tCost = spec.engine === "student-t" ? 35 : 0;

  let nsPerPathDay: number;
  if (!perAsset) {
    nsPerPathDay = parametric ? (spec.engine === "student-t" ? 72 : 41) : 17;
  } else if (!parametric) {
    nsPerPathDay = 20 + 2.4 * n;
  } else {
    nsPerPathDay = 20 + 23 * n + 0.28 * n * n + tCost;
  }
  return (spec.paths * spec.horizonDays * nsPerPathDay) / 1e6;
}

/* ─── Solving ─── */

export type SolveVariable = "contribution" | "years" | "initialValue";

export interface SolveRequest {
  spec: McSpec;
  variable: SolveVariable;
  goal: number;
  /** Success probability to hit, e.g. 0.8. */
  target: number;
  /** Search ceiling. Defaults are generous but finite. */
  max?: number;
}

export interface SolveResult {
  variable: SolveVariable;
  /** The solved value, or null when even `max` can't reach the target. */
  value: number | null;
  /** Success probability actually achieved at `value`. */
  achieved: number;
  /** Probability at the ceiling — tells you how far short an impossible ask is. */
  atMax: number;
  iterations: number;
}

function applySolve(spec: McSpec, variable: SolveVariable, x: number): McSpec {
  switch (variable) {
    case "contribution":
      return { ...spec, flows: { ...spec.flows, contribution: x } };
    case "years":
      return { ...spec, horizonDays: Math.max(1, Math.round(x * TRADING_DAYS)) };
    case "initialValue":
      return { ...spec, initialValue: x };
  }
}

/**
 * Bisection solve for the smallest value of `variable` that reaches `goal` with
 * probability ≥ `target`. Success is monotone increasing in all three
 * variables — more money, or more time, never lowers the odds — so bisection is
 * well-posed. Runs at reduced path count; the caller re-runs the full
 * simulation with the answer.
 */
export function solveFor(req: SolveRequest): SolveResult {
  const { variable, goal, target } = req;
  const spec: McSpec = { ...req.spec, keepPaths: 0 };
  const defaultMax =
    variable === "years" ? 60 : Math.max(1e6, (goal > 0 ? goal : spec.initialValue) * 2);
  const max = req.max ?? defaultMax;

  const successAt = (x: number) => {
    const run = runSimulation(applySolve(spec, variable, x));
    return probAbove(run.terminal, goal);
  };

  const atMax = successAt(max);
  if (atMax < target) {
    return { variable, value: null, achieved: atMax, atMax, iterations: 1 };
  }
  let lo = 0;
  let hi = max;
  let iterations = 1;
  const atZero = successAt(0);
  iterations++;
  if (atZero >= target) return { variable, value: 0, achieved: atZero, atMax, iterations };

  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    iterations++;
    if (successAt(mid) >= target) hi = mid;
    else lo = mid;
    if (hi - lo < Math.max(1e-4, max * 1e-5)) break;
  }
  return { variable, value: hi, achieved: successAt(hi), iterations: iterations + 1, atMax };
}

/* ─── Legacy wrappers ───
   The original two-engine API, kept so `scratchpad/` tests and any older call
   site keep working. Both route through the new engine on its collapsed
   single-asset fast path, which consumes randomness in exactly the old order,
   so previously-recorded numbers are unchanged. */

export interface McConfig {
  initialValue: number;
  /** Trading-day horizon (e.g. 252 * years). */
  horizonDays: number;
  paths: number;
  seed: number;
  /** Dollar contribution added every `contributionEveryDays` (0 = none). */
  contribution?: number;
  contributionEveryDays?: number;
}

export interface McResult extends Omit<McRun, "columns" | "samplePaths"> {
  /** Fraction of paths whose terminal value ≥ goal. */
  probAbove: (goal: number) => number;
}

function legacy(run: McRun): McResult {
  return {
    sampleDays: run.sampleDays,
    bands: run.bands,
    terminal: run.terminal,
    maxDrawdowns: run.maxDrawdowns,
    depletionYears: run.depletionYears,
    ruinFraction: run.ruinFraction,
    median: run.median,
    p10: run.p10,
    p90: run.p90,
    mean: run.mean,
    paths: run.paths,
    simDrift: run.simDrift,
    simVol: run.simVol,
    covRidged: run.covRidged,
    probAbove: (goal: number) => probAbove(run.terminal, goal),
  };
}

function legacySpec(cfg: McConfig): McSpec {
  return {
    ...defaultSpec(),
    engine: "bootstrap-iid",
    rebalance: "continuous",
    horizonDays: cfg.horizonDays,
    paths: cfg.paths,
    seed: cfg.seed,
    initialValue: cfg.initialValue,
    flows: {
      ...NO_FLOWS,
      contribution: cfg.contribution ?? 0,
      contributionEveryDays: cfg.contributionEveryDays ?? 0,
    },
  };
}

/** Bootstrap engine: resample historical daily returns with replacement. */
export function bootstrapProjection(historicalDaily: number[], cfg: McConfig): McResult {
  return legacy(
    runSimulation({
      ...legacySpec(cfg),
      engine: "bootstrap-iid",
      returnsByAsset: historicalDaily.length > 0 ? [historicalDaily] : [],
      weights: [1],
    }),
  );
}

/** Parametric GBM engine from annualized drift and vol. */
export function gbmProjection(annualDrift: number, annualVol: number, cfg: McConfig): McResult {
  return legacy(
    runSimulation({
      ...legacySpec(cfg),
      engine: "normal",
      returnsByAsset: [[]],
      weights: [1],
      // This signature's drift always went straight into GBM's exp(μ − σ²/2)
      // step, i.e. it IS an arithmetic annual mean. Preserved exactly.
      assume: { drift: null, vol: annualVol },
      muArith: annualDrift,
    }),
  );
}
