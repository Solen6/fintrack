/* ──────────────────────────────────────────────────────────────────────────
   Monte-Carlo projection of a portfolio's future value.

   Two engines, both driven by a seeded PRNG (mulberry32) so results are
   deterministic and reproducible — no Math.random, so it's safe to run during
   render without hydration drift.

   • bootstrap: resample the portfolio's own historical daily returns with
     replacement. Non-parametric — keeps fat tails and skew the market actually
     showed.
   • gbm: geometric Brownian motion from an annualized drift μ and vol σ
     (normal daily log-ish steps via Box-Muller).

   Both support an initial value and an optional recurring contribution.
   ────────────────────────────────────────────────────────────────────────── */

import { TRADING_DAYS } from "./stats";

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

export interface McBand {
  day: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface McResult {
  bands: McBand[];
  /** Sorted terminal values across all paths. */
  terminal: number[];
  median: number;
  p10: number;
  p90: number;
  mean: number;
  /** Fraction of paths whose terminal value ≥ goal. */
  probAbove: (goal: number) => number;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function summarize(
  valuesByDay: number[][],
  sampleDays: number[],
  horizonDays: number,
): McResult {
  const bands: McBand[] = sampleDays.map((day) => {
    const col = valuesByDay[day].slice().sort((a, b) => a - b);
    return {
      day,
      p10: percentile(col, 0.1),
      p25: percentile(col, 0.25),
      p50: percentile(col, 0.5),
      p75: percentile(col, 0.75),
      p90: percentile(col, 0.9),
    };
  });
  const terminal = valuesByDay[horizonDays].slice().sort((a, b) => a - b);
  const meanVal =
    terminal.reduce((s, v) => s + v, 0) / (terminal.length || 1);
  return {
    bands,
    terminal,
    median: percentile(terminal, 0.5),
    p10: percentile(terminal, 0.1),
    p90: percentile(terminal, 0.9),
    mean: meanVal,
    probAbove: (goal: number) => {
      if (terminal.length === 0) return 0;
      // terminal is sorted ascending; count those ≥ goal
      let lo = 0;
      let hi = terminal.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (terminal[mid] < goal) lo = mid + 1;
        else hi = mid;
      }
      return (terminal.length - lo) / terminal.length;
    },
  };
}

/** ~40 evenly spaced sample days (plus day 0 and the horizon) for the bands. */
function sampleDaysFor(horizonDays: number): number[] {
  const target = 40;
  const stepDays = Math.max(1, Math.floor(horizonDays / target));
  const days = new Set<number>([0, horizonDays]);
  for (let d = 0; d <= horizonDays; d += stepDays) days.add(d);
  return [...days].sort((a, b) => a - b);
}

function runPaths(
  cfg: McConfig,
  drawDailyReturn: (rng: () => number) => number,
): McResult {
  const { initialValue, horizonDays, paths, seed } = cfg;
  const contribution = cfg.contribution ?? 0;
  const every = cfg.contributionEveryDays ?? 0;
  const sampleDays = sampleDaysFor(horizonDays);
  const sampleSet = new Set(sampleDays);

  // valuesByDay[day] = array of path values at that day (only sampled days kept)
  const valuesByDay: number[][] = [];
  for (const d of sampleDays) valuesByDay[d] = new Array(paths).fill(0);

  const rng = mulberry32(seed);
  for (let p = 0; p < paths; p++) {
    let v = initialValue;
    if (sampleSet.has(0)) valuesByDay[0][p] = v;
    for (let d = 1; d <= horizonDays; d++) {
      v *= 1 + drawDailyReturn(rng);
      if (contribution > 0 && every > 0 && d % every === 0) v += contribution;
      if (v < 0) v = 0;
      if (sampleSet.has(d)) valuesByDay[d][p] = v;
    }
  }
  return summarize(valuesByDay, sampleDays, horizonDays);
}

/** Bootstrap engine: resample historical daily returns with replacement. */
export function bootstrapProjection(
  historicalDaily: number[],
  cfg: McConfig,
): McResult {
  const n = historicalDaily.length;
  if (n === 0) {
    return runPaths(cfg, () => 0);
  }
  return runPaths(cfg, (rng) => historicalDaily[Math.floor(rng() * n) % n]);
}

/** Parametric GBM engine from annualized drift and vol. */
export function gbmProjection(
  annualDrift: number,
  annualVol: number,
  cfg: McConfig,
): McResult {
  const muD = annualDrift / TRADING_DAYS;
  const sigD = annualVol / Math.sqrt(TRADING_DAYS);
  // Daily simple return ≈ exp((μ − σ²/2)dt + σ√dt·Z) − 1
  const driftAdj = muD - (sigD * sigD) / 2;
  return runPaths(cfg, (rng) => Math.exp(driftAdj + sigD * gauss(rng)) - 1);
}
