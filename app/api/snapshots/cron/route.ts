import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchQuotes } from "@/lib/finnhub";
import { isMarketDay } from "@/lib/market-calendar";
import { applyCorporateActionsWindow } from "@/lib/corporate-actions";
import { generateMonthlyReports } from "@/lib/monthly-reports";
import { computeBondMarks, type BondRow } from "@/lib/bond-marks";

/**
 * Scheduled trigger: captures a daily portfolio_snapshots row for every user
 * that owns holdings, regardless of whether anyone is logged in. Mirrors the
 * math in /api/snapshots POST (holdings × live quotes, bucketed per account,
 * idempotent per (user, day, account)). Secured by CRON_SECRET.
 */
function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return request.headers.get("x-cron-secret") === secret;
}

interface HoldingRow {
  id: string;
  user_id: string;
  ticker: string;
  shares: number;
  cost_basis: number;
  account: string | null;
  instrument_type: string | null;
  bond_type: string | null;
  coupon_rate: number | null;
  coupon_freq: number | null;
  maturity_date: string | null;
  day_count: string | null;
  price_source: string | null;
  manual_price: number | null;
  credit_spread_bps: number | null;
}

async function run() {
  // US market day in Eastern time — skip weekends/holidays so the chart only
  // gains a point on real trading days (no flat weekend duplicates).
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
  if (!isMarketDay(today)) {
    return { skipped: true, reason: "Market closed", date: today };
  }

  const db = createAdminClient();

  // Apply any splits/consolidations/dividends effective recently FIRST, so the
  // snapshot below reflects post-action shares + cash. We re-scan the last week
  // of trading days, not just today, because Yahoo posts ETF ex-dividends a day
  // or two late — a same-day-only check drops them for good. The ledger keeps
  // this idempotent. Never abort the snapshot run if this fails.
  let corporateActions = null;
  try {
    corporateActions = await applyCorporateActionsWindow(db, today, 7);
  } catch {
    corporateActions = { error: "corporate actions failed" };
  }

  // Pull every holding + cash balance in one shot each, then group per user.
  // RLS is bypassed by the service-role client.
  const [{ data: holdings, error }, { data: cashRows }] = await Promise.all([
    // select("*") so a pre-migration deploy (bonds.sql not yet run) still
    // captures snapshots — missing bond columns just read as undefined (equity),
    // rather than PostgREST 400-ing and dropping the daily point for every user.
    db.from("holdings").select("*"),
    db.from("cash_balances").select("user_id,account,balance"),
  ]);
  if (error) throw new Error(error.message);
  const rows = (holdings ?? []) as HoldingRow[];
  const cash = (cashRows ?? []) as { user_id: string; account: string | null; balance: number }[];
  if (rows.length === 0 && cash.length === 0) {
    // Nothing to snapshot — but a fully-liquidated user may still be owed last
    // month's cash-flow/tax reports (the generator reads the event tables too).
    let monthlyReports = null;
    try {
      monthlyReports = await generateMonthlyReports(db, today, {});
    } catch {
      monthlyReports = { error: "monthly reports failed" };
    }
    return { users: 0, captured: 0, corporateActions, monthlyReports };
  }

  // One Finnhub call per unique ticker across all users (fetchQuotes caches
  // per-process for 60s anyway). Non-ETF bonds have no exchange ticker — they
  // price from the Treasury curve / par / cost via computeBondMarks instead.
  const allTickers = [
    ...new Set(
      rows
        .filter((h) => h.instrument_type !== "bond" || h.bond_type === "etf")
        .map((h) => h.ticker.toUpperCase()),
    ),
  ];
  const quotes = allTickers.length ? await fetchQuotes(allTickers) : {};

  // Clean-price marks for every non-ETF bond across all users (ids are unique).
  const bondRows = rows.filter((h) => h.instrument_type === "bond" && h.bond_type !== "etf");
  const bondMarks = bondRows.length ? await computeBondMarks(bondRows as unknown as BondRow[]) : {};

  // Group securities value and cost basis by user → account.
  const byUser = new Map<string, Map<string, number>>();
  const costByUser = new Map<string, Map<string, number>>();
  const pricedByUser = new Map<string, number>();
  for (const h of rows) {
    const isNonEtfBond = h.instrument_type === "bond" && h.bond_type !== "etf";
    const mark = isNonEtfBond ? bondMarks[h.id] : undefined;
    const q = quotes[h.ticker.toUpperCase()];
    const price = mark ? mark.currentPrice : q?.price ?? Number(h.cost_basis);
    const acct = (h.account ?? "").trim() || "Unassigned";
    
    const userMap = byUser.get(h.user_id) ?? new Map<string, number>();
    userMap.set(acct, (userMap.get(acct) ?? 0) + Number(h.shares) * price);
    byUser.set(h.user_id, userMap);

    const costMap = costByUser.get(h.user_id) ?? new Map<string, number>();
    costMap.set(acct, (costMap.get(acct) ?? 0) + Number(h.shares) * Number(h.cost_basis));
    costByUser.set(h.user_id, costMap);

    // Count anything we could actually price so a bond-only user isn't skipped.
    if (q || mark) pricedByUser.set(h.user_id, (pricedByUser.get(h.user_id) ?? 0) + 1);
  }

  // Group cash by user → account.
  const cashByUser = new Map<string, Map<string, number>>();
  for (const c of cash) {
    const acct = (c.account ?? "").trim() || "Unassigned";
    const m = cashByUser.get(c.user_id) ?? new Map<string, number>();
    m.set(acct, (m.get(acct) ?? 0) + Number(c.balance));
    cashByUser.set(c.user_id, m);
  }

  let users = 0;
  let captured = 0;
  const allUsers = new Set<string>([...byUser.keys(), ...cashByUser.keys()]);
  for (const user_id of allUsers) {
    const accountMap = byUser.get(user_id) ?? new Map<string, number>();
    const userCash = cashByUser.get(user_id) ?? new Map<string, number>();
    const userCost = costByUser.get(user_id) ?? new Map<string, number>();
 
    // Skip the user if they have holdings but NO live prices came back — avoids
    // a junk point. Cash-only users (no holdings) still capture.
    const hasHoldings = accountMap.size > 0;
    if (hasHoldings && (pricedByUser.get(user_id) ?? 0) === 0) continue;
 
    const accounts = new Set<string>([...accountMap.keys(), ...userCash.keys()]);
    const rowsToWrite = [...accounts].map((account) => ({
      user_id,
      snapshot_date: today,
      total_value: accountMap.get(account) ?? 0,
      cash: userCash.get(account) ?? 0,
      cost_basis: userCost.get(account) ?? 0,
      account,
    }));

    const { error: upErr } = await db
      .from("portfolio_snapshots")
      .upsert(rowsToWrite, { onConflict: "user_id,snapshot_date,account" });
    if (upErr) continue; // skip a failing user, don't abort the run

    users += 1;
    captured += rowsToWrite.length;
  }

  // Generate the just-closed month's per-account reports AFTER snapshots, so
  // they read the freshest rows. "Missing" is checked in the DB (the 1st is
  // often a weekend/holiday this cron skips); rides this cron to stay under
  // the Hobby cron limit. Never abort the snapshot run if it fails.
  let monthlyReports = null;
  try {
    monthlyReports = await generateMonthlyReports(db, today, quotes);
  } catch {
    monthlyReports = { error: "monthly reports failed" };
  }

  return { users, captured, date: today, corporateActions, monthlyReports };
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, ...(await run()) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// Vercel Cron uses GET; POST kept for manual triggering.
export const POST = GET;
