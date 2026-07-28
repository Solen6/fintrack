/* ──────────────────────────────────────────────────────────────────────────
   Mean-variance portfolio optimization (Markowitz).

   Inputs are ANNUALIZED: expected returns `mu` (length n) and covariance
   `sigma` (n×n). Two regimes:

   • Unconstrained (shorting allowed): closed-form via Σ⁻¹ — the global
     minimum-variance and tangency portfolios, and the frontier curve.
   • Long-only (w ≥ 0, Σw = 1): a λ-sweep of projected-gradient descent onto
     the probability simplex. Sweeping the risk-aversion λ from 0 (max return)
     upward traces the achievable efficient frontier. This is what the UI
     shows, since a personal brokerage book is long-only.

   Pure; the random cloud takes an injected RNG so callers control the seed.
   ────────────────────────────────────────────────────────────────────────── */

import {
  type Mat,
  type Vec,
  inverse,
  matVec,
  dot,
  projectToSimplex,
} from "./matrix";

export interface FrontierPoint {
  ret: number; // annualized expected return
  vol: number; // annualized volatility
  sharpe: number;
  weights: number[];
}

function volOf(sigma: Mat, w: Vec): number {
  return Math.sqrt(Math.max(0, dot(w, matVec(sigma, w))));
}

function sharpeOf(ret: number, vol: number, rf: number): number {
  return vol > 0 ? (ret - rf) / vol : 0;
}

function ones(n: number): Vec {
  return new Array(n).fill(1);
}

/* ─── Unconstrained (allows shorts): closed-form frontier ─── */

export interface UnconstrainedFrontier {
  /** Global minimum-variance portfolio. */
  gmv: FrontierPoint | null;
  /** Tangency (max-Sharpe) portfolio for the given rf. */
  tangency: FrontierPoint | null;
}

export function unconstrainedFrontier(
  mu: Vec,
  sigma: Mat,
  rf = 0.043,
): UnconstrainedFrontier {
  const n = mu.length;
  const inv = inverse(sigma);
  if (!inv) return { gmv: null, tangency: null };
  const one = ones(n);
  const invOne = matVec(inv, one);
  const A = dot(one, invOne); // 1ᵀΣ⁻¹1
  if (Math.abs(A) < 1e-18) return { gmv: null, tangency: null };

  // Global minimum variance: w = Σ⁻¹1 / A
  const wGmv = invOne.map((v) => v / A);
  const retGmv = dot(wGmv, mu);
  const volGmv = volOf(sigma, wGmv);
  const gmv: FrontierPoint = {
    weights: wGmv,
    ret: retGmv,
    vol: volGmv,
    sharpe: sharpeOf(retGmv, volGmv, rf),
  };

  // Tangency: w ∝ Σ⁻¹(μ − rf·1)
  const excess = mu.map((m) => m - rf);
  const invExcess = matVec(inv, excess);
  const denom = dot(one, invExcess);
  let tangency: FrontierPoint | null = null;
  if (Math.abs(denom) > 1e-18) {
    const wTan = invExcess.map((v) => v / denom);
    const retTan = dot(wTan, mu);
    const volTan = volOf(sigma, wTan);
    tangency = {
      weights: wTan,
      ret: retTan,
      vol: volTan,
      sharpe: sharpeOf(retTan, volTan, rf),
    };
  }
  return { gmv, tangency };
}

/* ─── Long-only: projected-gradient λ-sweep ─── */

/** Convergence tolerance: max per-weight change between iterations. */
const TOL = 1e-10;

/** Iteration budget grows with the asset count — projected gradient needs more
    passes to settle a 60-name simplex than a 5-name one. Capped so a big basket
    can't stall the UI; the early-exit below means small baskets rarely spend it. */
function iterBudget(n: number): number {
  return Math.min(3000, 800 + 30 * n);
}

/**
 * Minimize  ½·λ·wᵀΣw − wᵀμ   subject to w ≥ 0, Σw = 1
 * via projected gradient descent onto the simplex. Larger λ ⇒ more risk-averse
 * ⇒ lower return / lower vol. Returns the optimal long-only weights.
 */
export function optimizeLongOnly(
  mu: Vec,
  sigma: Mat,
  lambda: number,
  opts: { iters?: number; step?: number; init?: Vec } = {},
): Vec {
  const n = mu.length;
  const iters = opts.iters ?? iterBudget(n);
  let w = opts.init ? [...opts.init] : new Array(n).fill(1 / n);

  // Step size scaled to the covariance magnitude for stability.
  let diagMax = 1e-9;
  for (let i = 0; i < n; i++) diagMax = Math.max(diagMax, sigma[i][i]);
  const step = opts.step ?? 1 / (lambda * diagMax + 1);

  for (let k = 0; k < iters; k++) {
    // grad = λ·Σw − μ
    const sw = matVec(sigma, w);
    const grad = sw.map((v, i) => lambda * v - mu[i]);
    const next = w.map((wi, i) => wi - step * grad[i]);
    const proj = projectToSimplex(next);
    let delta = 0;
    for (let i = 0; i < n; i++) delta = Math.max(delta, Math.abs(proj[i] - w[i]));
    w = proj;
    if (delta < TOL) break; // settled — further passes would be identical
  }
  return w;
}

export interface LongOnlyFrontier {
  frontier: FrontierPoint[]; // ordered from low-vol to high-vol
  gmv: FrontierPoint;        // long-only global min variance
  maxSharpe: FrontierPoint;  // long-only tangency (best Sharpe on the frontier)
}

/**
 * Trace the long-only efficient frontier by sweeping λ across a geometric grid.
 * `points` controls resolution. Duplicate/dominated points are pruned.
 */
export function longOnlyFrontier(
  mu: Vec,
  sigma: Mat,
  rf = 0.043,
  points = 40,
): LongOnlyFrontier {
  const lambdas: number[] = [];
  // Geometric sweep from aggressive (tiny λ) to very risk-averse (large λ).
  const lo = 0.5;
  const hi = 500;
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    lambdas.push(lo * Math.pow(hi / lo, t));
  }

  const raw: FrontierPoint[] = [];
  let warm: Vec | undefined;
  for (const lambda of lambdas) {
    const w = optimizeLongOnly(mu, sigma, lambda, { init: warm });
    warm = w;
    const ret = dot(w, mu);
    const vol = volOf(sigma, w);
    raw.push({ weights: w, ret, vol, sharpe: sharpeOf(ret, vol, rf) });
  }

  // Sort by vol, then keep only the upper envelope (return non-decreasing).
  raw.sort((a, b) => a.vol - b.vol);
  const frontier: FrontierPoint[] = [];
  let bestRet = -Infinity;
  for (const p of raw) {
    if (p.ret > bestRet + 1e-9) {
      frontier.push(p);
      bestRet = p.ret;
    }
  }
  if (frontier.length === 0) frontier.push(raw[0]);

  const gmv = frontier.reduce((a, b) => (b.vol < a.vol ? b : a), frontier[0]);
  const maxSharpe = frontier.reduce(
    (a, b) => (b.sharpe > a.sharpe ? b : a),
    frontier[0],
  );
  return { frontier, gmv, maxSharpe };
}

/** Metrics for an arbitrary weight vector (e.g. the user's current portfolio). */
export function portfolioMetrics(
  mu: Vec,
  sigma: Mat,
  weights: Vec,
  rf = 0.043,
): FrontierPoint {
  const ret = dot(weights, mu);
  const vol = volOf(sigma, weights);
  return { weights: [...weights], ret, vol, sharpe: sharpeOf(ret, vol, rf) };
}

/**
 * Random long-only portfolios (Dirichlet(1) via normalized exponentials) to
 * draw the achievable risk-return cloud behind the frontier. `rng` is an
 * injected [0,1) generator so the caller controls the seed.
 */
export function randomCloud(
  mu: Vec,
  sigma: Mat,
  count: number,
  rng: () => number,
  rf = 0.043,
): FrontierPoint[] {
  const n = mu.length;
  const out: FrontierPoint[] = [];
  for (let c = 0; c < count; c++) {
    const w: Vec = new Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      // −ln(U) ~ Exponential(1); normalizing gives a uniform simplex sample.
      const e = -Math.log(1 - rng() * 0.999999 - 1e-9 + 1e-9);
      w[i] = e;
      sum += e;
    }
    for (let i = 0; i < n; i++) w[i] /= sum;
    const ret = dot(w, mu);
    const vol = volOf(sigma, w);
    out.push({ weights: w, ret, vol, sharpe: sharpeOf(ret, vol, rf) });
  }
  return out;
}
