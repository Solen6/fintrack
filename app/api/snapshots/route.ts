import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchQuotes } from "@/lib/finnhub";
import { isMarketDay } from "@/lib/market-calendar";
import { computeBondMarks, type BondRow } from "@/lib/bond-marks";

/* ─── GET: the user's snapshot history, oldest first ───
   Returns one row per (date, account). Legacy rows captured before per-account
   tracking have account === null and represent the combined total for that day;
   the dashboard treats them as a fallback when every account is enabled. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Snapshots (NAV history) + external cash flows (deposits/withdrawals) in
  // parallel. Flows let the dashboard compute a time-weighted return: a
  // rebalance moves no external cash, so it never shows up as a gain/loss,
  // and past returns depend only on stored NAV + stored flows — never on
  // current holdings — so they can't mutate when you trade today.
  const [snapRes, flowRes, seedRes] = await Promise.all([
    supabase
      .from("portfolio_snapshots")
      .select("snapshot_date,total_value,cash,cost_basis,account")
      .eq("user_id", user.id)
      .order("snapshot_date", { ascending: true }),
    // External cash flows only. Buys/sells/dividends are INTERNAL (they move
    // cash but not NAV, or are investment return) and are deliberately excluded.
    supabase
      .from("transactions")
      .select("trade_date,account,amount")
      .eq("user_id", user.id)
      .in("action", ["DEPOSIT", "WITHDRAWAL", "TRANSFER_IN", "TRANSFER_OUT", "TRANSFER"]),
    // Unit-method seeds: the fixed cost-basis anchor per account.
    supabase
      .from("portfolio_seed")
      .select("account,seed_cost_basis,base_price")
      .eq("user_id", user.id),
  ]);

  if (snapRes.error) return NextResponse.json({ error: snapRes.error.message }, { status: 500 });

  // flowRes may fail if the transactions ledger isn't deployed — degrade to no
  // flows (return is then plain NAV growth, still correct absent deposits).
  const flows = (flowRes.error ? [] : flowRes.data ?? []).map((f) => ({
    date: f.trade_date as string,
    account: (f.account as string | null) ?? null,
    amount: Number(f.amount ?? 0), // signed: deposits +, withdrawals −
  }));

  // seedRes may fail pre-migration — degrade to none (caller falls back to live
  // cost basis, so returns still work, just not yet rebalance-anchored).
  const seeds = (seedRes.error ? [] : seedRes.data ?? []).map((s) => ({
    account: s.account as string,
    seedCostBasis: Number(s.seed_cost_basis),
    basePrice: Number(s.base_price ?? 10),
  }));

  return NextResponse.json({
    snapshots: (snapRes.data ?? []).map((s) => ({
      date: s.snapshot_date as string,
      value: Number(s.total_value),
      cash: Number(s.cash ?? 0),
      costBasis: Number(s.cost_basis ?? 0),
      account: (s.account as string | null) ?? null,
    })),
    flows,
    seeds,
  });
}

/* Establish the unit-method seed once per account (fixed cost-basis anchor).
   ignoreDuplicates → set only the FIRST time we see an account; a later
   rebalance changes cost basis but must NOT move the anchor. Deliberately
   does NOT need live prices — cost basis (what you paid) and cash are both
   available without a quote — so it can run on a non-market day too; waiting
   for the next market-day snapshot left the anchor unset over a whole
   weekend, during which every render fell back to LIVE cash (see
   lib/portfolio-return.ts `earliestStoredCapital`), double-counting any
   deposit/withdrawal made in the meantime.

   Anchors to the EARLIEST EXISTING `portfolio_snapshots` row per account when
   one predates this call (this feature shipped weeks after snapshot history
   already existed for real accounts) — using TODAY's live cost basis + cash
   for an account with older history would seed from the wrong moment and
   silently fold every deposit/withdrawal/rebalance since inception into the
   "anchor". Only an account with no prior snapshot at all seeds from live
   values, because today IS its inception point.

   Seed = contributed capital = cost basis + cash, so cash you already hold is
   treated as capital (not gain). Future dividends still register as gain (they
   add cash with no new units), and deposits mint units (neutral). */
async function ensureSeeds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  costBasisByAccount: Map<string, number>,
  cashByAccount: Map<string, number>,
): Promise<{ attempted: number; error?: string }> {
  const accounts = [...new Set([...costBasisByAccount.keys(), ...cashByAccount.keys()])];
  if (accounts.length === 0) return { attempted: 0 };

  const { data: history } = await supabase
    .from("portfolio_snapshots")
    .select("account,snapshot_date,cash,cost_basis")
    .eq("user_id", userId)
    .order("snapshot_date", { ascending: true });
  // Prefer the earliest row with a real cost-basis figure (early snapshots
  // recorded only total_value before the cost_basis column existed, so a row
  // with cash but costBasis===0 is ambiguous — untracked securities, or a
  // genuinely cash-only account). Only fall back to the earliest cash-bearing
  // row for an account that has NO costBasis-bearing row at all (ever).
  const earliestWithCostBasis = new Map<string, { cash: number; costBasis: number }>();
  const earliestWithCash = new Map<string, { cash: number; costBasis: number }>();
  for (const row of history ?? []) {
    const acct = (row.account as string | null) ?? "";
    const cash = Number(row.cash ?? 0);
    const costBasis = Number(row.cost_basis ?? 0);
    if (costBasis > 0 && !earliestWithCostBasis.has(acct)) earliestWithCostBasis.set(acct, { cash, costBasis });
    if (cash > 0 && !earliestWithCash.has(acct)) earliestWithCash.set(acct, { cash, costBasis });
  }
  const earliestByAccount = new Map<string, { cash: number; costBasis: number }>();
  for (const acct of new Set([...earliestWithCostBasis.keys(), ...earliestWithCash.keys()])) {
    earliestByAccount.set(acct, earliestWithCostBasis.get(acct) ?? earliestWithCash.get(acct)!);
  }

  const seedRows = accounts
    .map((account) => {
      const earliest = earliestByAccount.get(account);
      const capital = earliest
        ? earliest.costBasis + earliest.cash
        : (costBasisByAccount.get(account) ?? 0) + (cashByAccount.get(account) ?? 0);
      return { account, capital };
    })
    .filter((r) => r.capital > 0)
    .map((r) => ({ user_id: userId, account: r.account, seed_cost_basis: r.capital, base_price: 10 }));
  if (seedRows.length === 0) return { attempted: 0 };
  const { error } = await supabase
    .from("portfolio_seed")
    .upsert(seedRows, { onConflict: "user_id,account", ignoreDuplicates: true });
  if (error) console.error("[snapshots] portfolio_seed upsert failed:", error.message);
  return { attempted: seedRows.length, error: error?.message };
}

/* ─── POST: capture today's portfolio value, one row per account (idempotent
   per day per account). Computes value server-side from real holdings × live
   quotes. Opening the app once a day is enough to build history. */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // US market day (Eastern). Skip weekends/holidays for the VALUE snapshot
  // (recording then would just duplicate the prior close and flat-line the
  // chart) — but the unit-method seed below doesn't need a market day, so it
  // still gets a chance to establish itself even when we bail out early.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
  const marketDay = isMarketDay(today);

  const [{ data: holdings, error: hErr }, { data: cashRows }] = await Promise.all([
    // select("*") so a pre-migration deploy still captures snapshots (missing
    // bond columns read as undefined = equity) instead of 400-ing.
    supabase
      .from("holdings")
      .select("*")
      .eq("user_id", user.id),
    supabase.from("cash_balances").select("account,balance").eq("user_id", user.id),
  ]);
  if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 });

  // Cash balance per account (a flat dollar amount, not priced).
  const cashByAccount = new Map<string, number>();
  for (const c of cashRows ?? []) {
    const acct = ((c.account as string | null) ?? "").trim() || "Unassigned";
    cashByAccount.set(acct, (cashByAccount.get(acct) ?? 0) + Number(c.balance));
  }

  if ((!holdings || holdings.length === 0) && cashByAccount.size === 0) {
    return NextResponse.json({ captured: false, reason: "No holdings." });
  }

  // Cost basis per account — no quote needed (it's what you paid, not what
  // it's worth now), so this and the seed it feeds can run regardless of
  // market day.
  const costBasisByAccount = new Map<string, number>();
  for (const h of holdings ?? []) {
    const acct = ((h.account as string | null) ?? "").trim() || "Unassigned";
    costBasisByAccount.set(acct, (costBasisByAccount.get(acct) ?? 0) + Number(h.shares) * Number(h.cost_basis));
  }
  const seedResult = await ensureSeeds(supabase, user.id, costBasisByAccount, cashByAccount);

  if (!marketDay) {
    return NextResponse.json({ captured: false, reason: "Market closed.", seeded: seedResult });
  }

  // Equities + bond ETFs price via quotes; non-ETF bonds via computeBondMarks.
  const tickers = [
    ...new Set(
      (holdings ?? [])
        .filter((h) => h.instrument_type !== "bond" || h.bond_type === "etf")
        .map((h) => h.ticker as string),
    ),
  ];
  const quotes = tickers.length ? await fetchQuotes(tickers) : {};

  const bondRows = (holdings ?? []).filter((h) => h.instrument_type === "bond" && h.bond_type !== "etf");
  const bondMarks = bondRows.length ? await computeBondMarks(bondRows as unknown as BondRow[]) : {};

  // Bucket securities value per account.
  const byAccount = new Map<string, number>();
  let pricedPositions = 0;
  for (const h of holdings ?? []) {
    const isNonEtfBond = h.instrument_type === "bond" && h.bond_type !== "etf";
    const mark = isNonEtfBond ? bondMarks[h.id as string] : undefined;
    const q = quotes[(h.ticker as string).toUpperCase()];
    const price = mark ? mark.currentPrice : q?.price ?? Number(h.cost_basis);
    if (q || mark) pricedPositions++;
    const acct = ((h.account as string | null) ?? "").trim() || "Unassigned";
    byAccount.set(acct, (byAccount.get(acct) ?? 0) + Number(h.shares) * price);
  }

  // Don't record a junk data point if we have holdings but live prices were
  // broadly unavailable. (Cash-only users skip this — nothing to price.)
  if ((holdings?.length ?? 0) > 0 && pricedPositions === 0) {
    return NextResponse.json({ captured: false, reason: "No live prices available." });
  }

  // One row per account that has holdings OR cash. total_value = securities
  // only; cash is stored separately so Return % stays a pure-securities figure.
  const accounts = new Set<string>([...byAccount.keys(), ...cashByAccount.keys()]);
  const rows = [...accounts].map((account) => ({
    user_id: user.id,
    snapshot_date: today,
    total_value: byAccount.get(account) ?? 0,
    cash: cashByAccount.get(account) ?? 0,
    cost_basis: costBasisByAccount.get(account) ?? 0,
    account,
  }));

  // Upsert per account. The unique index is (user_id, snapshot_date, coalesce(account,'')).
  const { error: upErr } = await supabase
    .from("portfolio_snapshots")
    .upsert(rows, { onConflict: "user_id,snapshot_date,account" });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const totalValue = rows.reduce((s, r) => s + r.total_value + r.cash, 0);
  return NextResponse.json({ captured: true, date: today, value: totalValue, accounts: rows.length });
}
