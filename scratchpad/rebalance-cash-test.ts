/* Checks lib/rebalance.ts — the cash-aware rebalance planner.
 *
 *   JITI_ALIAS='{"@/":"'"$PWD"'/"}' node_modules/.bin/jiti scratchpad/rebalance-cash-test.ts
 *
 * The governing rule: a target is a percent OF THE WHOLE ACCOUNT, used exactly
 * as typed and never renormalized. That makes cash a first-class target — the
 * share you don't allocate is the share meant to stay in cash — so a deposit
 * splits between securities and cash the way the targets imply.
 */
import { planRebalance, retargetForCash, type RebalanceHolding } from "@/lib/rebalance";

const round2 = (n: number) => Math.round(n * 100) / 100;

let pass = 0;
const failures: string[] = [];

function ok(label: string, cond: boolean, detail = "") {
  if (cond) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}
function near(label: string, got: number, want: number, eps = 1e-6) {
  ok(label, Math.abs(got - want) < eps, `got ${got}, want ${want}`);
}

/* ── Fixture: a $10,000 sleeve that has drifted, plus $1,000 idle cash. ──
   Targets sum to 90, so 10% of the account is meant to be cash.           */
const H: RebalanceHolding[] = [
  { ticker: "AAA", name: "A", value: 5000, targetShown: 22.5 },
  { ticker: "BBB", name: "B", value: 2500, targetShown: 22.5 },
  { ticker: "CCC", name: "C", value: 1500, targetShown: 22.5 },
  { ticker: "DDD", name: "D", value: 1000, targetShown: 22.5 },
];
const CASH = 1000;
const TOTAL = 11000;

// ─────────────────────────────────────────────────────────────────────────
// 1. A target means exactly what it says: percent of the account.
// ─────────────────────────────────────────────────────────────────────────
{
  const p = planRebalance({ holdings: H, cash: CASH });
  for (const r of p.rows) {
    near(`[literal] ${r.ticker} target is used verbatim`, r.targetPct, r.targetShown);
    const src = H.find((h) => h.ticker === r.ticker)!;
    near(`[literal] ${r.ticker} current % is its share of the account`, r.currentPct, (src.value / TOTAL) * 100);
    near(`[literal] ${r.ticker} trade closes the gap in dollars`, r.tradeDollar, 0.225 * TOTAL - src.value);
    near(`[literal] ${r.ticker} lands exactly on target`, r.afterPct, r.targetPct, 1e-9);
  }
  near("[literal] the unallocated share is the cash target", p.cashTargetPct, 10);
  ok("[literal] not flagged as over-allocated", !p.overAllocated);
  near("[literal] cash lands on its target too", p.cashPctAfter, 10, 1e-9);
  near("[literal] which is $1,100 — so $100 is raised", p.cashAfter, 1100, 1e-9);
  near("[literal] cash deployed is negative (cash went UP)", p.cashDeployed, -100, 1e-9);
  ok("[literal] sorted by current % desc", p.rows.map((r) => r.ticker).join() === "AAA,BBB,CCC,DDD");

  // Every column adds to the whole account, before and after.
  near(
    "[literal] current weights + cash = 100%",
    p.rows.reduce((s, r) => s + r.currentPct, 0) + p.cashPct,
    100,
    1e-9,
  );
  near(
    "[literal] after-weights + cash = 100%",
    p.rows.reduce((s, r) => s + r.afterPct, 0) + p.cashPctAfter,
    100,
    1e-9,
  );
  near("[literal] targets + cash target = 100%", p.targetSum + p.cashTargetPct, 100);
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Carter's case: deposit new money. The targets DON'T move — that was the
//    whole complaint — and the deposit splits per the targets.
// ─────────────────────────────────────────────────────────────────────────
{
  const p = planRebalance({ holdings: H, cash: CASH, deposit: 4000, mode: "both" });
  near("[deposit] total counts the deposit", p.totalValue, 15000);
  near("[deposit] cash on hand includes it", p.cashNow, 5000);

  for (const r of p.rows) {
    near(`[deposit] ${r.ticker} target is UNCHANGED by the deposit`, r.targetPct, 22.5);
    near(`[deposit] ${r.ticker} ends on target`, r.afterPct, 22.5, 1e-9);
    near(`[deposit] ${r.ticker} target value is 22.5% of $15,000`, r.value + r.tradeDollar, 3375, 1e-9);
  }
  near("[deposit] every gap closes", p.maxDriftAfter, 0, 1e-9);

  // 10% of $15,000 = $1,500 stays in cash, so $3,500 of the $5,000 on hand
  // goes into securities — the deposit is split, not blindly all invested.
  near("[deposit] cash lands on its 10% target", p.cashAfter, 1500, 1e-9);
  near("[deposit] so $3,500 is deployed", p.cashDeployed, 3500, 1e-9);
  near("[deposit] and the cash % is exactly the target", p.cashPctAfter, 10, 1e-9);
  near("[deposit] trades net to the cash deployed", p.rows.reduce((s, r) => s + r.tradeDollar, 0), 3500, 1e-9);
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Same deposit, buy only. Nothing is sold; spare cash level-fills.
// ─────────────────────────────────────────────────────────────────────────
{
  const p = planRebalance({ holdings: H, cash: CASH, deposit: 4000, mode: "buy-only" });
  ok("[buy-only] nothing is sold", p.rows.every((r) => r.tradeDollar >= 0));
  near("[buy-only] investable cash is what sits above the cash target", p.investableCash, 3500, 1e-9);
  near("[buy-only] and it spends all of it", p.cashDeployed, 3500, 1e-9);
  near("[buy-only] leaving the cash target", p.cashAfter, 1500, 1e-9);
  near("[buy-only] turnover is the full buy side, not half of it", p.turnover, 3500, 1e-9);

  // AAA is already at $5,000 > its $3,375 target, so it gets nothing and the
  // level fill splits $3,500 among the other three.
  const by = Object.fromEntries(p.rows.map((r) => [r.ticker, r]));
  near("[buy-only] AAA (overweight) gets nothing", by.AAA.tradeDollar, 0);
  ok("[buy-only] AAA is left above target", by.AAA.driftAfterPct > 0.05);
  ok("[buy-only] and the shortfall is reported", p.maxDriftAfter > 0.05);
  // Level = (3500 + 2500+1500+1000) / 0.675 = $12,592.59 → each ends at 22.5%
  // of that = $2,833.33.
  for (const t of ["BBB", "CCC", "DDD"]) {
    near(`[buy-only] ${t} filled to the common level`, by[t].value + by[t].tradeDollar, 2833.3333333, 1e-4);
  }
  near("[buy-only] the three buys sum to the cash", by.BBB.tradeDollar + by.CCC.tradeDollar + by.DDD.tradeDollar, 3500, 1e-6);
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Fully invested (targets sum to 100) → all the cash is deployed.
// ─────────────────────────────────────────────────────────────────────────
{
  const full: RebalanceHolding[] = H.map((h) => ({ ...h, targetShown: 25 }));
  const p = planRebalance({ holdings: full, cash: CASH, mode: "both" });
  near("[full] no cash target", p.cashTargetPct, 0);
  near("[full] cash is drained", p.cashAfter, 0, 1e-9);
  near("[full] all $1,000 deployed", p.cashDeployed, 1000, 1e-9);
  for (const r of p.rows) near(`[full] ${r.ticker} ends at 25%`, r.afterPct, 25, 1e-9);

  const dep = planRebalance({ holdings: full, cash: CASH, deposit: 4000, mode: "buy-only" });
  near("[full] with a deposit the whole $5,000 is investable", dep.investableCash, 5000, 1e-9);
  near("[full] and buy-only spends it all", dep.cashDeployed, 5000, 1e-9);
  near("[full] cash ends at zero", dep.cashAfter, 0, 1e-9);
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Level-filling order — the money goes to the most underweight first.
// ─────────────────────────────────────────────────────────────────────────
{
  // Ratios value÷target: AAA 22222, BBB 11111, CCC 6666, DDD 4444. DDD is the
  // most underweight; it needs (6666.67−4444.44)×0.225 = $500 to catch CCC.
  const small = planRebalance({ holdings: H, cash: CASH, deposit: 1300, mode: "buy-only" });
  const s = Object.fromEntries(small.rows.map((r) => [r.ticker, r]));
  near("[fill] investable = 2300 on hand − 10% of 12,300", small.investableCash, 1070, 1e-9);
  ok("[fill] DDD (most underweight) gets the most", s.DDD.tradeDollar > s.CCC.tradeDollar);
  ok("[fill] CCC next", s.CCC.tradeDollar > s.BBB.tradeDollar);
  ok("[fill] AAA, already over target, gets nothing", s.AAA.tradeDollar === 0);
  near("[fill] and it all gets spent", small.cashDeployed, small.investableCash, 1e-6);

  // Fully-invested targets, so the whole $200 is investable. DDD is the most
  // underweight and needs $500 to catch CCC, so all $200 lands on DDD.
  const tiny = planRebalance({
    holdings: H.map((h) => ({ ...h, targetShown: 25 })),
    cash: 0,
    deposit: 200,
    mode: "buy-only",
  });
  const t = Object.fromEntries(tiny.rows.map((r) => [r.ticker, r]));
  near("[fill] a tiny amount lands only on the most underweight", t.DDD.tradeDollar, 200, 1e-9);
  ok("[fill] nobody else is touched", t.AAA.tradeDollar === 0 && t.BBB.tradeDollar === 0 && t.CCC.tradeDollar === 0);

  // Below the cash target, buy-only has nothing to spend — raising cash would
  // mean selling, which it won't do.
  const short = planRebalance({ holdings: H, cash: 0, deposit: 200, mode: "buy-only" });
  near("[fill] below the cash target, nothing is investable", short.investableCash, 0);
  near("[fill] so buy-only places no trades", short.cashDeployed, 0);
  ok("[fill] but buy & sell will raise the cash", planRebalance({ holdings: H, cash: 0, deposit: 200, mode: "both" }).cashAfter > 200);

  // Enough cash and buy-only converges on every target.
  const huge = planRebalance({ holdings: H, cash: CASH, deposit: 1_000_000, mode: "buy-only" });
  ok("[fill] a large enough deposit closes every gap", huge.maxDriftAfter < 0.05, `drift ${huge.maxDriftAfter}`);
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Over-allocation: past 100% the column is scaled back, and flagged.
// ─────────────────────────────────────────────────────────────────────────
{
  const over: RebalanceHolding[] = H.map((h) => ({ ...h, targetShown: 50 })); // sums to 200
  const p = planRebalance({ holdings: over, cash: CASH, mode: "both" });
  ok("[over] flagged", p.overAllocated);
  near("[over] the raw sum is still reported", p.targetSum, 200);
  for (const r of p.rows) near(`[over] ${r.ticker} scaled to fit`, r.targetPct, 25);
  near("[over] no cash target is left", p.cashTargetPct, 0);
  near("[over] cash is fully deployed, never negative", p.cashAfter, 0, 1e-9);
  ok("[over] and cash can't go below zero", p.cashAfter >= -1e-9);
}

// ─────────────────────────────────────────────────────────────────────────
// 7. Degenerate inputs must not produce nonsense.
// ─────────────────────────────────────────────────────────────────────────
{
  const zero = planRebalance({ holdings: H.map((h) => ({ ...h, targetShown: 0 })), cash: CASH, deposit: 500, mode: "buy-only" });
  near("[edge] no targets → 100% cash target", zero.cashTargetPct, 100);
  near("[edge] so nothing is bought", zero.cashDeployed, 0);
  near("[edge] and nothing is investable", zero.investableCash, 0);

  const empty = planRebalance({ holdings: [], cash: 500, deposit: 100, mode: "buy-only" });
  ok("[edge] no holdings → no rows", empty.rows.length === 0);
  near("[edge] no holdings → nothing deployed", empty.cashDeployed, 0);
  near("[edge] no holdings → drift is zero, not NaN", empty.maxDrift, 0);

  const noCash = planRebalance({ holdings: H.map((h) => ({ ...h, targetShown: 25 })), cash: 0 });
  near("[edge] cash-free account still rebalances", noCash.totalValue, 10000);
  near("[edge] cash-free targets are literal too", noCash.rows[0].targetPct, 25);

  const negative = planRebalance({ holdings: H, cash: CASH, deposit: -500 });
  near("[edge] negative deposit is floored at 0", negative.totalValue, TOTAL);

  const negTarget = planRebalance({ holdings: H.map((h) => ({ ...h, targetShown: -5 })), cash: CASH });
  near("[edge] negative targets are floored at 0", negTarget.rows[0].targetPct, 0);

  const noMoney = planRebalance({ holdings: [], cash: 0 });
  near("[edge] an empty account is all zeros, not NaN", noMoney.cashPct, 0);
  ok("[edge] turnover on an empty account is finite", Number.isFinite(noMoney.turnover));
}

// ─────────────────────────────────────────────────────────────────────────
// 7b. Setting the cash target rewrites the holdings to leave exactly that
//     much, without disturbing their proportions to each other.
// ─────────────────────────────────────────────────────────────────────────
{
  const TICKERS = H.map((h) => h.ticker);
  const base = Object.fromEntries(H.map((h) => [h.ticker, h.targetShown])); // 22.5 ×4 = 90

  const to5 = retargetForCash(base, TICKERS, 5);
  near("[cash-target] holdings sum to 100 − cash", Object.values(to5).reduce((s, n) => s + n, 0), 95, 1e-9);
  ok("[cash-target] all four moved together", TICKERS.every((t) => Math.abs(to5[t] - 23.75) < 0.01));

  // Proportions survive: an uneven column keeps its ratios exactly.
  const uneven = { AAA: 45.45, BBB: 22.73, CCC: 13.64, DDD: 9.09 }; // sums to 90.91
  const u5 = retargetForCash(uneven, TICKERS, 5);
  near("[cash-target] uneven column still sums right", Object.values(u5).reduce((s, n) => s + n, 0), 95, 1e-9);
  near(
    "[cash-target] AAA:BBB ratio is preserved",
    u5.AAA / u5.BBB,
    uneven.AAA / uneven.BBB,
    2e-3,
  );
  near("[cash-target] CCC:DDD ratio is preserved", u5.CCC / u5.DDD, uneven.CCC / uneven.DDD, 2e-3);

  // Round-trip: down and back lands on the same numbers.
  const back = retargetForCash(u5, TICKERS, round2(100 - 90.91));
  for (const t of TICKERS) {
    near(`[cash-target] ${t} round-trips`, back[t], uneven[t as keyof typeof uneven], 0.02);
  }

  // Lowering the cash target is what frees cash to buy with.
  const before = planRebalance({ holdings: H, cash: CASH, mode: "buy-only" });
  near("[cash-target] at a 10% target there's nothing spare", before.investableCash, 0, 1e-9);
  const after = planRebalance({
    holdings: H.map((h) => ({ ...h, targetShown: to5[h.ticker] })),
    cash: CASH,
    mode: "buy-only",
  });
  // 5% of $11,000 = $550 should stay in cash, so $450 of the $1,000 is freed.
  near("[cash-target] dropping it to 5% frees $450 to invest", after.investableCash, 450, 1e-9);
  near("[cash-target] and the plan spends it", after.cashDeployed, 450, 1e-9);
  near("[cash-target] leaving $550 = 5% in cash", after.cashAfter, 550, 1e-9);
  near("[cash-target] which is exactly the target", after.cashPctAfter, 5, 1e-6);

  // Raising it does the opposite — buy & sell raises cash by selling.
  const to20 = retargetForCash(base, TICKERS, 20);
  const raised = planRebalance({
    holdings: H.map((h) => ({ ...h, targetShown: to20[h.ticker] })),
    cash: CASH,
    mode: "both",
  });
  ok("[cash-target] raising the target sells to raise cash", raised.cashDeployed < 0);
  near("[cash-target] landing on 20% cash", raised.cashPctAfter, 20, 1e-6);

  // Edges.
  const all = retargetForCash(base, TICKERS, 100);
  ok("[cash-target] 100% cash zeroes every holding", TICKERS.every((t) => all[t] === 0));
  const recover = retargetForCash(all, TICKERS, 20);
  ok(
    "[cash-target] coming back from all-cash spreads evenly",
    TICKERS.every((t) => Math.abs(recover[t] - 20) < 0.01),
  );
  near("[cash-target] and still sums right", Object.values(recover).reduce((s, n) => s + n, 0), 80, 1e-9);

  const clamped = retargetForCash(base, TICKERS, -30);
  near("[cash-target] a negative target clamps to 0", Object.values(clamped).reduce((s, n) => s + n, 0), 100, 1e-9);
  const over = retargetForCash(base, TICKERS, 150);
  near("[cash-target] above 100 clamps to 100", Object.values(over).reduce((s, n) => s + n, 0), 0, 1e-9);
  ok("[cash-target] no holdings → no crash", Object.keys(retargetForCash(base, [], 10)).length === 0);

  // Rounding residue is parked, so the cash target reads back exactly.
  let residueBad = 0;
  for (let n = 2; n <= 9; n++) {
    for (const target of [3, 5, 7, 12.5, 33.33]) {
      const tks = Array.from({ length: n }, (_, i) => `T${i}`);
      const cur = Object.fromEntries(tks.map((t, i) => [t, 1 + i * 3.7]));
      const out = retargetForCash(cur, tks, target);
      const sum = Object.values(out).reduce((s, v) => s + v, 0);
      if (Math.abs(sum - round2(100 - target)) > 1e-9) residueBad++;
      if (Object.values(out).some((v) => v < 0)) residueBad++;
    }
  }
  ok("[cash-target] 40 rescales all land exactly, none negative", residueBad === 0, `${residueBad} bad`);
}

// ─────────────────────────────────────────────────────────────────────────
// 8. Invariants over randomized inputs.
// ─────────────────────────────────────────────────────────────────────────
{
  let bad = 0;
  let seed = 20260810;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

  for (let trial = 0; trial < 400; trial++) {
    const n = 1 + Math.floor(rnd() * 8);
    const hs: RebalanceHolding[] = Array.from({ length: n }, (_, i) => ({
      ticker: `T${i}`,
      name: `T${i}`,
      value: rnd() * 20000,
      targetShown: rnd() < 0.15 ? 0 : (rnd() * 140) / n, // sometimes over-allocates
    }));
    const cash = rnd() * 5000;
    const deposit = rnd() < 0.3 ? 0 : rnd() * 20000;
    const mode = rnd() < 0.5 ? "buy-only" : "both";
    const p = planRebalance({ holdings: hs, cash, deposit, mode });
    const scale = Math.max(1, p.totalValue);

    const weights = p.rows.reduce((s, r) => s + r.afterPct, 0) + p.cashPctAfter;
    if (p.totalValue > 0 && Math.abs(weights - 100) > 1e-6) bad++;
    if (Math.abs(p.cashAfter - (p.cashNow - p.cashDeployed)) > 1e-9 * scale) bad++;
    if (p.cashAfter < -1e-6 * scale) bad++; // a plan must never overdraw cash
    if (mode === "buy-only" && p.rows.some((r) => r.tradeDollar < -1e-9)) bad++;
    if (mode === "buy-only" && Math.abs(p.cashDeployed - p.investableCash) > 1e-6 * scale &&
        p.rows.some((r) => r.targetPct > 0)) bad++;
    if (p.rows.some((r) => !Number.isFinite(r.tradeDollar) || !Number.isFinite(r.afterPct))) bad++;
    // Buy & sell always lands every holding AND the cash on target.
    if (mode === "both" && p.maxDriftAfter > 1e-6) bad++;
    if (mode === "both" && Math.abs(p.cashPctAfter - p.cashTargetPct) > 1e-6) bad++;
    if (Math.abs(p.targetSum * (p.overAllocated ? 100 / p.targetSum : 1) + p.cashTargetPct - 100) > 1e-6
        && p.rows.length > 0) bad++;
    if (p.turnover < -1e-9) bad++;
  }
  ok("[random] 400 randomized plans hold every invariant", bad === 0, `${bad} violations`);
}

console.log(`${pass} checks passed`);
if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("ALL PASS");
