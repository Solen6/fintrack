/* Does the new n-scaled iteration budget actually converge better than the old
   flat 800? Compare both against a 40k-iteration "ground truth" solve.
     node_modules/.bin/jiti scratchpad/frontier-converge.ts                     */

import { optimizeLongOnly } from "../lib/analytics/frontier";
import { covarianceMatrix, annualizeCov, annualizedMeanReturn } from "../lib/analytics/stats";
import { mulberry32 } from "../lib/analytics/montecarlo";
import { dot, matVec } from "../lib/analytics/matrix";

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
    for (let i = 0; i < n; i++) series[i].push(drift[i] + betas[i] * mkt + norm() * 0.011);
  }
  return series;
}

/** Objective the optimizer minimizes: ½·λ·wᵀΣw − wᵀμ. Lower is better. */
const obj = (mu: number[], sigma: number[][], w: number[], lambda: number) =>
  0.5 * lambda * dot(w, matVec(sigma, w)) - dot(w, mu);

console.log("objective gap vs 40k-iteration reference (lower = better converged)\n");
for (const n of [10, 20, 40, 60]) {
  const rets = fakeReturns(n, 500, 1234 + n);
  const mu = rets.map(annualizedMeanReturn);
  const sigma = annualizeCov(covarianceMatrix(rets));

  for (const lambda of [1, 10, 100]) {
    const truth = optimizeLongOnly(mu, sigma, lambda, { iters: 40000 });
    const old = optimizeLongOnly(mu, sigma, lambda, { iters: 800 });
    const now = optimizeLongOnly(mu, sigma, lambda); // new n-scaled budget

    const ref = obj(mu, sigma, truth, lambda);
    const gapOld = obj(mu, sigma, old, lambda) - ref;
    const gapNew = obj(mu, sigma, now, lambda) - ref;
    const wDrift = Math.max(...now.map((x, i) => Math.abs(x - truth[i])));

    console.log(
      `n=${String(n).padStart(2)} λ=${String(lambda).padStart(3)}  ` +
        `old(800)=${gapOld.toExponential(2)}  new=${gapNew.toExponential(2)}  ` +
        `${gapNew <= gapOld + 1e-15 ? "✓ better/equal" : "✗ WORSE"}  maxΔw vs truth=${wDrift.toExponential(2)}`,
    );
  }
}
