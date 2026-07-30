/* ──────────────────────────────────────────────────────────────────────────
   Cost of the Monte-Carlo engine across engines, path counts, horizons and
   basket sizes. Used to pick the UI's path-count caps: anything past a few
   seconds needs to be off the default, even inside a Web Worker.

     node_modules/.bin/jiti scratchpad/mc-bench.ts
   ────────────────────────────────────────────────────────────────────────── */

import { runSimulation, defaultSpec, mulberry32, type McEngineKind, type RebalancePolicy } from "../lib/analytics/montecarlo";

function series(n: number, muD: number, sdD: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const raw = Array.from({ length: n }, () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  });
  const m = raw.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(raw.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
  return raw.map((x) => muD + (sdD * (x - m)) / sd);
}

const basket = (n: number) => Array.from({ length: n }, (_, i) => series(504, 0.0004 + i * 0.00002, 0.008 + i * 0.0004, 100 + i));

function time(label: string, fn: () => void): number {
  const t0 = performance.now();
  fn();
  const ms = performance.now() - t0;
  console.log(`${label.padEnd(58)} ${ms.toFixed(0).padStart(7)} ms`);
  return ms;
}

const CASES: { engine: McEngineKind; rebalance: RebalancePolicy; assets: number }[] = [
  { engine: "bootstrap-iid", rebalance: "continuous", assets: 10 },
  { engine: "bootstrap-block", rebalance: "continuous", assets: 10 },
  { engine: "bootstrap-block", rebalance: "annual", assets: 10 },
  { engine: "bootstrap-block", rebalance: "annual", assets: 60 },
  { engine: "normal", rebalance: "continuous", assets: 10 },
  { engine: "normal", rebalance: "annual", assets: 10 },
  { engine: "normal", rebalance: "annual", assets: 60 },
  { engine: "student-t", rebalance: "continuous", assets: 10 },
  { engine: "student-t", rebalance: "annual", assets: 10 },
  { engine: "student-t", rebalance: "annual", assets: 60 },
];

console.log("=== 30-year horizon, 5,000 paths ===");
const worst: { label: string; ms: number }[] = [];
for (const c of CASES) {
  const rets = basket(c.assets);
  const w = rets.map(() => 1 / c.assets);
  const ms = time(`${c.engine} · ${c.rebalance} · ${c.assets} assets`, () => {
    runSimulation({
      ...defaultSpec(),
      engine: c.engine,
      rebalance: c.rebalance,
      returnsByAsset: rets,
      weights: w,
      horizonDays: 252 * 30,
      paths: 5000,
      seed: 1,
      initialValue: 100_000,
    });
  });
  worst.push({ label: `${c.engine}/${c.rebalance}/${c.assets}`, ms });
}

console.log("\n=== scaling in paths (student-t · annual · 10 assets · 30y) — the expensive corner ===");
for (const paths of [1000, 5000, 25000]) {
  const rets = basket(10);
  time(`${paths.toLocaleString()} paths`, () => {
    runSimulation({
      ...defaultSpec(),
      engine: "student-t",
      rebalance: "annual",
      returnsByAsset: rets,
      weights: rets.map(() => 0.1),
      horizonDays: 252 * 30,
      paths,
      seed: 1,
      initialValue: 100_000,
    });
  });
}

console.log("\n=== scaling in paths (bootstrap-block · continuous · 10 assets · 30y) — the cheap corner ===");
for (const paths of [1000, 5000, 25000]) {
  const rets = basket(10);
  time(`${paths.toLocaleString()} paths`, () => {
    runSimulation({
      ...defaultSpec(),
      engine: "bootstrap-block",
      rebalance: "continuous",
      returnsByAsset: rets,
      weights: rets.map(() => 0.1),
      horizonDays: 252 * 30,
      paths,
      seed: 1,
      initialValue: 100_000,
    });
  });
}

console.log("\n=== horizon scaling (bootstrap-block · annual · 20 assets · 5,000 paths) ===");
for (const years of [5, 10, 20, 30, 40]) {
  const rets = basket(20);
  time(`${years}y`, () => {
    runSimulation({
      ...defaultSpec(),
      engine: "bootstrap-block",
      rebalance: "annual",
      returnsByAsset: rets,
      weights: rets.map(() => 0.05),
      horizonDays: 252 * years,
      paths: 5000,
      seed: 1,
      initialValue: 100_000,
    });
  });
}

console.log("\n=== solver cost (bisection ≈ 24 sims) ===");
{
  const rets = basket(10);
  time("solveFor contribution @ 2,000 paths · 20y", () => {
    // Mirrors what the UI will do: solve at a reduced path count.
    const { solveFor } = require("../lib/analytics/montecarlo") as typeof import("../lib/analytics/montecarlo");
    solveFor({
      spec: {
        ...defaultSpec(),
        engine: "bootstrap-block",
        rebalance: "annual",
        returnsByAsset: rets,
        weights: rets.map(() => 0.1),
        horizonDays: 252 * 20,
        paths: 2000,
        seed: 1,
        initialValue: 50_000,
      },
      variable: "contribution",
      goal: 1_000_000,
      target: 0.8,
    });
  });
}

worst.sort((a, b) => b.ms - a.ms);
console.log(`\nMost expensive at 5k paths / 30y: ${worst[0].label} = ${worst[0].ms.toFixed(0)}ms`);
console.log(`Cheapest: ${worst[worst.length - 1].label} = ${worst[worst.length - 1].ms.toFixed(0)}ms`);
