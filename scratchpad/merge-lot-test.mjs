/* Verifies the share-weighted average-cost blend used when buying more of an
   equity already held in an account (app/api/holdings/add/route.ts).
   Mirrors the route's formula exactly. */

const blend = (prevShares, prevCost, addShares, addCost) => {
  const totalShares = prevShares + addShares;
  return {
    shares: totalShares,
    cost: totalShares !== 0 ? (prevShares * prevCost + addShares * addCost) / totalShares : addCost,
  };
};

let pass = 0, fail = 0;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const check = (name, got, want, eps) => {
  const ok = near(got, want, eps);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${got}, want ${want}`);
  ok ? pass++ : fail++;
};

// 1. Plain two-lot average — 10 @ $100 + 10 @ $200 = 20 @ $150.
{
  const r = blend(10, 100, 10, 200);
  check("equal lots blend to midpoint (shares)", r.shares, 20);
  check("equal lots blend to midpoint (cost)", r.cost, 150);
}

// 2. Weighted toward the larger lot — 90 @ $100 + 10 @ $200 = 100 @ $110.
{
  const r = blend(90, 100, 10, 200);
  check("larger lot dominates", r.cost, 110);
}

// 3. Total cost is conserved (the invariant that matters for unrealized P/L).
{
  const prevShares = 0.653, prevCost = 231.16, addShares = 0.25, addCost = 305.02;
  const r = blend(prevShares, prevCost, addShares, addCost);
  check(
    "total cost conserved",
    r.shares * r.cost,
    prevShares * prevCost + addShares * addCost,
    1e-9,
  );
}

// 4. Fractional shares (Carter's real TXN shape) stay sane.
{
  const r = blend(0.653, 231.16, 0.347, 300);
  check("fractional shares sum", r.shares, 1.0, 1e-12);
  check("fractional blend between the two bases", r.cost > 231.16 && r.cost < 300 ? 1 : 0, 1);
}

// 5. Buying at the SAME price leaves the basis untouched.
{
  const r = blend(5, 187.5, 3, 187.5);
  check("same-price buy leaves basis unchanged", r.cost, 187.5);
}

// 6. Adding to a zero-share row falls back to the new cost (no divide-by-zero).
{
  const r = blend(0, 0, 4, 42.5);
  check("zero prior shares uses new cost", r.cost, 42.5);
}

// 7. Blending is order-independent (A then B == B then A).
{
  const a = blend(7, 120, 3, 260);
  const b = blend(3, 260, 7, 120);
  check("order independent", a.cost, b.cost);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
