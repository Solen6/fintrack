/* Checks lib/rebalance.ts — the cash-aware rebalance planner.
 *
 *   JITI_ALIAS='{"@/":"'"$PWD"'/"}' node_modules/.bin/jiti scratchpad/rebalance-cash-test.ts
 *
 * The two things that matter most:
 *   1. With no cash entered, the plan must reproduce the OLD formulas exactly
 *      (targetPct = sleeveFrac × riskyFraction, trade = sleeveFrac × riskyValue
 *      − value). A silent change there would rewrite trades Carter already
 *      trusts.
 *   2. Buy-only must spend the cash to the last cent, never sell, and put it
 *      where it closes the most underweight gaps first.
 */
import { planRebalance, type RebalanceHolding } from "@/lib/rebalance";

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
   Equal 25% targets; AAA is badly overweight, DDD badly under.            */
const H: RebalanceHolding[] = [
  { ticker: "AAA", name: "A", value: 5000, targetShown: 25 },
  { ticker: "BBB", name: "B", value: 2500, targetShown: 25 },
  { ticker: "CCC", name: "C", value: 1500, targetShown: 25 },
  { ticker: "DDD", name: "D", value: 1000, targetShown: 25 },
];
const CASH = 1000;
const TOTAL = 11000; // 10,000 invested + 1,000 cash

// ─────────────────────────────────────────────────────────────────────────
// 1. No cash entered → identical to the pre-cash tool, formula for formula.
// ─────────────────────────────────────────────────────────────────────────
{
  const p = planRebalance({ holdings: H, cash: CASH });
  const riskyValue = 10000;
  const riskyFraction = riskyValue / TOTAL;

  for (const r of p.rows) {
    const src = H.find((h) => h.ticker === r.ticker)!;
    const sleeveFrac = 0.25;
    near(`[no-cash] ${r.ticker} currentPct = weightWithCash×100`, r.currentPct, (src.value / TOTAL) * 100);
    near(`[no-cash] ${r.ticker} targetPct = sleeveFrac×riskyFraction`, r.targetPct, sleeveFrac * riskyFraction * 100);
    near(`[no-cash] ${r.ticker} trade = sleeveFrac×riskyValue − value`, r.tradeDollar, sleeveFrac * riskyValue - src.value);
  }
  near("[no-cash] trades net to zero (cash untouched)", p.rows.reduce((s, r) => s + r.tradeDollar, 0), 0, 1e-9);
  near("[no-cash] cash deployed", p.cashDeployed, 0);
  near("[no-cash] cash after == cash before", p.cashAfter, CASH);
  // Old turnover was Σ|trade|/2; max(buys,sells) must agree when they balance.
  const legacyTurnover = p.rows.reduce((s, r) => s + Math.abs(r.tradeDollar), 0) / 2;
  near("[no-cash] turnover matches the legacy Σ|trade|÷2", p.turnover, legacyTurnover);
  near("[no-cash] every holding lands on target", p.maxDriftAfter, 0, 1e-9);
  ok("[no-cash] sorted by current % desc", p.rows.map((r) => r.ticker).join() === "AAA,BBB,CCC,DDD");
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Carter's case: deposit new money, buy only.
// ─────────────────────────────────────────────────────────────────────────
{
  const p = planRebalance({ holdings: H, cash: CASH, deposit: 4000, mode: "buy-only" });

  near("[deposit] total counts the deposit", p.totalValue, 15000);
  near("[deposit] cash on hand includes it", p.cashNow, 5000);
  near("[deposit] cash to invest = the deposit", p.cashToInvest, 4000);
  ok("[deposit] nothing is sold", p.rows.every((r) => r.tradeDollar >= 0));
  near("[deposit] spends the whole deposit", p.rows.reduce((s, r) => s + r.tradeDollar, 0), 4000, 1e-9);
  near("[deposit] cashDeployed == deposit", p.cashDeployed, 4000, 1e-9);
  near("[deposit] nothing left unplaced", p.cashLeftOver, 0, 1e-9);
  near("[deposit] idle cash is untouched", p.cashAfter, 1000, 1e-9);
  near("[deposit] turnover is the full buy side, not half of it", p.turnover, 4000, 1e-9);

  // $14,000 invested at 25% each = $3,500 target. AAA is already at $5,000,
  // so it gets nothing and the other three fill toward a common level.
  const by = Object.fromEntries(p.rows.map((r) => [r.ticker, r]));
  near("[deposit] AAA (overweight) gets nothing", by.AAA.tradeDollar, 0);
  // Level solves (4000 + 2500+1500+1000) / 0.75 = 12,000 → 25% = $3,000 each.
  near("[deposit] BBB filled to the level", by.BBB.tradeDollar, 500, 1e-9);
  near("[deposit] CCC filled to the level", by.CCC.tradeDollar, 1500, 1e-9);
  near("[deposit] DDD filled to the level", by.DDD.tradeDollar, 2000, 1e-9);
  ok(
    "[deposit] the three funded names end at the SAME weight",
    Math.abs(by.BBB.afterPct - by.CCC.afterPct) < 1e-9 &&
      Math.abs(by.CCC.afterPct - by.DDD.afterPct) < 1e-9,
  );
  ok("[deposit] AAA is still over target", by.AAA.driftAfterPct > 0.05);
  ok("[deposit] and the shortfall is reported", p.maxDriftAfter > 0.05);

  const sumAfter = p.rows.reduce((s, r) => s + r.afterPct, 0) + p.cashPctAfter;
  near("[deposit] after-weights + cash = 100% of the account", sumAfter, 100, 1e-9);
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Same deposit, buy & sell → every target hit exactly.
// ─────────────────────────────────────────────────────────────────────────
{
  const p = planRebalance({ holdings: H, cash: CASH, deposit: 4000, mode: "both" });
  near("[both] spends exactly the deposit, net", p.rows.reduce((s, r) => s + r.tradeDollar, 0), 4000, 1e-9);
  near("[both] every holding lands on target", p.maxDriftAfter, 0, 1e-9);
  for (const r of p.rows) near(`[both] ${r.ticker} ends at $3,500 of $15,000`, r.afterPct, (3500 / 15000) * 100, 1e-9);
  const by = Object.fromEntries(p.rows.map((r) => [r.ticker, r]));
  ok("[both] AAA is sold down", by.AAA.tradeDollar < 0);
  near("[both] AAA sells to its target", by.AAA.tradeDollar, -1500, 1e-9);
  // Buys 1000+2000+2500 = 5500, sells 1500 (net = the 4,000 deposit) → the
  // one-way figure is the buy side. Σ|trade|÷2 would say 3,500 here, which is
  // why turnover can't stay halved once cash enters the plan.
  near("[both] turnover = max(buys, sells)", p.turnover, 5500, 1e-9);
  near("[both] idle cash untouched", p.cashAfter, 1000, 1e-9);
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Deploying existing idle cash instead of depositing.
// ─────────────────────────────────────────────────────────────────────────
{
  const p = planRebalance({ holdings: H, cash: CASH, idleDeploy: 1000, mode: "buy-only" });
  near("[idle] account total is unchanged", p.totalValue, TOTAL);
  near("[idle] cash on hand is unchanged", p.cashNow, CASH);
  near("[idle] cash is drained", p.cashAfter, 0, 1e-9);
  near("[idle] all of it is spent", p.cashDeployed, 1000, 1e-9);
  near("[idle] invested sleeve grows by it", p.investedAfter, 11000);

  const half = planRebalance({ holdings: H, cash: CASH, idleDeploy: 400, mode: "buy-only" });
  near("[idle] partial deploy spends only what was asked", half.cashDeployed, 400, 1e-9);
  near("[idle] the rest stays in cash", half.cashAfter, 600, 1e-9);

  const over = planRebalance({ holdings: H, cash: CASH, idleDeploy: 9999, mode: "buy-only" });
  near("[idle] a request above the balance is clamped", over.cashDeployed, CASH, 1e-9);
  near("[idle] cash can't go negative", over.cashAfter, 0, 1e-9);
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Level-filling behaviour: order of filling, and enough cash to catch up.
// ─────────────────────────────────────────────────────────────────────────
{
  // A tiny deposit must land entirely on the single most underweight name
  // (DDD at ratio 1000/0.25 = 4,000, vs CCC at 6,000) and stop when it
  // reaches CCC's ratio: DDD needs (6000−4000)×0.25 = $500 to catch up.
  const small = planRebalance({ holdings: H, cash: CASH, deposit: 300, mode: "buy-only" });
  const s = Object.fromEntries(small.rows.map((r) => [r.ticker, r]));
  near("[fill] a small deposit goes only to the most underweight", s.DDD.tradeDollar, 300, 1e-9);
  ok("[fill] nobody else is touched", s.AAA.tradeDollar === 0 && s.BBB.tradeDollar === 0 && s.CCC.tradeDollar === 0);

  const exact = planRebalance({ holdings: H, cash: CASH, deposit: 500, mode: "buy-only" });
  const e = Object.fromEntries(exact.rows.map((r) => [r.ticker, r]));
  near("[fill] $500 exactly closes DDD's gap to CCC", e.DDD.tradeDollar, 500, 1e-9);
  near("[fill] CCC still gets nothing at the breakpoint", e.CCC.tradeDollar, 0, 1e-9);

  const past = planRebalance({ holdings: H, cash: CASH, deposit: 700, mode: "buy-only" });
  const q = Object.fromEntries(past.rows.map((r) => [r.ticker, r]));
  ok("[fill] past the breakpoint CCC joins in", q.CCC.tradeDollar > 0);
  near("[fill] and DDD+CCC still spend it all", q.CCC.tradeDollar + q.DDD.tradeDollar, 700, 1e-9);
  ok("[fill] they end level with each other", Math.abs(q.CCC.afterPct - q.DDD.afterPct) < 1e-9);

  // Enough cash and buy-only converges on the target for everyone.
  const huge = planRebalance({ holdings: H, cash: CASH, deposit: 1_000_000, mode: "buy-only" });
  ok("[fill] a large enough deposit closes every gap", huge.maxDriftAfter < 0.05, `drift ${huge.maxDriftAfter}`);
  near("[fill] and still spends every cent", huge.rows.reduce((s2, r) => s2 + r.tradeDollar, 0), 1_000_000, 1e-6);
}

// ─────────────────────────────────────────────────────────────────────────
// 6. Uneven targets — level-filling is per point of target, not per dollar.
// ─────────────────────────────────────────────────────────────────────────
{
  const uneven: RebalanceHolding[] = [
    { ticker: "BIG", name: "big", value: 1000, targetShown: 80 },
    { ticker: "SML", name: "small", value: 1000, targetShown: 20 },
  ];
  const p = planRebalance({ holdings: uneven, cash: 0, deposit: 1000, mode: "buy-only" });
  const by = Object.fromEntries(p.rows.map((r) => [r.ticker, r]));
  // BIG ratio 1250, SML ratio 5000 → only BIG is under. Level = (1000+1000)/0.8
  // = 2500 → BIG buys 2500×0.8 − 1000 = $1,000. SML gets nothing.
  near("[uneven] the whole deposit goes to the underweight target", by.BIG.tradeDollar, 1000, 1e-9);
  near("[uneven] the over-target name gets nothing", by.SML.tradeDollar, 0, 1e-9);
  ok("[uneven] SML is still above its target", by.SML.driftAfterPct > 0.05);
}

// ─────────────────────────────────────────────────────────────────────────
// 7. Targets are normalized, not read as literal percents.
// ─────────────────────────────────────────────────────────────────────────
{
  const asPct = planRebalance({ holdings: H, cash: CASH, deposit: 2000, mode: "buy-only" });
  const asRatio = planRebalance({
    holdings: H.map((h) => ({ ...h, targetShown: h.targetShown * 7.3 })),
    cash: CASH,
    deposit: 2000,
    mode: "buy-only",
  });
  ok(
    "[normalize] scaling every target by 7.3× changes nothing",
    asPct.rows.every((r, i) => Math.abs(r.tradeDollar - asRatio.rows[i].tradeDollar) < 1e-9),
  );
  near("[normalize] targetSum echoes what was typed", asPct.targetSum, 100);
  near("[normalize] even when it isn't 100", asRatio.targetSum, 730);
}

// ─────────────────────────────────────────────────────────────────────────
// 8. Degenerate inputs must not produce nonsense.
// ─────────────────────────────────────────────────────────────────────────
{
  const zero = planRebalance({
    holdings: H.map((h) => ({ ...h, targetShown: 0 })),
    cash: CASH,
    deposit: 500,
    mode: "buy-only",
  });
  near("[edge] no targets → nothing bought", zero.cashDeployed, 0);
  near("[edge] and the cash is reported as unplaced", zero.cashLeftOver, 500);
  near("[edge] it all stays in cash", zero.cashAfter, 1500);

  const empty = planRebalance({ holdings: [], cash: 500, deposit: 100, mode: "buy-only" });
  ok("[edge] no holdings → no rows", empty.rows.length === 0);
  near("[edge] no holdings → nothing deployed", empty.cashDeployed, 0);
  near("[edge] no holdings → drift is zero, not NaN", empty.maxDrift, 0);

  const noCash = planRebalance({ holdings: H, cash: 0 });
  near("[edge] cash-free account still rebalances", noCash.totalValue, 10000);
  near("[edge] cash-free targetPct is the raw sleeve share", noCash.rows[0].targetPct, 25);

  const negative = planRebalance({ holdings: H, cash: CASH, deposit: -500, idleDeploy: -20 });
  near("[edge] negative deposit is floored at 0", negative.cashToInvest, 0);
  near("[edge] negative deposit doesn't shrink the account", negative.totalValue, TOTAL);

  const noMoney = planRebalance({ holdings: [], cash: 0 });
  near("[edge] an empty account is all zeros, not NaN", noMoney.cashPct, 0);
  ok("[edge] turnover on an empty account is finite", Number.isFinite(noMoney.turnover));
}

// ─────────────────────────────────────────────────────────────────────────
// 9. Invariants over randomized inputs.
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
      targetShown: rnd() < 0.15 ? 0 : rnd() * 100,
    }));
    const cash = rnd() * 5000;
    const deposit = rnd() < 0.3 ? 0 : rnd() * 20000;
    const idleDeploy = rnd() * cash;
    const mode = rnd() < 0.5 ? "buy-only" : "both";
    const p = planRebalance({ holdings: hs, cash, deposit, idleDeploy, mode });
    const scale = Math.max(1, p.totalValue);

    const weights = p.rows.reduce((s, r) => s + r.afterPct, 0) + p.cashPctAfter;
    if (p.totalValue > 0 && Math.abs(weights - 100) > 1e-6) bad++;
    if (Math.abs(p.cashAfter - (p.cashNow - p.cashDeployed)) > 1e-9 * scale) bad++;
    if (p.cashAfter < -1e-9 * scale) bad++;
    if (mode === "buy-only" && p.rows.some((r) => r.tradeDollar < -1e-9)) bad++;
    // Every plan spends the contribution unless there was no target to spend it on.
    if (p.targetSum > 0 && Math.abs(p.cashDeployed - p.cashToInvest) > 1e-6 * scale) bad++;
    if (p.rows.some((r) => !Number.isFinite(r.tradeDollar) || !Number.isFinite(r.afterPct))) bad++;
    if (mode === "both" && p.targetSum > 0 && p.maxDriftAfter > 1e-6) bad++;
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
