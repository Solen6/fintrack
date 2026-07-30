/* ──────────────────────────────────────────────────────────────────────────
   Verification for the advanced Monte-Carlo engine in lib/analytics/montecarlo.
   Pure + deterministic: no network, no credentials.

     node_modules/.bin/jiti scratchpad/mc-engine-test.ts

   Checks the claims the UI makes, not just that the code runs: that the block
   bootstrap really preserves volatility clustering, that Student-t really has
   fatter tails at matched moments, that rebalancing policies really separate,
   that a drift override really lands on its target, and that the legacy
   two-engine API is bit-for-bit unchanged.
   ────────────────────────────────────────────────────────────────────────── */

import {
  runSimulation,
  bootstrapProjection,
  gbmProjection,
  defaultSpec,
  mulberry32,
  probAbove,
  goalCurve,
  quantileStdError,
  recenterOffset,
  mcPercentile,
  solveFor,
  NO_FLOWS,
  type McSpec,
  type McFlows,
  type McRun,
} from "../lib/analytics/montecarlo";
import { annualizedGeoReturn, annualizedVol, portfolioReturns, TRADING_DAYS } from "../lib/analytics/stats";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`✓  ${label}${detail ? `  — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`✗  ${label}${detail ? `  — ${detail}` : ""}`);
  }
}
function section(name: string) {
  console.log(`\n── ${name} ──`);
}
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const money = (x: number) => Math.round(x).toLocaleString();

/* ─── Synthetic data ─── */

function gaussFrom(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * IID daily series whose realized mean and sd are EXACTLY the ones asked for.
 * Standardizing matters: at n=504 the standard error of the daily mean is
 * sd/√504, so a raw draw can easily land 3σ out and hand a test a series with a
 * 76%/yr trend when 18% was intended. (That sampling error is real, and it is
 * exactly what `parameterUncertainty` models — but a test needs fixed inputs.)
 */
function iidSeries(n: number, muD: number, sdD: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const raw = Array.from({ length: n }, () => gaussFrom(rng));
  const m = raw.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(raw.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1));
  return raw.map((v) => muD + (sdD * (v - m)) / sd);
}

/** Series with regime blocks — calm grinding-up stretches and violent falling
    ones, which is what real markets look like and what an IID bootstrap
    destroys. Overall drift is positive so drawdowns come from the regimes
    rather than from an overall downtrend. */
function clusteredSeries(blocks: number, blockLen: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const out: number[] = [];
  for (let b = 0; b < blocks; b++) {
    const violent = b % 2 === 1;
    const muD = violent ? -0.0014 : 0.0022;
    const sdD = violent ? 0.02 : 0.004;
    for (let i = 0; i < blockLen; i++) out.push(muD + sdD * gaussFrom(rng));
  }
  return out;
}

function lag1Autocorr(x: number[]): number {
  const n = x.length;
  const m = x.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    den += (x[i] - m) ** 2;
    if (i > 0) num += (x[i] - m) * (x[i - 1] - m);
  }
  return den > 0 ? num / den : 0;
}

/** Realized compound annual return implied by a run's median terminal value. */
function medianCagr(run: McRun, initial: number, years: number): number {
  return Math.pow(run.median / initial, 1 / years) - 1;
}
/** Realized vol implied by the dispersion of terminal log growth. */
function terminalVol(run: McRun, initial: number, years: number): number {
  const logs: number[] = [];
  for (let i = 0; i < run.terminal.length; i++) {
    if (run.terminal[i] > 0) logs.push(Math.log(run.terminal[i] / initial));
  }
  const m = logs.reduce((s, v) => s + v, 0) / logs.length;
  const varr = logs.reduce((s, v) => s + (v - m) ** 2, 0) / (logs.length - 1);
  return Math.sqrt(varr / years);
}

const flows = (over: Partial<McFlows> = {}): McFlows => ({ ...NO_FLOWS, ...over });
const spec = (over: Partial<McSpec> = {}): McSpec => ({ ...defaultSpec(), ...over });

/* ══════════════════════════════════════════════════════════════════════════ */

section("legacy API is unchanged");
{
  const hist = iidSeries(504, 0.0006, 0.011, 11);
  const cfg = { initialValue: 100_000, horizonDays: 252 * 10, paths: 800, seed: 7 };

  const legacy = bootstrapProjection(hist, cfg);
  const viaEngine = runSimulation(
    spec({
      engine: "bootstrap-iid",
      rebalance: "continuous",
      returnsByAsset: [hist],
      weights: [1],
      horizonDays: cfg.horizonDays,
      paths: cfg.paths,
      seed: cfg.seed,
      initialValue: cfg.initialValue,
    }),
  );
  check(
    "new engine reproduces bootstrapProjection exactly",
    legacy.median === viaEngine.median && legacy.p10 === viaEngine.p10 && legacy.p90 === viaEngine.p90,
    `${money(legacy.median)} vs ${money(viaEngine.median)}`,
  );

  // Collapsing then resampling == resampling then collapsing, so a
  // continuously-rebalanced multi-asset run must equal the collapsed one.
  const a = iidSeries(504, 0.0007, 0.013, 21);
  const b = iidSeries(504, 0.0003, 0.006, 22);
  const w = [0.7, 0.3];
  const multi = runSimulation(
    spec({ engine: "bootstrap-iid", rebalance: "continuous", returnsByAsset: [a, b], weights: w, paths: 600, seed: 5 }),
  );
  const collapsed = runSimulation(
    spec({
      engine: "bootstrap-iid",
      rebalance: "continuous",
      returnsByAsset: [portfolioReturns([a, b], w)],
      weights: [1],
      paths: 600,
      seed: 5,
    }),
  );
  check(
    "continuous rebalance == collapsed portfolio series",
    Math.abs(multi.median - collapsed.median) < 1e-6,
    `${money(multi.median)} vs ${money(collapsed.median)}`,
  );

  const g = gbmProjection(0.09, 0.16, cfg);
  check("gbmProjection still ordered", g.p10 < g.median && g.median < g.p90);
  check("probAbove still a method on the legacy result", Math.abs(g.probAbove(g.median) - 0.5) < 0.05);
}

section("block bootstrap preserves volatility clustering");
{
  const clustered = clusteredSeries(8, 126, 99);
  const ac = lag1Autocorr(clustered.map(Math.abs));
  check("test series really has vol clustering", ac > 0.2, `lag-1 autocorr of |r| = ${ac.toFixed(3)}`);
  check(
    "and a positive overall drift, so DD comes from regimes not a downtrend",
    annualizedGeoReturn(clustered) > 0.05,
    `${pct(annualizedGeoReturn(clustered))} @ ${pct(annualizedVol(clustered))} vol`,
  );

  const common = {
    returnsByAsset: [clustered],
    weights: [1],
    rebalance: "continuous" as const,
    horizonDays: 252 * 10,
    paths: 4000,
    seed: 4242,
    initialValue: 100_000,
  };
  const iid = runSimulation(spec({ ...common, engine: "bootstrap-iid" }));
  const block = runSimulation(spec({ ...common, engine: "bootstrap-block", blockDays: 63 }));

  const iidDD = mcPercentile(iid.maxDrawdowns, 0.5);
  const blockDD = mcPercentile(block.maxDrawdowns, 0.5);
  check(
    "block bootstrap shows materially deeper drawdowns",
    blockDD < iidDD - 0.03,
    `median max DD: iid ${pct(iidDD)} vs block ${pct(blockDD)}`,
  );
  check(
    "and a wider terminal spread",
    Math.log(block.p90 / block.p10) > Math.log(iid.p90 / iid.p10),
    `log(P90/P10) ${Math.log(iid.p90 / iid.p10).toFixed(2)} → ${Math.log(block.p90 / block.p10).toFixed(2)}`,
  );

  /* The cleanest signature, free of any economics: a series that is +0.40%/day
     for its first half and −0.35%/day for its second. Drawing days IID always
     lands near a 50/50 mix, so terminal values barely disperse. Drawing blocks
     can land a path mostly in one regime or the other, so the spread explodes —
     while the MEDIAN is untouched, because block sampling is still unbiased. */
  const perfect = [...Array(252).fill(0.004), ...Array(252).fill(-0.0035)];
  const pc = { returnsByAsset: [perfect], weights: [1], rebalance: "continuous" as const, horizonDays: 504, paths: 4000, seed: 1, initialValue: 100_000 };
  const pIid = runSimulation(spec({ ...pc, engine: "bootstrap-iid" }));
  const pBlk = runSimulation(spec({ ...pc, engine: "bootstrap-block", blockDays: 126 }));
  const sIid = Math.log(pIid.p90 / pIid.p10);
  const sBlk = Math.log(pBlk.p90 / pBlk.p10);
  check(
    "on a perfectly-clustered series, blocks disperse ~8× more",
    sBlk > sIid * 5,
    `log(P90/P10) ${sIid.toFixed(3)} → ${sBlk.toFixed(3)}`,
  );
  check(
    "…while leaving the median exactly alone (blocks stay unbiased)",
    Math.abs(pBlk.median - pIid.median) < 1,
    `${money(pIid.median)} vs ${money(pBlk.median)}`,
  );
}

section("Student-t innovations: daily shape");
{
  /* A 1-day horizon makes terminal/initial − 1 exactly one daily innovation per
     path, so the public API is enough to inspect the distribution being drawn.
     This is the real test of the sampler: variance standardized to the target,
     kurtosis matching theory. */
  const daily = {
    returnsByAsset: [[0.0004]],
    weights: [1],
    rebalance: "continuous" as const,
    paths: 400000,
    seed: 5,
    initialValue: 1,
    horizonDays: 1,
    assume: { drift: 0.08, vol: 0.18 },
  };
  const moments = (r: McRun) => {
    const x = Array.from(r.terminal, (v) => v - 1);
    const m = x.reduce((s, v) => s + v, 0) / x.length;
    const v2 = x.reduce((s, v) => s + (v - m) ** 2, 0) / x.length;
    const k = x.reduce((s, v) => s + (v - m) ** 4, 0) / x.length / v2 ** 2;
    return { sd: Math.sqrt(v2), kurtosis: k, worst: x[0] };
  };
  const mn = moments(runSimulation(spec({ ...daily, engine: "normal" })));
  const m4 = moments(runSimulation(spec({ ...daily, engine: "student-t", df: 4 })));
  const m8 = moments(runSimulation(spec({ ...daily, engine: "student-t", df: 8 })));

  check("normal innovations have kurtosis 3", Math.abs(mn.kurtosis - 3) < 0.1, mn.kurtosis.toFixed(2));
  // Kurtosis of a standardized t is 3 + 6/(df−4), and undefined for df ≤ 4.
  check(
    "t(8) kurtosis matches theory 3 + 6/(df−4) = 4.5",
    Math.abs(m8.kurtosis - 4.5) < 0.4,
    `${m8.kurtosis.toFixed(2)} vs 4.50`,
  );
  check("t(4) kurtosis is enormous (undefined in theory)", m4.kurtosis > 15, m4.kurtosis.toFixed(1));
  check(
    "every engine standardizes to the target vol",
    [mn, m4, m8].every((m) => Math.abs(m.sd * Math.sqrt(252) - 0.18) < 0.005),
    `annualized: ${[mn, m4, m8].map((m) => pct(m.sd * Math.sqrt(252))).join(" / ")} vs 18% target`,
  );
  check(
    "t produces single days no normal ever would",
    Math.abs(m4.worst / m4.sd) > 20 && Math.abs(mn.worst / mn.sd) < 6,
    `worst day: normal ${pct(mn.worst)} (${Math.abs(mn.worst / mn.sd).toFixed(1)}σ) vs t(4) ${pct(m4.worst)} (${Math.abs(m4.worst / m4.sd).toFixed(0)}σ)`,
  );
}

section("Student-t over a real horizon: the tail, not the body");
{
  /* Honest accounting of what the engine buys you. Aggregating 756 daily draws
     averages away even a 45σ day, so at MATCHED variance the fat-tailed engine
     moves the deep tail (past roughly 1-in-500) and leaves the body and the
     typical drawdown alone. Worth knowing before reading much into the toggle. */
  const common = {
    returnsByAsset: [iidSeries(504, 0.0006, 0.011, 31)],
    weights: [1],
    rebalance: "continuous" as const,
    horizonDays: 252 * 3,
    paths: 20000,
    seed: 808,
    initialValue: 100_000,
    assume: { drift: 0.08, vol: 0.18 },
  };
  const norm = runSimulation(spec({ ...common, engine: "normal" }));
  const t4 = runSimulation(spec({ ...common, engine: "student-t", df: 4 }));
  const ratio = (q: number) => mcPercentile(t4.terminal, q) / mcPercentile(norm.terminal, q);

  check(
    "the deep tail (1-in-2000) is materially worse under t",
    ratio(0.0005) < 0.96,
    `P0.05 ${money(mcPercentile(norm.terminal, 0.0005))} → ${money(mcPercentile(t4.terminal, 0.0005))} (${pct(ratio(0.0005) - 1)})`,
  );
  check(
    "and the tail effect fades as the quantile gets less extreme",
    ratio(0.0005) < ratio(0.002) && ratio(0.002) < 1.01,
    `ratio at q=0.0005 ${ratio(0.0005).toFixed(3)} → q=0.002 ${ratio(0.002).toFixed(3)} → q=0.01 ${ratio(0.01).toFixed(3)}`,
  );
  check(
    "the body is unchanged — matched moments, and the CLT does the rest",
    Math.abs(ratio(0.5) - 1) < 0.01 && Math.abs(ratio(0.05) - 1) < 0.02,
    `median ratio ${ratio(0.5).toFixed(4)}, P5 ratio ${ratio(0.05).toFixed(4)}`,
  );
  check(
    "the single worst path is deeper, but it is one sample of noise",
    t4.maxDrawdowns[0] < norm.maxDrawdowns[0],
    `worst max DD ${pct(norm.maxDrawdowns[0])} → ${pct(t4.maxDrawdowns[0])}; at q=0.005 the two agree to ${pct(Math.abs(mcPercentile(t4.maxDrawdowns, 0.005) - mcPercentile(norm.maxDrawdowns, 0.005)))}`,
  );
  const tv = terminalVol(t4, 100_000, 3);
  check("t still hits its target vol over the horizon", Math.abs(tv - 0.18) < 0.03, `target 18%, realized ${pct(tv)}`);
}

section("parametric engines hit the assumptions they are given");
{
  const base = {
    returnsByAsset: [iidSeries(504, 0.0005, 0.010, 41)],
    weights: [1],
    rebalance: "continuous" as const,
    horizonDays: 252 * 20,
    paths: 8000,
    seed: 1234,
    initialValue: 100_000,
  };
  const run = runSimulation(spec({ ...base, engine: "normal", assume: { drift: 0.07, vol: 0.16 } }));
  const cagr = medianCagr(run, 100_000, 20);
  const vol = terminalVol(run, 100_000, 20);
  check("median compounds at the target rate", Math.abs(cagr - 0.07) < 0.004, `target 7%, realized ${pct(cagr)}`);
  check("dispersion matches the target vol", Math.abs(vol - 0.16) < 0.01, `target 16%, realized ${pct(vol)}`);
  check("simDrift/simVol echo the assumptions", run.simDrift === 0.07 && run.simVol === 0.16);
}

section("the geometric-vs-arithmetic drift fix");
{
  // The old call site fed annualizedGeoReturn into gbmProjection, which treats
  // its drift as an ARITHMETIC mean and then subtracts σ²/2 — so the parametric
  // median landed below the bootstrap median on identical data.
  const hist = iidSeries(504, 0.0007, 0.0115, 51);
  const geo = annualizedGeoReturn(hist);
  const vol = annualizedVol(hist);
  const cfg = { initialValue: 100_000, horizonDays: 252 * 20, paths: 8000, seed: 9 };

  const oldWay = gbmProjection(geo, vol, cfg);
  const newWay = runSimulation(
    spec({ engine: "normal", rebalance: "continuous", returnsByAsset: [hist], weights: [1], ...cfg }),
  );
  const boot = runSimulation(
    spec({ engine: "bootstrap-iid", rebalance: "continuous", returnsByAsset: [hist], weights: [1], ...cfg }),
  );
  const oldGap = Math.log(oldWay.median / boot.median);
  const newGap = Math.log(newWay.median / boot.median);
  // Feeding a compound return g where an arithmetic mean belongs makes the
  // median compound at exp(g − σ²/2) instead of (1+g), for a 20-year log gap of
  // 20·[(g − σ²/2) − ln(1+g)].
  const predicted = 20 * (geo - (vol * vol) / 2 - Math.log(1 + geo));
  check(
    "old parametric median sat below bootstrap, by the predicted amount",
    oldGap < -0.04 && Math.abs(oldGap - predicted) < 0.03,
    `log gap ${oldGap.toFixed(3)} vs predicted ${predicted.toFixed(3)} over 20y (hist ${pct(geo)} @ ${pct(vol)} vol)`,
  );
  check("fixed parametric median now agrees with bootstrap", Math.abs(newGap) < 0.03, `log gap ${newGap.toFixed(3)}`);
}

section("rebalancing policy changes the distribution");
{
  // A hot, volatile name and a calm one: buy-and-hold lets the hot one take over.
  const hot = iidSeries(756, 0.0011, 0.020, 61);
  const calm = iidSeries(756, 0.0002, 0.004, 62);
  const common = {
    engine: "bootstrap-block" as const,
    blockDays: 21,
    returnsByAsset: [hot, calm],
    weights: [0.5, 0.5],
    horizonDays: 252 * 20,
    paths: 3000,
    seed: 77,
    initialValue: 100_000,
  };
  const cont = runSimulation(spec({ ...common, rebalance: "continuous" }));
  const annual = runSimulation(spec({ ...common, rebalance: "annual" }));
  const quarterly = runSimulation(spec({ ...common, rebalance: "quarterly" }));
  const never = runSimulation(spec({ ...common, rebalance: "never" }));

  const spread = (r: McRun) => Math.log(r.p90 / r.p10);
  check(
    "buy-and-hold has the widest terminal spread",
    spread(never) > spread(annual) && spread(annual) > spread(cont) - 1e-9,
    `never ${spread(never).toFixed(2)} > annual ${spread(annual).toFixed(2)} > continuous ${spread(cont).toFixed(2)}`,
  );
  check(
    "buy-and-hold median beats the rebalanced median here",
    never.median > annual.median,
    `${money(annual.median)} → ${money(never.median)}`,
  );
  check(
    "quarterly sits between continuous and annual",
    spread(quarterly) >= spread(cont) - 1e-9 && spread(quarterly) <= spread(annual) + 1e-9,
    `${spread(quarterly).toFixed(3)}`,
  );

  // With identical assets, every policy must agree — nothing to drift apart.
  const same = iidSeries(504, 0.0005, 0.010, 63);
  const twin = { returnsByAsset: [same, same.slice()], weights: [0.5, 0.5], paths: 800, seed: 3, initialValue: 100_000 };
  const tc = runSimulation(spec({ ...twin, engine: "bootstrap-iid", rebalance: "continuous" }));
  const tn = runSimulation(spec({ ...twin, engine: "bootstrap-iid", rebalance: "never" }));
  check(
    "identical assets → policy is irrelevant",
    Math.abs(tc.median - tn.median) < 1e-6,
    `${money(tc.median)} vs ${money(tn.median)}`,
  );
}

section("drift override lands on its target");
{
  const hist = iidSeries(504, 0.0009, 0.012, 71);
  const target = 0.05;
  const off = recenterOffset(hist, target);
  const shifted = hist.map((r) => r + off);
  check(
    "recenterOffset solves the compound return",
    Math.abs(annualizedGeoReturn(shifted) - target) < 1e-9,
    `offset ${(off * 1e4).toFixed(2)}bp/day → ${pct(annualizedGeoReturn(shifted))}`,
  );
  check("re-centering leaves vol alone", Math.abs(annualizedVol(shifted) - annualizedVol(hist)) < 1e-12);

  const run = runSimulation(
    spec({
      engine: "bootstrap-iid",
      rebalance: "continuous",
      returnsByAsset: [hist],
      weights: [1],
      assume: { drift: target, vol: null },
      horizonDays: 252 * 15,
      paths: 6000,
      seed: 500,
      initialValue: 100_000,
    }),
  );
  const cagr = medianCagr(run, 100_000, 15);
  check("bootstrap honors the override", Math.abs(cagr - target) < 0.006, `target 5%, realized ${pct(cagr)}`);

  // Same override through the per-asset path.
  const b = iidSeries(504, 0.0002, 0.005, 72);
  const perAsset = runSimulation(
    spec({
      engine: "bootstrap-iid",
      rebalance: "annual",
      returnsByAsset: [hist, b],
      weights: [0.6, 0.4],
      assume: { drift: target, vol: null },
      horizonDays: 252 * 15,
      paths: 4000,
      seed: 501,
      initialValue: 100_000,
    }),
  );
  const paCagr = medianCagr(perAsset, 100_000, 15);
  check("per-asset path honors it too", Math.abs(paCagr - target) < 0.012, `realized ${pct(paCagr)}`);
}

section("parameter uncertainty widens the cone");
{
  const common = {
    engine: "bootstrap-iid" as const,
    rebalance: "continuous" as const,
    returnsByAsset: [iidSeries(504, 0.0006, 0.011, 81)],
    weights: [1],
    horizonDays: 252 * 25,
    paths: 6000,
    seed: 606,
    initialValue: 100_000,
  };
  const off = runSimulation(spec({ ...common, parameterUncertainty: false }));
  const on = runSimulation(spec({ ...common, parameterUncertainty: true }));
  const spread = (r: McRun) => Math.log(r.p90 / r.p10);
  check(
    "P10–P90 band widens",
    spread(on) > spread(off) * 1.15,
    `${spread(off).toFixed(2)} → ${spread(on).toFixed(2)} log-range over 25y`,
  );
  check(
    "median barely moves",
    Math.abs(Math.log(on.median / off.median)) < 0.2,
    `${money(off.median)} vs ${money(on.median)}`,
  );
  check(
    "disabled uncertainty consumes no randomness",
    off.median === runSimulation(spec({ ...common })).median,
  );
}

section("cash flows");
{
  const hist = iidSeries(504, 0.0004, 0.009, 91);
  const base = {
    engine: "bootstrap-iid" as const,
    rebalance: "continuous" as const,
    returnsByAsset: [hist],
    weights: [1],
    horizonDays: 252 * 20,
    paths: 1200,
    seed: 31337,
    initialValue: 100_000,
  };
  const none = runSimulation(spec({ ...base }));
  const contrib = runSimulation(spec({ ...base, flows: flows({ contribution: 500, contributionEveryDays: 21 }) }));
  const escalated = runSimulation(
    spec({ ...base, flows: flows({ contribution: 500, contributionEveryDays: 21, contributionEscalationPct: 3 }) }),
  );
  check("contributions raise the median", contrib.median > none.median, `${money(none.median)} → ${money(contrib.median)}`);
  check("escalation raises it further", escalated.median > contrib.median, `→ ${money(escalated.median)}`);

  const fee = runSimulation(spec({ ...base, flows: flows({ feeAnnualBps: 100 }) }));
  const drag = Math.pow(fee.median / none.median, 1 / 20) - 1;
  check("100bp fee costs ~100bp a year", Math.abs(drag + 0.01) < 0.0015, `measured ${pct(drag)}/yr`);

  const lump = runSimulation(spec({ ...base, flows: flows({ lumpSums: [{ year: 5, amount: 50_000 }] }) }));
  check("a lump sum at year 5 compounds through", lump.median > none.median + 50_000, `${money(lump.median)}`);
  const outflow = runSimulation(spec({ ...base, flows: flows({ lumpSums: [{ year: 5, amount: -20_000 }] }) }));
  check("a negative lump sum reduces it", outflow.median < none.median, `${money(outflow.median)}`);

  // Real reporting is an exact deflation of the nominal path.
  const nominal = runSimulation(spec({ ...base, flows: flows({ inflationPct: 3, reportReal: false }) }));
  const real = runSimulation(spec({ ...base, flows: flows({ inflationPct: 3, reportReal: true }) }));
  const expected = nominal.median * Math.pow(1.03, -20);
  check(
    "real reporting = nominal ÷ cumulative inflation",
    Math.abs(real.median - expected) < 1e-6,
    `${money(real.median)} vs ${money(expected)}`,
  );
  check("inflation alone doesn't change nominal", nominal.median === none.median);
}

section("withdrawals, ruin and depletion");
{
  const base = {
    engine: "normal" as const,
    rebalance: "continuous" as const,
    returnsByAsset: [iidSeries(504, 0.0004, 0.010, 101)],
    weights: [1],
    assume: { drift: 0.07, vol: 0.16 },
    horizonDays: 252 * 30,
    paths: 4000,
    seed: 2468,
    initialValue: 1_000_000,
  };
  /* The 4% rule is a claim about REAL returns. Withdrawing 4% of the initial
     balance, inflation-adjusted, out of a portfolio earning 7% nominal against
     3% inflation is only a 3.9% real return against a 4% real draw — it should
     be dicey, and it is. Give it the ~7% real the rule was derived on and the
     ruin rate collapses. Test the whole ladder, since the monotonicity is the
     real claim. */
  const fourPct = flows({ withdrawal: 40_000 / 12, withdrawalEveryDays: 21, withdrawalKind: "fixed-real", inflationPct: 3 });
  const thin = runSimulation(spec({ ...base, assume: { drift: 0.07, vol: 0.16 }, flows: fourPct }));
  const healthy = runSimulation(spec({ ...base, assume: { drift: 0.10, vol: 0.16 }, flows: fourPct }));
  check(
    "4% real draw against a 3.9% real return is risky",
    thin.ruinFraction > 0.15,
    `7% nominal − 3% inflation → ruin ${pct(thin.ruinFraction)}`,
  );
  check(
    "4% rule at ~6.8% real is safe over 30y, as the literature says",
    healthy.ruinFraction < 0.1,
    `10% nominal − 3% inflation → ruin ${pct(healthy.ruinFraction)}`,
  );
  check("ruin falls as the real return rises", healthy.ruinFraction < thin.ruinFraction);
  const safe = healthy;
  const greedy = runSimulation(
    spec({ ...base, flows: flows({ withdrawal: 110_000 / 12, withdrawalEveryDays: 21, withdrawalKind: "fixed-real", inflationPct: 3 }) }),
  );
  check("11% withdrawals ruin most paths", greedy.ruinFraction > 0.7, `ruin ${pct(greedy.ruinFraction)}`);
  check("depletion years are recorded and sorted", greedy.depletionYears.length > 0 && greedy.depletionYears.every((v, i, a) => i === 0 || a[i - 1] <= v));
  check(
    "median depletion lands inside the horizon",
    mcPercentile(greedy.depletionYears, 0.5) > 0 && mcPercentile(greedy.depletionYears, 0.5) < 30,
    `${mcPercentile(greedy.depletionYears, 0.5).toFixed(1)}y`,
  );
  check("ruin fraction matches the depletion count", Math.abs(greedy.ruinFraction - greedy.depletionYears.length / greedy.paths) < 1e-12);

  const noWithdraw = runSimulation(spec({ ...base, flows: flows({}) }));
  check("no withdrawals → no ruin", noWithdraw.ruinFraction === 0 && noWithdraw.depletionYears.length === 0);

  // You can never withdraw a fixed FRACTION down to nothing.
  const pctRule = runSimulation(
    spec({ ...base, flows: flows({ withdrawalKind: "percent-of-balance", withdrawalPct: 25, withdrawalEveryDays: 21 }) }),
  );
  check("percent-of-balance can never ruin", pctRule.ruinFraction === 0, `median ends ${money(pctRule.median)}`);

  const later = runSimulation(
    spec({
      ...base,
      flows: flows({ withdrawal: 110_000 / 12, withdrawalEveryDays: 21, withdrawalKind: "fixed-real", inflationPct: 3, withdrawalStartYear: 15 }),
    }),
  );
  check("delaying withdrawals cuts ruin", later.ruinFraction < greedy.ruinFraction, `${pct(greedy.ruinFraction)} → ${pct(later.ruinFraction)}`);

  const nominalW = runSimulation(
    spec({ ...base, flows: flows({ withdrawal: 110_000 / 12, withdrawalEveryDays: 21, withdrawalKind: "fixed-nominal", inflationPct: 3 }) }),
  );
  check("fixed-nominal ruins less than fixed-real", nominalW.ruinFraction < greedy.ruinFraction, `${pct(nominalW.ruinFraction)}`);
}

section("drawdown accounting");
{
  const flat = runSimulation(
    spec({
      engine: "normal",
      rebalance: "continuous",
      returnsByAsset: [[0.0004]],
      weights: [1],
      assume: { drift: 0.06, vol: 0 },
      horizonDays: 252 * 5,
      paths: 20,
      seed: 1,
      initialValue: 10_000,
    }),
  );
  check("a zero-vol path never draws down", flat.maxDrawdowns.every((d) => Math.abs(d) < 1e-12));
  check("zero-vol median compounds exactly", Math.abs(medianCagr(flat, 10_000, 5) - 0.06) < 1e-6, pct(medianCagr(flat, 10_000, 5)));

  const risky = runSimulation(
    spec({
      engine: "normal",
      rebalance: "continuous",
      returnsByAsset: [[0.0004]],
      weights: [1],
      assume: { drift: 0.06, vol: 0.2 },
      horizonDays: 252 * 10,
      paths: 2000,
      seed: 2,
      initialValue: 10_000,
    }),
  );
  check("drawdowns are negative fractions, sorted worst-first", risky.maxDrawdowns[0] < 0 && risky.maxDrawdowns[0] <= risky.maxDrawdowns[risky.paths - 1]);
  check("worst drawdown is a real loss, not below −100%", risky.maxDrawdowns[0] > -1);
  check("some path is down >20% at some point", mcPercentile(risky.maxDrawdowns, 0.5) < -0.15, `median max DD ${pct(mcPercentile(risky.maxDrawdowns, 0.5))}`);
}

section("columns, goal curves and standard error");
{
  const run = runSimulation(
    spec({
      engine: "bootstrap-block",
      rebalance: "continuous",
      returnsByAsset: [iidSeries(504, 0.0006, 0.011, 111)],
      weights: [1],
      horizonDays: 252 * 10,
      paths: 2000,
      seed: 4,
      initialValue: 100_000,
      keepPaths: 8,
    }),
  );
  check("one column per sampled day", run.columns.length === run.sampleDays.length && run.bands.length === run.sampleDays.length);
  check("columns are sorted ascending", run.columns.every((c) => c.every((v, i) => i === 0 || c[i - 1] <= v)));
  check("terminal is the last column", run.terminal === run.columns[run.columns.length - 1]);
  check("day 0 column is exactly the starting value", run.columns[0].every((v) => v === 100_000));
  check("bands are ordered at every sampled day", run.bands.every((b) => b.p5 <= b.p10 && b.p10 <= b.p25 && b.p25 <= b.p50 && b.p50 <= b.p75 && b.p75 <= b.p90 && b.p90 <= b.p95));

  check("kept sample paths have the right shape", run.samplePaths.length === 8 && run.samplePaths.every((p) => p.length === run.sampleDays.length));
  check("sample paths start at the starting value", run.samplePaths.every((p) => p[0] === 100_000));
  check(
    "sample paths are individually jagged, not smoothed",
    run.samplePaths.some((p) => p.some((v, i) => i > 0 && v < p[i - 1])),
  );

  const g0 = goalCurve(run, 0);
  const gBig = goalCurve(run, 1e15);
  check("goal 0 is always reached", g0.every((v) => v === 1));
  check("an absurd goal never is", gBig.every((v) => v === 0));
  const gMid = goalCurve(run, run.median);
  check("goal = terminal median → 50% at the horizon", Math.abs(gMid[gMid.length - 1] - 0.5) < 0.01, gMid[gMid.length - 1].toFixed(3));
  check("probAbove agrees with the median", Math.abs(probAbove(run.terminal, run.median) - 0.5) < 0.01);

  /* A goal above today's balance gets more likely with time; a goal at today's
     balance gets less likely, since paths dip below it. Neither curve is
     MONOTONE though, and the UI must not imply it is: a path can cross above
     the goal and fall back under it later, so the fraction-above can tick down
     even while trending up. */
  const above = goalCurve(run, 250_000);
  const atStart = goalCurve(run, 100_000);
  const mid = Math.floor(above.length / 2);
  check(
    "a stretch goal starts impossible and trends more likely",
    above[0] === 0 && above[above.length - 1] > above[mid] && above[mid] > 0,
    `0 → ${above[mid].toFixed(2)} at 5y → ${above[above.length - 1].toFixed(2)} at 10y`,
  );
  check(
    "a goal at today's balance starts certain and decays",
    atStart[0] === 1 && atStart[atStart.length - 1] < 1,
    `1 → ${atStart[atStart.length - 1].toFixed(4)}`,
  );
  const dips = above.filter((v, i) => i > 0 && v < above[i - 1]).length;
  check(
    "goal curves need not be monotone (paths cross back below)",
    dips > 0 && above[above.length - 1] > above[1],
    `${dips} of ${above.length - 1} steps tick down while the curve trends up`,
  );
  check("every goal probability is a valid fraction", above.every((v) => v >= 0 && v <= 1) && atStart.every((v) => v >= 0 && v <= 1));

  // Standard error must fall like 1/√n.
  const small = runSimulation(spec({ engine: "normal", rebalance: "continuous", returnsByAsset: [[0.0004]], weights: [1], assume: { drift: 0.07, vol: 0.17 }, horizonDays: 252 * 10, paths: 1000, seed: 8, initialValue: 100_000 }));
  const big = runSimulation(spec({ engine: "normal", rebalance: "continuous", returnsByAsset: [[0.0004]], weights: [1], assume: { drift: 0.07, vol: 0.17 }, horizonDays: 252 * 10, paths: 16000, seed: 8, initialValue: 100_000 }));
  const seSmall = quantileStdError(small.terminal, 0.1);
  const seBig = quantileStdError(big.terminal, 0.1);
  const ratio = seSmall / seBig;
  check("quantile SE shrinks like √n (4× paths per halving)", ratio > 2.6 && ratio < 5.5, `1k SE ${money(seSmall)} vs 16k SE ${money(seBig)} → ratio ${ratio.toFixed(2)} (√16 = 4)`);
  check("SE is a small fraction of the estimate", seSmall / small.p10 < 0.1, `${pct(seSmall / small.p10)} of P10`);
}

section("antithetic variates cut sampling error");
{
  const mk = (seed: number, anti: boolean) =>
    runSimulation(
      spec({
        engine: "normal",
        rebalance: "continuous",
        returnsByAsset: [[0.0004]],
        weights: [1],
        assume: { drift: 0.07, vol: 0.17 },
        horizonDays: 252 * 10,
        paths: 500,
        seed,
        initialValue: 100_000,
        antithetic: anti,
      }),
    );
  // Truth: the lognormal median is exactly initial·(1+g)^years.
  const truth = 100_000 * Math.pow(1.07, 10);
  const seeds = [11, 22, 33, 44, 55, 66, 77, 88];
  const err = (anti: boolean) =>
    seeds.reduce((s, sd) => s + Math.abs(Math.log(mk(sd, anti).median / truth)), 0) / seeds.length;
  const plain = err(false);
  const anti = err(true);
  check("antithetic pairs reduce median error", anti < plain, `mean |log error| ${plain.toFixed(4)} → ${anti.toFixed(4)}`);
}

section("collinear assets degrade instead of throwing");
{
  const s = iidSeries(300, 0.0005, 0.011, 121);
  const run = runSimulation(
    spec({
      engine: "normal",
      rebalance: "annual",
      returnsByAsset: [s, s.slice(), s.slice()],
      weights: [0.4, 0.3, 0.3],
      horizonDays: 252 * 5,
      paths: 400,
      seed: 6,
      initialValue: 50_000,
    }),
  );
  check("perfectly collinear covariance is ridged, not fatal", run.covRidged && Number.isFinite(run.median), `median ${money(run.median)}`);

  const wide = runSimulation(
    spec({
      engine: "normal",
      rebalance: "annual",
      returnsByAsset: Array.from({ length: 30 }, (_, i) => iidSeries(20, 0.0005, 0.01, 200 + i)),
      weights: Array.from({ length: 30 }, () => 1 / 30),
      horizonDays: 252 * 3,
      paths: 200,
      seed: 7,
      initialValue: 50_000,
    }),
  );
  check("more assets than days still simulates", Number.isFinite(wide.median) && wide.median > 0, `median ${money(wide.median)}`);
}

section("goal solving");
{
  const base = spec({
    engine: "bootstrap-iid",
    rebalance: "continuous",
    returnsByAsset: [iidSeries(504, 0.0005, 0.010, 131)],
    weights: [1],
    horizonDays: 252 * 20,
    paths: 1500,
    seed: 909,
    initialValue: 50_000,
    flows: flows({ contributionEveryDays: 21 }),
  });

  const goal = 1_000_000;
  const sol = solveFor({ spec: base, variable: "contribution", goal, target: 0.8 });
  check("solver finds a monthly contribution", sol.value != null && sol.value > 0, `$${money(sol.value ?? 0)}/mo`);
  check("solved contribution achieves the target", sol.achieved >= 0.79, `achieved ${pct(sol.achieved)}`);
  if (sol.value != null) {
    const under = runSimulation({ ...base, flows: { ...base.flows, contribution: sol.value * 0.7 } });
    check("30% less falls short of the target", probAbove(under.terminal, goal) < 0.8, `${pct(probAbove(under.terminal, goal))}`);
  }

  const yrs = solveFor({ spec: base, variable: "years", goal, target: 0.8 });
  check("solver finds a horizon", yrs.value != null && yrs.value > 0 && yrs.value < 60, `${(yrs.value ?? 0).toFixed(1)}y`);

  const impossible = solveFor({ spec: base, variable: "contribution", goal: 1e12, target: 0.8, max: 5000 });
  check("an unreachable goal returns null, not a lie", impossible.value === null, `best at max ${pct(impossible.atMax)}`);

  const trivial = solveFor({ spec: base, variable: "contribution", goal: 1, target: 0.8 });
  check("an already-met goal solves to zero", trivial.value === 0);
}

console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILURE(S)`} — ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
