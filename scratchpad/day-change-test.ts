/* Verifies lib/day-change.ts: per-account totals, the acquired-today rule, the
   cash/bond/derivative exclusions, and that it reproduces the formula the
   summary strip used before the two were merged. Run: npx tsx scratchpad/day-change-test.ts */
import { computeDayChange } from "../lib/day-change";
import type { HoldingWithMetrics } from "../lib/types";

const NOW = new Date("2026-08-04T18:00:00Z"); // 2pm ET, a weekday

let pass = 0;
let fail = 0;
function check(name: string, got: number | boolean, want: number | boolean, tol = 1e-6) {
  const ok =
    typeof got === "number" && typeof want === "number" ? Math.abs(got - want) <= tol : got === want;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (got ${got}, want ${want})`}`);
}

function h(p: Partial<HoldingWithMetrics> & { value: number; todayChangePct: number }): HoldingWithMetrics {
  return {
    id: p.id ?? "x", ticker: p.ticker ?? "X", name: "", sector: "", shares: p.shares ?? 1,
    costBasis: 0, currentPrice: 0, account: p.account ?? "brokerage",
    // Real shape: acquired_at is a timestamptz, so the client sees a full ISO stamp.
    acquiredAt: p.acquiredAt ?? "2020-01-01T14:30:00+00:00", instrumentType: p.instrumentType ?? "equity",
    value: p.value, costTotal: p.costTotal ?? 0, gainDollar: 0, gainPercent: 0,
    todayChangePct: p.todayChangePct,
  } as HoldingWithMetrics;
}

// 1. Single position up 2%: $10,200 now → $10,000 prior → +$200, +2.00%.
{
  const d = computeDayChange([h({ value: 10_200, todayChangePct: 2 })], NOW);
  check("up 2% → dollars", d.dollar, 200);
  check("up 2% → percent", d.pct, 2);
  check("up 2% → prior value", d.priorValue, 10_000);
}

// 2. A loser and a winner net out; percent is off the combined prior value.
{
  const d = computeDayChange(
    [h({ value: 10_200, todayChangePct: 2 }), h({ ticker: "Y", value: 4_950, todayChangePct: -1 })],
    NOW,
  );
  check("mixed → dollars", d.dollar, 200 - 50);
  check("mixed → percent", d.pct, (150 / 15_000) * 100);
}

// 3. Bought today: measured from cost, not from a prior close it never held.
//    "Today" is the ET calendar day — 13:45Z is 9:45am ET on the 4th.
{
  const d = computeDayChange(
    [h({ value: 1_050, costTotal: 1_000, todayChangePct: 40, acquiredAt: "2026-08-04T13:45:00+00:00" })],
    NOW,
  );
  check("acquired today → from entry, not the 40% quote", d.dollar, 50);
  check("acquired today → percent off cost", d.pct, 5);
}

// 3b. Bought late yesterday ET is NOT today — 2026-08-04T01:00Z is 9pm ET on the 3rd.
{
  const d = computeDayChange(
    [h({ value: 1_050, costTotal: 1_000, todayChangePct: 5, acquiredAt: "2026-08-04T01:00:00+00:00" })],
    NOW,
  );
  check("yesterday-ET buy → measured from the market, not cost", d.dollar, 1_050 - 1_050 / 1.05);
}

// 4. Bonds/derivatives carry no intraday mark (pct 0) → contribute $0, but they
//    still sit in the denominator as flat value.
{
  const d = computeDayChange(
    [h({ value: 10_200, todayChangePct: 2 }), h({ ticker: "B", value: 5_000, todayChangePct: 0, instrumentType: "bond" })],
    NOW,
  );
  check("flat bond adds no dollars", d.dollar, 200);
  check("flat bond dilutes the percent", d.pct, (200 / 15_000) * 100);
}

// 5. No positions at all (a cash-only account) → nothing to show.
{
  const d = computeDayChange([], NOW);
  check("empty → dollars", d.dollar, 0);
  check("empty → percent", d.pct, 0);
  check("empty → priorValue is 0 so the row hides", d.priorValue, 0);
  check("empty → hasMoves false", d.hasMoves, false);
}

// 6. Garbage -100% quote can't poison the sum.
{
  const d = computeDayChange(
    [h({ value: 10_200, todayChangePct: 2 }), h({ ticker: "Z", value: 500, todayChangePct: -100 })],
    NOW,
  );
  check("−100% quote → finite dollars", Number.isFinite(d.dollar), true);
  check("−100% quote → treated flat", d.dollar, 200);
}

// 7. Per-account split sums to the whole-portfolio figure.
{
  const all = [
    h({ account: "brokerage", value: 10_200, todayChangePct: 2 }),
    h({ account: "roth", ticker: "Y", value: 4_950, todayChangePct: -1 }),
    h({ account: "roth", ticker: "W", value: 2_020, todayChangePct: 1 }),
  ];
  const whole = computeDayChange(all, NOW);
  const brokerage = computeDayChange(all.filter((x) => x.account === "brokerage"), NOW);
  const roth = computeDayChange(all.filter((x) => x.account === "roth"), NOW);
  check("accounts sum to the whole", brokerage.dollar + roth.dollar, whole.dollar);
  check("brokerage percent is its own, not the blend", brokerage.pct, 2);
  check("roth percent is its own", roth.pct, ((-50 + 20) / (5_000 + 2_000)) * 100);
}

// 8. Matches the formula SummaryStrip used before the merge, on the same input.
{
  const rows = [
    h({ value: 10_200, todayChangePct: 2 }),
    h({ ticker: "Y", value: 4_950, todayChangePct: -1 }),
    h({ ticker: "Z", value: 3_000, todayChangePct: 0, instrumentType: "bond" }),
  ];
  const positionsValue = rows.reduce((s, x) => s + x.value, 0);
  const legacyDollar = rows.reduce((s, x) => {
    const pct = x.todayChangePct / 100;
    return s + (x.value / (1 + pct)) * pct;
  }, 0);
  const legacyPct = (legacyDollar / (positionsValue - legacyDollar)) * 100;
  const d = computeDayChange(rows, NOW);
  check("legacy strip dollars preserved", d.dollar, legacyDollar);
  check("legacy strip percent preserved", d.pct, legacyPct);
}

console.log(fail === 0 ? `\nALL ${pass} CHECKS PASS` : `\n${fail} FAILURES / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
