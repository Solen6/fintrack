/* Ex-date vs pay-date split (2026-08-03).
 *
 * The calendar used to place ONE "Dividend" event on a single anchor date —
 * `payDate >= from ? payDate : exDate` — so a dividend routinely showed up on
 * the ex-date and, worse, vanished entirely from a month whose window held the
 * ex-date but not the pay date. Now the pay date carries the "Dividend" event
 * and the ex-date carries its own "Ex-Dividend" event, each range-checked on
 * its own date.
 *
 * Run: npx tsx scratchpad/dividend-split-test.ts
 */
import { dividendEvents } from "../lib/calendar-events";
import type { NextDividend } from "../lib/yahoo";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const div = (exDate: string, payDate: string | null, amount: number | null = 0.25): NextDividend =>
  ({ exDate, payDate, amount }) as NextDividend;

console.log("\nDividend ex/pay split\n");

// ── 1. The headline fix: the Dividend event lands on the PAY date ──────────
{
  const ev = dividendEvents("AAPL", div("2026-08-07", "2026-08-14"), "2026-08-01", "2026-08-31", 100);
  const pay = ev.find((e) => e.category === "Dividend");
  const ex = ev.find((e) => e.category === "Ex-Dividend");
  check("emits both an Ex-Dividend and a Dividend event", ev.length === 2, `got ${ev.length}`);
  check("Dividend is dated on the PAY date", pay?.date === "2026-08-14", `got ${pay?.date}`);
  check("Ex-Dividend is dated on the EX date", ex?.date === "2026-08-07", `got ${ex?.date}`);
  check("$ estimate rides on the pay event", pay?.amount === 25, `got ${pay?.amount}`);
  check("$ estimate is NOT on the ex event", ex?.amount === undefined, `got ${ex?.amount}`);
}

// ── 2. The old anchor's real bug: ex in-window, pay out of window ──────────
//    Old behavior: payDate (Sep 9) >= from → anchor = Sep 9 > to → returned []
//    and the August ex-date disappeared from the August calendar entirely.
{
  const ev = dividendEvents("KO", div("2026-08-14", "2026-09-09"), "2026-08-01", "2026-08-31", 50);
  check("ex-in / pay-out: exactly one event", ev.length === 1, `got ${ev.length}`);
  check("ex-in / pay-out: it is the Ex-Dividend", ev[0]?.category === "Ex-Dividend", `got ${ev[0]?.category}`);
  check("ex-in / pay-out: dated on the ex-date", ev[0]?.date === "2026-08-14", `got ${ev[0]?.date}`);
  check("ex-in / pay-out: names the future pay date", ev[0]?.detail.includes("pays 2026-09-09"), ev[0]?.detail);
}

// ── 3. The mirror case: ex already passed, pay still ahead ─────────────────
//    (the LRCX case the old anchor comment described — must still work)
{
  const ev = dividendEvents("LRCX", div("2026-06-17", "2026-07-08"), "2026-07-01", "2026-07-31", 10);
  check("ex-out / pay-in: exactly one event", ev.length === 1, `got ${ev.length}`);
  check("ex-out / pay-in: it is the Dividend", ev[0]?.category === "Dividend", `got ${ev[0]?.category}`);
  check("ex-out / pay-in: dated on the pay date", ev[0]?.date === "2026-07-08", `got ${ev[0]?.date}`);
  check("ex-out / pay-in: still carries the estimate", ev[0]?.amount === 2.5, `got ${ev[0]?.amount}`);
}

// ── 4. No pay date announced yet → ex event only, and it SAYS so ───────────
{
  const ev = dividendEvents("SPY", div("2026-08-20", null), "2026-08-01", "2026-08-31", 30);
  check("no pay date: exactly one event", ev.length === 1, `got ${ev.length}`);
  check("no pay date: it is the Ex-Dividend", ev[0]?.category === "Ex-Dividend", `got ${ev[0]?.category}`);
  check("no pay date: says it isn't announced", ev[0]?.detail.includes("pay date not yet announced"), ev[0]?.detail);
  check(
    "no pay date: never guesses a Dividend event onto the ex-date",
    !ev.some((e) => e.category === "Dividend"),
  );
}

// ── 5. Both dates outside the window → nothing ────────────────────────────
{
  const ev = dividendEvents("MSFT", div("2026-05-14", "2026-06-11"), "2026-08-01", "2026-08-31", 100);
  check("both dates out of window: no events", ev.length === 0, `got ${ev.length}`);
}

// ── 6. Window boundaries are INCLUSIVE on both ends ───────────────────────
{
  const ev = dividendEvents("T", div("2026-08-01", "2026-08-31"), "2026-08-01", "2026-08-31", 1);
  check("ex on `from` and pay on `to` both included", ev.length === 2, `got ${ev.length}`);
}

// ── 7. Unknown per-share amount → no estimate, no NaN, event still emitted ─
{
  const ev = dividendEvents("XYZ", div("2026-08-07", "2026-08-14", null), "2026-08-01", "2026-08-31", 100);
  const pay = ev.find((e) => e.category === "Dividend");
  check("null amount: both events still emitted", ev.length === 2, `got ${ev.length}`);
  check("null amount: no $ estimate", pay?.amount === undefined, `got ${pay?.amount}`);
  check("null amount: no NaN in the detail line", !/NaN/.test(ev.map((e) => e.detail).join(" ")));
}

// ── 8. Zero shares (watchlist-ish row) → dates yes, estimate no ───────────
{
  const ev = dividendEvents("JNJ", div("2026-08-07", "2026-08-14"), "2026-08-01", "2026-08-31", 0);
  const pay = ev.find((e) => e.category === "Dividend");
  check("zero shares: still shows both dates", ev.length === 2, `got ${ev.length}`);
  check("zero shares: no $ estimate", pay?.amount === undefined, `got ${pay?.amount}`);
}

// ── 9. Every emitted event's `date` is inside the requested window ─────────
{
  const cases: [string, string | null][] = [
    ["2026-08-07", "2026-08-14"], ["2026-08-14", "2026-09-09"],
    ["2026-06-17", "2026-07-08"], ["2026-08-20", null],
  ];
  const bad = cases.flatMap(([ex, pay]) =>
    dividendEvents("X", div(ex, pay), "2026-08-01", "2026-08-31", 1)
      .filter((e) => e.date < "2026-08-01" || e.date > "2026-08-31"),
  );
  check("no event ever escapes [from, to]", bad.length === 0, JSON.stringify(bad));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
