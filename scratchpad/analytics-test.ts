/* Verifies the analytics math core against known-value cases.
   Run: npx tsx scratchpad/analytics-test.ts */
import {
  inverse, cholesky, matMul, projectToSimplex,
  dailyReturns, annualizedVol, annualizedMeanReturn, beta, sharpe, sortino,
  maxDrawdown, herfindahl, correlationMatrix, portfolioReturns,
  historicalVaR,
  unconstrainedFrontier, longOnlyFrontier, portfolioMetrics, optimizeLongOnly, randomCloud,
  bootstrapProjection, gbmProjection, mulberry32,
  brinsonAttribution,
} from "../lib/analytics/index";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; } else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
function approx(a: number, b: number, tol = 1e-6) { return Math.abs(a - b) <= tol; }

/* ── matrix ── */
{
  const A = [[4, 3], [6, 3]];
  const Ai = inverse(A)!;
  const I = matMul(A, Ai);
  ok("inverse→identity", approx(I[0][0], 1, 1e-9) && approx(I[1][1], 1, 1e-9) && approx(I[0][1], 0, 1e-9));

  const S = [[4, 2], [2, 3]];
  const L = cholesky(S)!;
  const LLt = matMul(L, [[L[0][0], L[1][0]], [L[0][1], L[1][1]]]);
  ok("cholesky LLᵀ=A", approx(LLt[0][0], 4, 1e-9) && approx(LLt[1][1], 3, 1e-9) && approx(LLt[0][1], 2, 1e-9));
  ok("cholesky rejects non-PD", cholesky([[1, 2], [2, 1]]) === null);

  const p = projectToSimplex([0.5, 0.1, -0.3]);
  ok("simplex sums to 1", approx(p.reduce((s, x) => s + x, 0), 1, 1e-9));
  ok("simplex nonneg", p.every((x) => x >= -1e-12));
  const p2 = projectToSimplex([1, 1, 1]);
  ok("simplex uniform", approx(p2[0], 1 / 3, 1e-9));
}

/* ── stats ── */
{
  const closes = [100, 110, 99];
  const r = dailyReturns(closes);
  ok("dailyReturns", approx(r[0], 0.1, 1e-12) && approx(r[1], -0.1, 1e-12));

  // asset = 2× market each day → beta 2, corr 1
  const mkt = [0.01, -0.02, 0.03, -0.01, 0.02];
  const asset = mkt.map((x) => 2 * x);
  ok("beta=2", approx(beta(asset, mkt), 2, 1e-9), `got ${beta(asset, mkt)}`);
  const corr = correlationMatrix([asset, mkt]);
  ok("corr perfect", approx(corr[0][1], 1, 1e-9), `got ${corr[0][1]}`);

  // annualized vol of constant-daily-vol series
  const daily = [0.01, -0.01, 0.01, -0.01, 0.01, -0.01];
  ok("annualizedVol>0", annualizedVol(daily) > 0);
  ok("annualizedMeanReturn≈0", approx(annualizedMeanReturn(daily), 0, 1e-9));

  // maxDrawdown: 100→120→60→90 → peak120 trough60 = -50%
  const dd = maxDrawdown([100, 120, 60, 90]);
  ok("maxDrawdown -50%", approx(dd.maxDrawdown, -0.5, 1e-9), `got ${dd.maxDrawdown}`);
  ok("maxDrawdown peak idx", dd.peakIndex === 1 && dd.troughIndex === 2);

  // HHI: equal 4 weights → 0.25 ; single → 1
  ok("HHI equal", approx(herfindahl([1, 1, 1, 1]), 0.25, 1e-9));
  ok("HHI single", approx(herfindahl([5, 0, 0]), 1, 1e-9));

  // portfolioReturns: 50/50 of two assets
  const pr = portfolioReturns([[0.02, 0.04], [0.00, 0.00]], [0.5, 0.5]);
  ok("portfolioReturns", approx(pr[0], 0.01, 1e-12) && approx(pr[1], 0.02, 1e-12));

  // sharpe sign: strongly positive drift, rf 0
  const up = new Array(60).fill(0.002);
  ok("sharpe positive", sharpe(up, 0) > 0);
  const down = new Array(60).fill(-0.002);
  ok("sortino negative", sortino(down, 0) < 0);

  const vr = historicalVaR([-0.05, -0.03, 0.01, 0.02, -0.10, 0.04, -0.01], 0.8);
  ok("VaR positive", vr.var > 0 && vr.cvar >= vr.var);
}

/* ── frontier ── */
{
  // Two uncorrelated assets, B has higher return & similar vol → tangency tilts to B.
  const mu = [0.08, 0.14];
  const sigma = [[0.04, 0.0], [0.0, 0.05]];
  const uf = unconstrainedFrontier(mu, sigma, 0.03);
  ok("gmv exists", !!uf.gmv);
  ok("tangency exists", !!uf.tangency);
  ok("tangency favors higher-return asset", (uf.tangency!.weights[1] > uf.tangency!.weights[0]));

  const lo = longOnlyFrontier(mu, sigma, 0.03, 30);
  ok("longonly weights sum 1", lo.frontier.every((p) => approx(p.weights.reduce((s, x) => s + x, 0), 1, 1e-6)));
  ok("longonly nonneg", lo.frontier.every((p) => p.weights.every((w) => w >= -1e-6)));
  // frontier monotonic: vol increasing ⇒ ret non-decreasing (upper envelope)
  let mono = true;
  for (let i = 1; i < lo.frontier.length; i++) if (lo.frontier[i].ret < lo.frontier[i - 1].ret - 1e-6) mono = false;
  ok("frontier monotonic", mono);
  ok("maxSharpe on frontier", lo.frontier.some((p) => approx(p.sharpe, lo.maxSharpe.sharpe, 1e-9)));
  // gmv should have lowest vol
  ok("gmv lowest vol", lo.frontier.every((p) => p.vol >= lo.gmv.vol - 1e-9));

  // maxSharpe should beat an equal-weight portfolio's Sharpe here
  const eq = portfolioMetrics(mu, sigma, [0.5, 0.5], 0.03);
  ok("maxSharpe ≥ equalweight", lo.maxSharpe.sharpe >= eq.sharpe - 1e-9, `ms ${lo.maxSharpe.sharpe.toFixed(3)} eq ${eq.sharpe.toFixed(3)}`);

  // long-only optimize with a dominated asset (negative return, high vol) → ~0 weight
  const mu2 = [0.12, -0.05, 0.10];
  const sig2 = [[0.03, 0.005, 0.004], [0.005, 0.09, 0.006], [0.004, 0.006, 0.035]];
  const w = optimizeLongOnly(mu2, sig2, 5, {});
  ok("dominated asset ~0", w[1] < 0.05, `got ${w[1].toFixed(3)}`);

  const cloud = randomCloud(mu, sigma, 100, mulberry32(42), 0.03);
  ok("cloud within/under frontier", cloud.every((c) => c.sharpe <= lo.maxSharpe.sharpe + 1e-6), "some cloud pt beat frontier");
}

/* ── monte carlo ── */
{
  const cfg = { initialValue: 100000, horizonDays: 252, paths: 500, seed: 7 };
  // constant daily return → deterministic terminal (bootstrap of a single value)
  const constRet = new Array(252).fill(0.0004);
  const r1 = bootstrapProjection(constRet, cfg);
  const r2 = bootstrapProjection(constRet, cfg);
  ok("MC deterministic", approx(r1.median, r2.median, 1e-9));
  const expected = 100000 * Math.pow(1.0004, 252);
  ok("bootstrap const growth", approx(r1.median, expected, 1), `got ${r1.median.toFixed(0)} exp ${expected.toFixed(0)}`);

  const g = gbmProjection(0.08, 0.15, cfg);
  ok("gbm bands ordered", g.bands.every((b) => b.p10 <= b.p50 && b.p50 <= b.p90));
  ok("gbm terminal spread", g.p90 > g.p10);
  ok("probAbove monotone", g.probAbove(0) === 1 && g.probAbove(1e12) === 0);
  ok("probAbove median≈0.5", Math.abs(g.probAbove(g.median) - 0.5) < 0.05, `got ${g.probAbove(g.median).toFixed(3)}`);

  // contributions increase terminal vs none
  const withC = gbmProjection(0.05, 0.12, { ...cfg, contribution: 1000, contributionEveryDays: 21 });
  const noC = gbmProjection(0.05, 0.12, cfg);
  ok("contributions raise median", withC.median > noC.median);
}

/* ── attribution ── */
{
  const inputs = [
    { sector: "Tech", portWeight: 0.5, portReturn: 0.20, benchWeight: 0.3, benchReturn: 0.15 },
    { sector: "Energy", portWeight: 0.2, portReturn: -0.05, benchWeight: 0.1, benchReturn: 0.00 },
    { sector: "Health", portWeight: 0.3, portReturn: 0.08, benchWeight: 0.6, benchReturn: 0.10 },
  ];
  const benchTotal = inputs.reduce((s, x) => s + x.benchWeight * x.benchReturn, 0);
  const res = brinsonAttribution(inputs, benchTotal);
  const sumEffects = res.totals.allocation + res.totals.selection + res.totals.interaction;
  ok("attribution sums to active", approx(sumEffects, res.totals.active, 1e-9), `Σ ${sumEffects.toFixed(5)} active ${res.totals.active.toFixed(5)}`);
  ok("per-sector totals sum", approx(res.sectors.reduce((s, e) => s + e.total, 0), res.totals.active, 1e-9));
}

console.log(`\nanalytics-test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
