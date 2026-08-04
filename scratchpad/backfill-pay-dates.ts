/* One-time backfill of `applied_corporate_actions.pay_date` (2026-08-03).
 *
 * Yahoo quoteSummary publishes ex + pay only for the CURRENTLY declared
 * dividend per ticker, so this can only fix rows whose ex-date matches what
 * Yahoo is advertising right now — in practice the "just went ex, not yet
 * paid" rows, which are exactly the ones being mis-counted as income (TXN:
 * ex 2026-07-31, pays 2026-08-11). Older history and every ETF stay NULL and
 * render as Pending; no free source has those dates.
 *
 * Run supabase/dividend-pay-date.sql FIRST.
 *
 *   npx tsx scratchpad/backfill-pay-dates.ts          # dry run, prints a plan
 *   npx tsx scratchpad/backfill-pay-dates.ts --write  # apply
 *
 * Reads SUPABASE_URL + SERVICE_ROLE from .env.local and writes across all
 * users, so it is deliberately NOT wired to a route. Idempotent: only touches
 * rows where pay_date IS NULL, so re-running is safe.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { yahooNextDividend } from "../lib/yahoo";

const WRITE = process.argv.includes("--write");

function envFromFile(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

async function main() {
  const env = envFromFile();
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await db
    .from("applied_corporate_actions")
    .select("holding_id, effective_date, ticker, pay_date, action_type")
    .eq("action_type", "dividend")
    .is("pay_date", null);
  if (error) throw new Error(error.message);

  const rows = (data ?? []).filter((r) => r.ticker);
  const tickers = [...new Set(rows.map((r) => String(r.ticker).toUpperCase()))].sort();
  console.log(`${rows.length} dividend row(s) with no pay date, across ${tickers.length} ticker(s).`);
  console.log(WRITE ? "MODE: WRITE\n" : "MODE: DRY RUN (pass --write to apply)\n");

  let matched = 0;
  let unmatched = 0;

  for (const t of tickers) {
    const next = await yahooNextDividend(t).catch(() => null);
    const mine = rows.filter((r) => String(r.ticker).toUpperCase() === t);
    if (!next) {
      unmatched += mine.length;
      console.log(`  ${t.padEnd(6)} no forward dividend from Yahoo (ETF or none declared) → ${mine.length} row(s) stay Pending`);
      continue;
    }
    if (!next.payDate) {
      unmatched += mine.length;
      console.log(`  ${t.padEnd(6)} ex ${next.exDate} declared but no pay date yet → ${mine.length} row(s) stay Pending`);
      continue;
    }
    // Only the row whose ex-date IS the currently-declared one can be trusted.
    const hits = mine.filter((r) => r.effective_date === next.exDate);
    if (hits.length === 0) {
      unmatched += mine.length;
      console.log(`  ${t.padEnd(6)} Yahoo has ex ${next.exDate}; no stored row matches → ${mine.length} row(s) stay Pending`);
      continue;
    }
    console.log(`  ${t.padEnd(6)} ex ${next.exDate} → pays ${next.payDate}  (${hits.length} row(s))`);
    matched += hits.length;
    if (WRITE) {
      const { error: updErr } = await db
        .from("applied_corporate_actions")
        .update({ pay_date: next.payDate })
        .eq("action_type", "dividend")
        .eq("effective_date", next.exDate)
        .is("pay_date", null)
        .ilike("ticker", t);
      if (updErr) console.log(`         !! update failed: ${updErr.message}`);
    }
    unmatched += mine.length - hits.length;
  }

  console.log(`\n${matched} row(s) ${WRITE ? "updated" : "would be updated"}; ${unmatched} left Pending (no data available).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
