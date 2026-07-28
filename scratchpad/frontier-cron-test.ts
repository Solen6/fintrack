/* Tests the unattended yearly-capture logic against a stubbed Supabase client:
   who is due, what weights get written, and that a missing table degrades
   instead of throwing (it rides the daily cron and must never abort it).
     node_modules/.bin/jiti scratchpad/frontier-cron-test.ts                    */

import { captureDueFrontierSnapshots, type SnapshotHolding } from "../lib/frontier-snapshots";
import { weightsFromHoldings, isPriceable } from "../lib/portfolio-positions";

let fails = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "✓" : "✗ FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const TODAY = "2026-07-28";
const daysAgo = (n: number) => new Date(Date.parse(TODAY) - n * 86_400_000).toISOString().slice(0, 10);

/** Minimal Supabase stub: canned select, captured upsert. */
function stubDb(existing: { user_id: string; taken_on: string }[], selectError?: string) {
  const writes: any[] = [];
  return {
    writes,
    from() {
      return {
        select: async () => (selectError ? { data: null, error: { message: selectError } } : { data: existing, error: null }),
        upsert: async (rows: any[]) => {
          writes.push(...rows);
          return { error: null };
        },
      };
    },
  } as any;
}

const h = (user_id: string, ticker: string, shares: number, extra: Partial<SnapshotHolding> = {}): SnapshotHolding => ({
  user_id, ticker, shares, cost_basis: 100, instrument_type: "equity", bond_type: null, ...extra,
});

const QUOTES = { AAPL: { price: 100 }, MSFT: { price: 100 }, NVDA: { price: 200 } };

/* ─── 1. Who is due ─── */
console.log("── due detection ──");
{
  const holdings = [h("never", "AAPL", 10), h("recent", "AAPL", 10), h("old", "AAPL", 10), h("exact", "AAPL", 10)];
  const db = stubDb([
    { user_id: "recent", taken_on: daysAgo(364) },
    { user_id: "old", taken_on: daysAgo(400) },
    { user_id: "exact", taken_on: daysAgo(365) },
  ]);
  const res = await captureDueFrontierSnapshots(db, TODAY, holdings, QUOTES);
  const captured = new Set(db.writes.map((w: any) => w.user_id));
  check("never-captured user is due", captured.has("never"));
  check("364 days ago is NOT due", !captured.has("recent"));
  check("exactly 365 days ago IS due", captured.has("exact"));
  check("400 days ago is due", captured.has("old"));
  check("counts reported", res.users === 4 && res.captured === 3, `users=${res.users} captured=${res.captured}`);
  check("taken_on is today", db.writes.every((w: any) => w.taken_on === TODAY));
}

/* ─── 2. Multiple snapshots per user → newest wins ─── */
console.log("\n── newest snapshot wins ──");
{
  const db = stubDb([
    { user_id: "u", taken_on: daysAgo(900) },
    { user_id: "u", taken_on: daysAgo(30) },  // newest — not due
    { user_id: "u", taken_on: daysAgo(500) },
  ]);
  await captureDueFrontierSnapshots(db, TODAY, [h("u", "AAPL", 10)], QUOTES);
  check("out-of-order history uses the newest date", db.writes.length === 0, `${db.writes.length} writes`);
}

/* ─── 3. Weights ─── */
console.log("\n── weights ──");
{
  const db = stubDb([]);
  await captureDueFrontierSnapshots(
    db, TODAY,
    [h("u", "AAPL", 30), h("u", "MSFT", 10), h("u", "NVDA", 30)], // 3000 / 1000 / 6000
    QUOTES,
  );
  const w = db.writes[0].weights as Record<string, number>;
  const sum = Object.values(w).reduce((s, x) => s + x, 0);
  check("weights sum to 100", Math.abs(sum - 100) < 1e-9, sum.toFixed(6));
  check("AAPL is 30%", Math.abs(w.AAPL - 30) < 1e-9, String(w.AAPL));
  check("NVDA is 60%", Math.abs(w.NVDA - 60) < 1e-9, String(w.NVDA));
  check("total_value is the sleeve value", db.writes[0].total_value === 10000, String(db.writes[0].total_value));
}

/* ─── 4. Non-priceable instruments excluded ─── */
console.log("\n── priceable filter ──");
{
  check("option excluded", !isPriceable({ instrument_type: "option", bond_type: null }));
  check("future excluded", !isPriceable({ instrument_type: "future", bond_type: null }));
  check("non-ETF bond excluded", !isPriceable({ instrument_type: "bond", bond_type: "corporate" }));
  check("bond ETF included", isPriceable({ instrument_type: "bond", bond_type: "etf" }));
  check("null type treated as equity", isPriceable({ instrument_type: null, bond_type: null }));

  const db = stubDb([]);
  await captureDueFrontierSnapshots(db, TODAY, [
    h("u", "AAPL", 10),
    h("u", "SPY", 1, { instrument_type: "option" }),
    h("u", "CL", 1, { instrument_type: "future" }),
  ], QUOTES);
  check("derivatives never reach the snapshot", Object.keys(db.writes[0].weights).join() === "AAPL", Object.keys(db.writes[0].weights).join());
}

/* ─── 5. Degradation ─── */
console.log("\n── degradation ──");
{
  const missing = await captureDueFrontierSnapshots(stubDb([], "relation does not exist"), TODAY, [h("u", "AAPL", 10)], QUOTES);
  check("missing table degrades, no throw", missing.captured === 0 && !!missing.skipped);
  check("names the migration", (missing.skipped ?? "").includes("portfolio-frontier-snapshots.sql"));

  const db = stubDb([]);
  const none = await captureDueFrontierSnapshots(db, TODAY, [], QUOTES);
  check("no holdings → nothing written", none.captured === 0 && db.writes.length === 0);

  const zeroDb = stubDb([]);
  await captureDueFrontierSnapshots(zeroDb, TODAY, [h("u", "AAPL", 0)], QUOTES);
  check("zero-value sleeve skipped", zeroDb.writes.length === 0);

  // A quote gap must fall back to cost, not produce a zero/NaN weight.
  const noQuote = weightsFromHoldings([h("u", "XYZ", 10)], {});
  check("missing quote falls back to cost basis", Math.abs(noQuote.riskyValue - 1000) < 1e-9, String(noQuote.riskyValue));
}

/* ─── 6. Leg cap ─── */
console.log("\n── leg cap ──");
{
  const many = Array.from({ length: 75 }, (_, i) => h("u", `T${i}`, i + 1));
  const q = Object.fromEntries(many.map((m) => [m.ticker, { price: 10 }]));
  const db = stubDb([]);
  await captureDueFrontierSnapshots(db, TODAY, many, q);
  const w = db.writes[0].weights as Record<string, number>;
  check("capped at 60 legs", Object.keys(w).length === 60, String(Object.keys(w).length));
  check("keeps the largest positions", "T74" in w && !("T0" in w));
}

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`}`);
