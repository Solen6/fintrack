/* Benchmark the long-only frontier at realistic basket sizes, using the REAL
   lib/analytics code, to size the UI's frontier resolution. Run:
     node_modules/.bin/jiti scratchpad/frontier-bench.ts                        */

import { longOnlyFrontier, randomCloud } from "../lib/analytics/frontier";
import { covarianceMatrix, annualizeCov, annualizedMeanReturn } from "../lib/analytics/stats";
import { mulberry32 } from "../lib/analytics/montecarlo";

/** Synthetic daily returns: a market factor + idiosyncratic noise (realistic
    correlation structure, so the covariance isn't trivially diagonal). */
function fakeReturns(n: number, days: number, seed: number) {
  const rng = mulberry32(seed);
  const norm = () => {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const betas = Array.from({ length: n }, () => 0.6 + rng() * 1.1);
  const drift = Array.from({ length: n }, () => (rng() - 0.4) * 0.0006);
  const series: number[][] = Array.from({ length: n }, () => []);
  for (let d = 0; d < days; d++) {
    const mkt = norm() * 0.009;
    for (let i = 0; i < n; i++) {
      series[i].push(drift[i] + betas[i] * mkt + norm() * 0.011);
    }
  }
  return series;
}

for (const n of [5, 10, 20, 40, 60]) {
  const rets = fakeReturns(n, 500, 1234 + n);
  const mu = rets.map(annualizedMeanReturn);
  const sigma = annualizeCov(covarianceMatrix(rets));

  for (const points of [40, 60]) {
    const t0 = performance.now();
    const f = longOnlyFrontier(mu, sigma, 0.043, points);
    const t1 = performance.now();
    const cloud = randomCloud(mu, sigma, 400, mulberry32(20240501), 0.043);
    const t2 = performance.now();

    // Sanity: weights must be a valid simplex point, frontier monotone in vol.
    const w = f.maxSharpe.weights;
    const sum = w.reduce((s, x) => s + x, 0);
    const minW = Math.min(...w);
    let monotone = true;
    for (let i = 1; i < f.frontier.length; i++) {
      if (f.frontier[i].vol < f.frontier[i - 1].vol - 1e-12) monotone = false;
      if (f.frontier[i].ret < f.frontier[i - 1].ret - 1e-12) monotone = false;
    }
    const nonzero = w.filter((x) => x > 0.0005).length;

    console.log(
      `n=${String(n).padStart(2)} pts=${points}  frontier ${(t1 - t0).toFixed(0).padStart(4)}ms  ` +
        `cloud ${(t2 - t1).toFixed(0).padStart(3)}ms  |  kept ${String(f.frontier.length).padStart(2)}/${points}  ` +
        `Σw=${sum.toFixed(9)}  minW=${minW.toFixed(9)}  nonzero=${nonzero}  ` +
        `maxSharpe=${f.maxSharpe.sharpe.toFixed(4)}  monotone=${monotone}`,
    );
  }
}
