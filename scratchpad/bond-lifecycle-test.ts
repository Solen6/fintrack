/* Verifies the bond lifecycle end to end:
     · lib/bond-coupons.ts — schedule generation, coupon sizing, entitlement
     · lib/bond-math.ts    — the maturity-anchored schedule + past-maturity guard
     · lib/bond-lifecycle.ts — the applier, against an in-memory Supabase stub
       (coupon → cash + INTEREST ledger, redemption ordering, idempotency,
       the created_at floor that stops a back-dated bond dumping years of
       coupons, and the realized gain a par redemption books)
   Run: npx tsx scratchpad/bond-lifecycle-test.ts */
import {
  couponAmount,
  couponDatesBetween,
  couponsDue,
  isMatured,
  redemptionProceeds,
  REDEMPTION_PRICE,
  type CouponBond,
} from "../lib/bond-coupons";
import { bondAnalytics, couponSchedule, priceAtYield } from "../lib/bond-math";
import { applyBondLifecycle } from "../lib/bond-lifecycle";
import { buildIncomeRows, type CouponSource, type DividendRecord } from "../lib/income-rows";
import type { SupabaseClient } from "@supabase/supabase-js";

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown, tol = 1e-9) {
  const ok =
    typeof got === "number" && typeof want === "number"
      ? Math.abs(got - want) <= tol
      : JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`,
  );
}

const bond = (p: Partial<CouponBond> = {}): CouponBond => ({
  faceValue: p.faceValue ?? 10_000,
  couponRate: p.couponRate ?? 4.25,
  couponFreq: p.couponFreq ?? 2,
  maturityDate: p.maturityDate ?? "2030-08-15",
});

console.log("\n── A. Coupon sizing ──────────────────────────────────────────");

// $10,000 face at 4.25% semiannual = $425/yr, $212.50 per payment.
check("semiannual coupon", couponAmount(bond()), 212.5);
check("annual coupon", couponAmount(bond({ couponFreq: 1 })), 425);
check("quarterly coupon", couponAmount(bond({ couponFreq: 4 })), 106.25);
check("monthly coupon", couponAmount(bond({ couponFreq: 12 })), 425 / 12);
// A zero-coupon bond pays nothing until redemption — no $0 ledger rows.
check("zero-coupon pays nothing", couponAmount(bond({ couponRate: 0 })), 0);
check("negative rate is not a coupon", couponAmount(bond({ couponRate: -1 })), 0);
check("freq 0 pays nothing", couponAmount(bond({ couponFreq: 0 })), 0);
check("zero face pays nothing", couponAmount(bond({ faceValue: 0 })), 0);

console.log("\n── B. Schedule generation ────────────────────────────────────");

check(
  "semiannual dates land on the maturity day-of-month",
  couponDatesBetween(bond(), "2029-01-01", "2030-08-15"),
  ["2029-02-15", "2029-08-15", "2030-02-15", "2030-08-15"],
);
check(
  "final coupon lands exactly on maturity",
  couponDatesBetween(bond(), "2030-08-15", "2030-08-15"),
  ["2030-08-15"],
);
check(
  "quarterly steps three months",
  couponDatesBetween(bond({ couponFreq: 4 }), "2030-01-01", "2030-08-15"),
  ["2030-02-15", "2030-05-15", "2030-08-15"],
);
check("window before any coupon is empty", couponDatesBetween(bond(), "2029-03-01", "2029-08-14"), []);
check("inverted window is empty", couponDatesBetween(bond(), "2030-01-01", "2029-01-01"), []);

/* THE DRIFT CASE. Stepping back one period at a time from an Aug-31 maturity
   clamps to Feb-28 and then carries the 28th backwards forever, silently
   moving every earlier coupon three days early. Anchoring each date on the
   maturity re-derives the 31st. */
check(
  "Aug-31 maturity does not drift onto the 28th",
  couponDatesBetween(bond({ maturityDate: "2030-08-31" }), "2029-01-01", "2030-08-31"),
  ["2029-02-28", "2029-08-31", "2030-02-28", "2030-08-31"],
);
check(
  "leap year keeps Feb 29",
  couponDatesBetween(bond({ maturityDate: "2032-08-31" }), "2032-01-01", "2032-08-31"),
  ["2032-02-29", "2032-08-31"],
);
// bond-math's forward-looking generator is the same shape and must agree.
check(
  "bond-math couponSchedule agrees, anchored",
  couponSchedule(new Date(Date.UTC(2030, 7, 31)), 2, new Date(Date.UTC(2029, 0, 1))).map((d) =>
    d.toISOString().slice(0, 10),
  ),
  ["2029-02-28", "2029-08-31", "2030-02-28", "2030-08-31"],
);

console.log("\n── C. Entitlement ────────────────────────────────────────────");

const winOpts = { from: "2029-01-01", to: "2029-08-15" };
check(
  "owned well before → both coupons",
  couponsDue(bond(), { ...winOpts, acquiredDate: "2028-01-01" }).map((c) => c.date),
  ["2029-02-15", "2029-08-15"],
);
check(
  "acquired between → only the later coupon",
  couponsDue(bond(), { ...winOpts, acquiredDate: "2029-03-01" }).map((c) => c.date),
  ["2029-08-15"],
);
// Buying ON the payment date does not earn it — the seller does, via the
// accrued interest the buyer pays at settlement. Same strictness as the
// dividend ex-date rule.
check(
  "acquired ON the payment date earns nothing",
  couponsDue(bond(), { from: "2029-08-15", to: "2029-08-15", acquiredDate: "2029-08-15" }).map((c) => c.date),
  [],
);
check(
  "acquired the day before earns it",
  couponsDue(bond(), { from: "2029-08-15", to: "2029-08-15", acquiredDate: "2029-08-14" }).map((c) => c.date),
  ["2029-08-15"],
);
check(
  "unknown acquisition is entitled (predates the app)",
  couponsDue(bond(), { ...winOpts, acquiredDate: null }).map((c) => c.date),
  ["2029-02-15", "2029-08-15"],
);
check(
  "zero-coupon bond yields no payments",
  couponsDue(bond({ couponRate: 0 }), { ...winOpts, acquiredDate: null }).length,
  0,
);
check("coupon carries its amount", couponsDue(bond(), winOpts)[0].amount, 212.5);

console.log("\n── D. Maturity ───────────────────────────────────────────────");

check("matured on the day", isMatured("2026-08-10", "2026-08-10"), true);
check("matured after", isMatured("2026-08-09", "2026-08-10"), true);
check("not matured before", isMatured("2026-08-11", "2026-08-10"), false);
check("no maturity date is never matured", isMatured(null, "2026-08-10"), false);
check("par redemption returns face", redemptionProceeds(10_000), 10_000);
check("redemption books at par", REDEMPTION_PRICE, 1);

/* Past maturity there are no cash flows left, so every yield-derived figure is
   undefined rather than small. The old code returned par + a phantom final
   coupon as `accrued`, and yieldToMaturity — bisecting against a price that is
   constant in yield — matched on its first probe and returned the midpoint of
   its own search bracket (≈49.75%) as if it were a real yield. */
const maturedSpec = { faceValue: 10_000, couponRate: 4.25, couponFreq: 2, maturityDate: "2026-08-01" };
const maturedAnalytics = bondAnalytics(maturedSpec, 100, new Date("2026-08-10T00:00:00Z"));
check("matured: ytm is not a bisection artifact", maturedAnalytics.ytm, 0);
check("matured: no phantom accrued", maturedAnalytics.accrued, 0);
check("matured: clean is par", maturedAnalytics.cleanPrice, 100);
check("matured: no duration", maturedAnalytics.modifiedDuration, 0);
check("matured: no next coupon", maturedAnalytics.nextCouponDate, null);
check("matured: prices at par", priceAtYield(maturedSpec, 4, new Date("2026-08-10T00:00:00Z")), 100);

// A live bond must still price normally — the guard is narrow.
const liveSpec = { faceValue: 10_000, couponRate: 4.25, couponFreq: 2, maturityDate: "2030-08-15" };
const liveAnalytics = bondAnalytics(liveSpec, 97, new Date("2026-08-10T00:00:00Z"));
check("live bond below par yields above its coupon", liveAnalytics.ytm > 4.25, true);
check("live bond has positive duration", liveAnalytics.modifiedDuration > 0, true);
// Asked on Aug 10, the next payment on an Aug-15/Feb-15 cycle is five days out.
check("live bond has a next coupon", liveAnalytics.nextCouponDate, "2026-08-15");

console.log("\n── F. Income-tab merge (lib/income-rows.ts) ─────────────────");

const TODAY = "2026-08-10";
const HORIZON = "2027-08-10";

const src: CouponSource = {
  id: "b1", ticker: "912828YZ1", name: "US Treasury 4.25% 2030", account: "Brokerage",
  shares: 10_000, couponRate: 4.25, couponFreq: 2, maturityDate: "2030-08-15",
};

const rec = (p: Partial<DividendRecord>): DividendRecord => ({
  id: p.id ?? "r1", holdingId: p.holdingId ?? "b1", kind: p.kind ?? "dividend",
  date: p.date ?? "2026-08-01", ticker: p.ticker ?? "AAPL", name: p.name ?? null,
  amount: p.amount ?? 10, reinvested: p.reinvested ?? false, detail: null,
  sharesDelta: 0, cashDelta: p.amount ?? 10, account: p.account ?? "Brokerage",
  isManual: false, paid: p.paid, payDate: p.payDate, exDate: p.exDate,
});

// F1. Projection alone: the next payments a year out, all flagged upcoming.
{
  const out = buildIncomeRows({ dividends: [], bonds: [src], today: TODAY, horizon: HORIZON });
  check("F1 projects the coming year", out.rows.map((r) => r.date), ["2027-02-15", "2026-08-15"]);
  check("F1 all upcoming", out.rows.every((r) => r.upcoming === true), true);
  check("F1 upcoming is not income", out.couponReceived, 0);
  check("F1 amount is the real coupon", out.rows[0].amount, 212.5);
}

/* F2. THE INVARIANT. The sweep records the Aug-15 coupon; the projection would
   generate that same date. It must appear ONCE, as paid — not twice, and not
   as a pending estimate sitting next to the cash that already landed. */
{
  const paidCoupon = rec({ id: "c1", kind: "coupon", holdingId: "b1", date: "2026-08-15",
    ticker: "912828YZ1", amount: 212.5, payDate: "2026-08-15", paid: true });
  const out = buildIncomeRows({ dividends: [paidCoupon], bonds: [src], today: "2026-08-15", horizon: "2027-08-15" });
  const aug = out.rows.filter((r) => r.date === "2026-08-15");
  check("F2 the swept coupon appears exactly once", aug.length, 1);
  check("F2 and it is recorded, not projected", aug[0].upcoming, false);
  check("F2 counted as received", out.couponReceived, 212.5);
  check("F2 the later projection survives", out.rows.some((r) => r.date === "2027-02-15" && r.upcoming), true);
}

// F3. A late sweep: the coupon is recorded days after its date. The projection
//     never covered it (it is in the past), so it still shows up exactly once.
{
  const late = rec({ id: "c2", kind: "coupon", holdingId: "b1", date: "2026-08-01",
    ticker: "912828YZ1", amount: 212.5, payDate: "2026-08-01", paid: true });
  const out = buildIncomeRows({ dividends: [late], bonds: [src], today: TODAY, horizon: HORIZON });
  check("F3 back-dated coupon appears once", out.rows.filter((r) => r.date === "2026-08-01").length, 1);
  check("F3 counted as received", out.couponReceived, 212.5);
}

// F4. Coupons and dividends never contaminate each other's totals.
{
  const div = rec({ id: "d1", kind: "dividend", ticker: "AAPL", amount: 40, paid: true, payDate: "2026-08-05" });
  const pendingDiv = rec({ id: "d2", kind: "dividend", ticker: "SPY", amount: 90.5, paid: false, payDate: null });
  const coupon = rec({ id: "c3", kind: "coupon", holdingId: "b1", date: "2026-08-01", ticker: "912828YZ1", amount: 212.5, paid: true });
  const out = buildIncomeRows({ dividends: [div, pendingDiv, coupon], bonds: [src], today: TODAY, horizon: HORIZON });
  check("F4 dividends total excludes coupons", out.divTotal, 40);
  check("F4 pending total excludes coupons", out.divPending, 90.5);
  check("F4 pending count", out.pendingCount, 1);
  check("F4 coupons total excludes dividends", out.couponReceived, 212.5);
}

// F5. Newest first, across all three sources.
{
  const div = rec({ id: "d1", kind: "dividend", date: "2026-07-01", ticker: "AAPL", amount: 40, paid: true });
  const coupon = rec({ id: "c4", kind: "coupon", holdingId: "b1", date: "2026-08-01", ticker: "912828YZ1", amount: 212.5, paid: true });
  const out = buildIncomeRows({ dividends: [div, coupon], bonds: [src], today: TODAY, horizon: HORIZON });
  check("F5 sorted newest first", out.rows.map((r) => r.date), ["2027-02-15", "2026-08-15", "2026-08-01", "2026-07-01"]);
}

// F6. A redeemed bond is gone from `bonds`, so nothing is projected past it —
//     but its recorded coupons remain in the history.
{
  const coupon = rec({ id: "c5", kind: "coupon", holdingId: "b1", date: "2026-08-01", ticker: "912828YZ1", amount: 212.5, paid: true });
  const out = buildIncomeRows({ dividends: [coupon], bonds: [], today: TODAY, horizon: HORIZON });
  check("F6 history survives redemption", out.rows.length, 1);
  check("F6 nothing projected for a gone bond", out.rows.every((r) => !r.upcoming), true);
}

// F7. A zero-coupon bond projects nothing at all.
{
  const zero: CouponSource = { ...src, id: "b9", couponRate: 0 };
  const out = buildIncomeRows({ dividends: [], bonds: [zero], today: TODAY, horizon: HORIZON });
  check("F7 zero-coupon projects nothing", out.rows.length, 0);
}

console.log("\n── E. The applier, against a stub DB ─────────────────────────");

/* Minimal in-memory stand-in for the PostgREST client, supporting exactly the
   call shapes lib/bond-lifecycle.ts uses. It also enforces the two uniqueness
   rules that make the sweep idempotent for real:
     · applied_corporate_actions (holding_id, action_type, effective_date) where is_manual = false
     · transactions (user_id, dedupe_hash) */
type Row = Record<string, unknown>;
interface Db {
  holdings: Row[];
  applied_corporate_actions: Row[];
  transactions: Row[];
  closed_positions: Row[];
  cash_balances: Row[];
}

function makeDb(holdings: Row[], cash: Row[] = []): { db: SupabaseClient; store: Db } {
  const store: Db = {
    holdings: holdings.map((h) => ({ ...h })),
    applied_corporate_actions: [],
    transactions: [],
    closed_positions: [],
    cash_balances: cash.map((c) => ({ ...c })),
  };

  function builder(table: keyof Db) {
    const filters: Array<(r: Row) => boolean> = [];
    let mode: "select" | "delete" = "select";
    const api = {
      select() { mode = "select"; return api; },
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return api; },
      in(col: string, vals: unknown[]) { filters.push((r) => vals.includes(r[col])); return api; },
      delete() { mode = "delete"; return api; },
      maybeSingle() {
        const hit = store[table].filter((r) => filters.every((f) => f(r)))[0] ?? null;
        return Promise.resolve({ data: hit, error: null });
      },
      insert(payload: Row) {
        if (table === "applied_corporate_actions") {
          const dup = store.applied_corporate_actions.some(
            (r) =>
              r.is_manual === false &&
              r.holding_id === payload.holding_id &&
              r.action_type === payload.action_type &&
              r.effective_date === payload.effective_date,
          );
          if (dup) return Promise.resolve({ error: { message: "duplicate key value violates unique constraint" } });
        }
        if (table === "transactions") {
          const dup = store.transactions.some(
            (r) => r.user_id === payload.user_id && r.dedupe_hash === payload.dedupe_hash,
          );
          if (dup) return Promise.resolve({ error: { message: "duplicate key value violates unique constraint" } });
        }
        store[table].push({ ...payload });
        return Promise.resolve({ error: null });
      },
      upsert(payload: Row) {
        const i = store.cash_balances.findIndex(
          (r) => r.user_id === payload.user_id && r.account === payload.account,
        );
        if (i >= 0) store.cash_balances[i] = { ...store.cash_balances[i], ...payload };
        else store.cash_balances.push({ ...payload });
        return Promise.resolve({ error: null });
      },
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        const matched = store[table].filter((r) => filters.every((f) => f(r)));
        if (mode === "delete") {
          store[table] = store[table].filter((r) => !filters.every((f) => f(r)));
          return Promise.resolve(resolve({ data: [], error: null }));
        }
        return Promise.resolve(resolve({ data: matched, error: null }));
      },
    };
    return api;
  }

  return { db: { from: (t: string) => builder(t as keyof Db) } as unknown as SupabaseClient, store };
}

/* The applier is async, and tsx transpiles this file to CJS (the project has no
   "type": "module"), where top-level await is unavailable — so the DB-backed
   cases live in a main() rather than running inline like the pure ones above. */
const BOND_ROW = {
  id: "b1",
  user_id: "u1",
  ticker: "912828YZ1",
  name: "US Treasury 4.25% 2030",
  shares: 10_000, // face value
  cost_basis: 0.97, // clean price / 100
  account: "Brokerage",
  notes: null,
  instrument_type: "bond",
  bond_type: "treasury",
  coupon_rate: 4.25,
  coupon_freq: 2,
  maturity_date: "2030-08-15",
  acquired_at: "2026-01-05T14:30:00.000Z",
  created_at: "2026-01-05T14:30:00.000Z",
};

/* Same bond, but only tracked since Aug 1 — so a sweep on Aug 15 sees exactly
   ONE coupon due. BOND_ROW has been tracked since January, which puts both the
   Feb-15 and Aug-15 payments in range; that's correct catch-up behaviour and
   E3 leans on it, but it makes a poor fixture for the single-payment cases. */
const RECENT_ROW = { ...BOND_ROW, created_at: "2026-08-01T12:00:00.000Z" };

async function main() {
  // 1. A coupon that has come due pays into cash exactly once.
  {
    const { db, store } = makeDb([RECENT_ROW], [{ user_id: "u1", account: "Brokerage", balance: 500, label: "Cash" }]);
    const s = await applyBondLifecycle(db, "2026-08-15");
    check("E1 one coupon paid", s.couponsPaid, 1);
    check("E1 coupon cash", s.couponCash, 212.5);
    check("E1 no redemption yet", s.redemptions, 0);
    check("E1 no errors", s.errors, 0);
    check("E1 cash credited", store.cash_balances[0].balance, 712.5);
    check("E1 ledger row written", store.applied_corporate_actions.length, 1);
    check("E1 ledger action_type", store.applied_corporate_actions[0].action_type, "coupon");
    check("E1 ledger dated on the payment date", store.applied_corporate_actions[0].effective_date, "2026-08-15");
    check("E1 pay_date set so income counts it", store.applied_corporate_actions[0].pay_date, "2026-08-15");
    check("E1 INTEREST row for the reports", store.transactions.length, 1);
    check("E1 INTEREST action", store.transactions[0].action, "INTEREST");
    check("E1 INTEREST amount", store.transactions[0].amount, 212.5);
    check("E1 holding survives", store.holdings.length, 1);

    // 2. Re-running the same date is a no-op — the ledger claim already exists.
    const again = await applyBondLifecycle(db, "2026-08-15");
    check("E2 re-run pays nothing", again.couponsPaid, 0);
    check("E2 cash unchanged", store.cash_balances[0].balance, 712.5);
    check("E2 no duplicate ledger row", store.applied_corporate_actions.length, 1);
    check("E2 no duplicate INTEREST row", store.transactions.length, 1);
    check("E2 re-run reports no error", again.errors, 0);
  }

  // 3. Catch-up: a cron outage spanning two payment dates pays both on the next
  //    run. This is why there is no fixed look-back window.
  {
    const { db, store } = makeDb([BOND_ROW]);
    const s = await applyBondLifecycle(db, "2027-03-01");
    check("E3 catch-up pays every missed coupon", s.couponsPaid, 3);
    check("E3 catch-up cash", s.couponCash, 637.5);
    check(
      "E3 every date recorded, in order",
      store.applied_corporate_actions.map((r) => r.effective_date),
      ["2026-02-15", "2026-08-15", "2027-02-15"],
    );
    check("E3 cash row created from nothing", store.cash_balances[0].balance, 637.5);
  }

  // 4. The created_at floor. A bond held since 2020 but only just added to the
  //    app must NOT retroactively pay four years of coupons — that cash is
  //    already baked into the balance the user entered.
  {
    const backdated = { ...BOND_ROW, acquired_at: "2020-02-01T00:00:00.000Z", created_at: "2026-08-10T12:00:00.000Z" };
    const { db } = makeDb([backdated]);
    const s = await applyBondLifecycle(db, "2026-08-15");
    check("E4 only coupons since tracking began", s.couponsPaid, 1);
    check("E4 no retroactive dump", s.couponCash, 212.5);
  }

  // 5. Entitlement inside the applier: bought after a coupon date in the window.
  {
    const late = { ...RECENT_ROW, acquired_at: "2026-08-15T14:30:00.000Z" };
    const { db } = makeDb([late]);
    const s = await applyBondLifecycle(db, "2026-08-15");
    check("E5 same-day buy earns nothing", s.couponsPaid, 0);
    check("E5 skip is counted, not silent", s.couponsSkipped, 1);
  }

  // 6. Maturity: the final coupon pays FIRST, then the bond redeems at par.
  //    Redeeming first would delete the holding out from under its own coupon.
  {
    const matures = { ...RECENT_ROW, maturity_date: "2026-08-15" };
    const { db, store } = makeDb([matures], [{ user_id: "u1", account: "Brokerage", balance: 0, label: "Cash" }]);
    const s = await applyBondLifecycle(db, "2026-08-15");
    check("E6 final coupon paid", s.couponsPaid, 1);
    check("E6 redeemed", s.redemptions, 1);
    check("E6 principal returned", s.redemptionCash, 10_000);
    check("E6 cash = coupon + face", store.cash_balances[0].balance, 10_212.5);
    check("E6 holding removed", store.holdings.length, 0);
    check("E6 closed position logged", store.closed_positions.length, 1);
    check("E6 booked at par", store.closed_positions[0].sale_price, 1);
    check("E6 face carried as shares", store.closed_positions[0].shares, 10_000);
    check("E6 cost basis preserved", store.closed_positions[0].cost_basis, 0.97);
    // realized_gain is a generated column: (sale_price − cost_basis) × shares.
    const g =
      ((store.closed_positions[0].sale_price as number) - (store.closed_positions[0].cost_basis as number)) *
      (store.closed_positions[0].shares as number);
    check("E6 realized gain on a bond bought at 97", g, 300);
    check(
      "E6 both ledger rows, coupon before redemption",
      store.applied_corporate_actions.map((r) => r.action_type),
      ["coupon", "redemption"],
    );
    check("E6 redemption is NOT an INTEREST row", store.transactions.length, 1);
  }

  // 7. A matured bond whose holding is already gone can't be redeemed twice.
  {
    const matures = { ...RECENT_ROW, maturity_date: "2026-08-15" };
    const { db, store } = makeDb([matures]);
    await applyBondLifecycle(db, "2026-08-15");
    const again = await applyBondLifecycle(db, "2026-08-16");
    check("E7 second sweep redeems nothing", again.redemptions, 0);
    check("E7 one closed position only", store.closed_positions.length, 1);
  }

  // 8. A zero-coupon bond redeems without ever writing a $0 coupon row.
  {
    const zero = { ...RECENT_ROW, coupon_rate: 0, maturity_date: "2026-08-15" };
    const { db, store } = makeDb([zero]);
    const s = await applyBondLifecycle(db, "2026-08-15");
    check("E8 no coupon rows", s.couponsPaid, 0);
    check("E8 still redeems", s.redemptions, 1);
    check("E8 ledger holds only the redemption", store.applied_corporate_actions.length, 1);
  }

  // 9. Rows the sweep must not touch.
  {
    const etf = { ...BOND_ROW, id: "b2", bond_type: "etf", ticker: "BND", maturity_date: null };
    const equity = { ...BOND_ROW, id: "b3", instrument_type: "equity", ticker: "AAPL" };
    const undated = { ...BOND_ROW, id: "b4", maturity_date: null };
    const { db, store } = makeDb([etf, equity, undated]);
    const s = await applyBondLifecycle(db, "2027-03-01");
    check("E9 nothing paid", s.couponsPaid, 0);
    check("E9 nothing redeemed", s.redemptions, 0);
    check("E9 no rows touched", store.holdings.length, 3);
    check("E9 no ledger writes", store.applied_corporate_actions.length, 0);
  }

  // 10. Two bonds in one account accumulate into a single cash upsert.
  {
    const b2 = { ...RECENT_ROW, id: "b2", ticker: "912828AB2", coupon_rate: 2, maturity_date: "2031-08-15" };
    const { db, store } = makeDb([RECENT_ROW, b2], [{ user_id: "u1", account: "Brokerage", balance: 100, label: "Cash" }]);
    const s = await applyBondLifecycle(db, "2026-08-15");
    check("E10 both coupons paid", s.couponsPaid, 2);
    check("E10 combined cash", s.couponCash, 212.5 + 100);
    check("E10 one cash row", store.cash_balances.length, 1);
    check("E10 balance folded once", store.cash_balances[0].balance, 412.5);
  }
}

main().then(() => {
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
});
