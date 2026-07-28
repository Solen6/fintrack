/* Confirms (a) the shared weight-load planner behaves at its edges, and (b) the
   Monte Carlo projection genuinely responds to the mix — i.e. wiring weights in
   actually changes the simulated outcome, not just the label.
     node_modules/.bin/jiti scratchpad/mc-weighting-test.ts                     */

import { planWeightLoad, overflowMessage } from "../components/analysis/weight-sources";
import { portfolioReturns, annualizedGeoReturn, annualizedVol } from "../lib/analytics/stats";
import { bootstrapProjection, mulberry32 } from "../lib/analytics/montecarlo";

let fails = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "✓" : "✗ FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

/* ─── 1. planWeightLoad ─── */
console.log("── planWeightLoad ──");
const p1 = planWeightLoad({ AAPL: 50, MSFT: 50 }, ["AAPL"], 60);
check("adds only the absent name", p1.toAdd.join() === "MSFT", p1.toAdd.join());
check("keeps both weights", Object.keys(p1.weights).sort().join() === "AAPL,MSFT");
check("no overflow with room", p1.overflow.length === 0 && overflowMessage(p1, 60) === null);

const p2 = planWeightLoad({ A: 10, B: 20, C: 30 }, ["A", "X"], 3);
check("respects the basket cap", p2.toAdd.join() === "B", `toAdd=${p2.toAdd.join()}`);
check("reports the overflow", p2.overflow.join() === "C", `overflow=${p2.overflow.join()}`);
check("overflow message names it", (overflowMessage(p2, 3) ?? "").includes("C"));

const p3 = planWeightLoad({ A: 0, B: 0 }, [], 60);
check("all-zero counts as empty", p3.empty);
check("empty map counts as empty", planWeightLoad({}, [], 60).empty);
check("drops zero-weight entries", !("A" in planWeightLoad({ A: 0, B: 5 }, [], 60).weights));
const pFull = planWeightLoad({ A: 1, B: 1 }, ["X", "Y"], 2);
check("full basket adds nothing", pFull.toAdd.length === 0 && pFull.overflow.length === 2);

/* ─── 2. Weights actually move the simulation ─── */
console.log("\n── weights drive the projection ──");
const rng = mulberry32(42);
const norm = () => {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
// Asset 0: high return / high vol. Asset 1: low return / low vol.
const days = 500;
const hot: number[] = [];
const calm: number[] = [];
for (let d = 0; d < days; d++) {
  hot.push(0.0008 + norm() * 0.018);
  calm.push(0.0001 + norm() * 0.003);
}
const matrix = [hot, calm];

const cfg = { initialValue: 100_000, horizonDays: 10 * 252, paths: 1000, seed: 20240501, contribution: 0, contributionEveryDays: 21 };
const run = (w: number[]) => {
  const port = portfolioReturns(matrix, w);
  const res = bootstrapProjection(port, cfg);
  return { ret: annualizedGeoReturn(port), vol: annualizedVol(port), median: res.median, p10: res.p10, p90: res.p90 };
};

// Same three mixes the UI can produce: all-hot, equal, all-calm.
const aggressive = run([1, 0]);
const equal = run([0.5, 0.5]);
const conservative = run([0, 1]);
for (const [name, r] of [["100% hot", aggressive], ["50/50", equal], ["100% calm", conservative]] as const) {
  console.log(
    `   ${name.padEnd(10)} ret ${(r.ret * 100).toFixed(2).padStart(6)}%  vol ${(r.vol * 100).toFixed(2).padStart(6)}%  ` +
      `P10 ${Math.round(r.p10).toLocaleString().padStart(9)}  median ${Math.round(r.median).toLocaleString().padStart(9)}  P90 ${Math.round(r.p90).toLocaleString().padStart(11)}`,
  );
}
check("vol falls as the mix shifts to the calm asset", aggressive.vol > equal.vol && equal.vol > conservative.vol);
check("median outcome differs across mixes", aggressive.median !== equal.median && equal.median !== conservative.median);
check("equal-weight vol sits between the extremes", equal.vol < aggressive.vol && equal.vol > conservative.vol);
// The headline claim: a weight change must move the simulated distribution.
const tilt = run([0.97, 0.03]);
check("even a 3-point tilt moves the median", tilt.median !== aggressive.median, `${Math.round(aggressive.median)} → ${Math.round(tilt.median)}`);

/* ─── 3. Normalization invariance (the "sums to 147%" case) ─── */
console.log("\n── normalization ──");
const raw = [60, 40];
const s = raw.reduce((a, b) => a + b, 0);
const normalized = run(raw.map((w) => w / s));
const scaled = run([150, 100].map((w) => w / 250)); // same ratio, different entered total
check("only relative sizes matter", normalized.median === scaled.median && normalized.vol === scaled.vol);

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`}`);
