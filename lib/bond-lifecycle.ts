/**
 * Bond lifecycle engine: pay coupons, redeem matured bonds.
 *
 * The fixed-income sibling of lib/corporate-actions.ts, which deliberately
 * excludes bonds ("non-ETF bonds have no exchange ticker and accrue coupons —
 * not splits/dividends"). Until this existed, that exclusion had no other side:
 * a coupon was only ever a projection on the analytics and a matured bond sat
 * at par in the portfolio forever, so a Treasury's price tracked but its total
 * return was understated by every coupon it had ever paid.
 *
 * Runs as a pre-step of the daily snapshot cron, alongside the corporate-action
 * sweep, and standalone at /api/bonds/lifecycle/cron. Idempotent via the same
 * applied_corporate_actions ledger (action_type 'coupon' / 'redemption'), whose
 * partial unique index on (holding_id, action_type, effective_date) makes a
 * double-run a no-op.
 *
 * ── Why there is no look-back window variant ──────────────────────────────
 * applyCorporateActionsWindow re-scans 7 trading days because Yahoo publishes
 * an ETF's ex-dividend a day or two LATE — the event is only knowable from a
 * feed, so a same-day-only check drops it for good. A coupon has no feed: its
 * date and size are fully determined by the bond's own terms. So instead of
 * watching for coupons, this computes what is OWED and pays anything not yet
 * in the ledger. A cron outage of any length self-heals on the next run, which
 * a fixed window could not do.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  couponsDue,
  isMatured,
  redemptionProceeds,
  REDEMPTION_PRICE,
  type CouponBond,
} from "./bond-coupons";

export interface BondLifecycleSummary {
  date: string;
  couponsPaid: number;
  couponCash: number;
  /** Coupons dated before the position was owned — correctly not credited. */
  couponsSkipped: number;
  redemptions: number;
  redemptionCash: number;
  errors: number;
}

interface BondHolding {
  id: string;
  user_id: string;
  ticker: string | null;
  name: string | null;
  shares: number;
  cost_basis: number;
  account: string | null;
  notes: string | null;
  instrument_type: string | null;
  bond_type: string | null;
  coupon_rate: number | null;
  coupon_freq: number | null;
  maturity_date: string | null;
  acquired_at: string | null;
  created_at: string | null;
}

const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const etDateStr = (ts: string) => ET_DATE.format(new Date(ts));

const round2 = (n: number) => Math.round(n * 100) / 100;

function specOf(h: BondHolding): CouponBond {
  return {
    faceValue: Number(h.shares),
    couponRate: Number(h.coupon_rate ?? 0),
    couponFreq: Number(h.coupon_freq ?? 2),
    maturityDate: h.maturity_date ?? "",
  };
}

/**
 * Apply every coupon and redemption owed as of `date` (YYYY-MM-DD), across all
 * users. `db` must be a service-role client (RLS bypassed). Safe to run
 * repeatedly — the ledger dedupes.
 */
export async function applyBondLifecycle(
  db: SupabaseClient,
  date: string,
): Promise<BondLifecycleSummary> {
  const summary: BondLifecycleSummary = {
    date,
    couponsPaid: 0,
    couponCash: 0,
    couponsSkipped: 0,
    redemptions: 0,
    redemptionCash: 0,
    errors: 0,
  };

  // select("*") + filter in JS, matching lib/corporate-actions.ts: a
  // pre-migration deploy (bonds.sql not run) reads the bond columns as
  // undefined rather than PostgREST 400-ing on columns that don't exist.
  const { data: rowsRaw, error } = await db.from("holdings").select("*");
  if (error) throw new Error(error.message);

  const bonds = (rowsRaw ?? []).filter((r) => {
    const h = r as BondHolding;
    if (h.instrument_type !== "bond") return false;
    if (h.bond_type === "etf") return false; // priced + distributed like any fund
    if (!h.maturity_date) return false; // undated → nothing to schedule or redeem
    return Number(h.shares) > 0;
  }) as BondHolding[];
  if (bonds.length === 0) return summary;

  // Everything already applied for these bonds, at any date — the sweep is a
  // catch-up rather than a single-day check, so the guard has to cover the
  // whole history, not just `date`. Manual rows are excluded for the same
  // reason as the dividend path: they carry no idempotency constraint.
  const { data: appliedRows } = await db
    .from("applied_corporate_actions")
    .select("holding_id,action_type,effective_date")
    .in("action_type", ["coupon", "redemption"])
    .eq("is_manual", false);
  const applied = new Set(
    (appliedRows ?? []).map((r) => `${r.holding_id}|${r.action_type}|${r.effective_date}`),
  );

  // Cash credits accumulate per (user, account) and flush once at the end,
  // same shape as the dividend sweep.
  const cashDelta = new Map<string, { user_id: string; account: string; amount: number }>();
  const addCash = (userId: string, account: string, amount: number) => {
    const key = `${userId}|${account}`;
    const cur = cashDelta.get(key) ?? { user_id: userId, account, amount: 0 };
    cur.amount += amount;
    cashDelta.set(key, cur);
  };

  for (const h of bonds) {
    const account = (h.account ?? "").trim() || "Unassigned";
    const label = h.ticker ?? h.name ?? "Bond";
    const spec = specOf(h);

    /* Floor the catch-up at the date the ROW was created, not at acquisition.
       A bond added today but held since 2020 has real coupon dates going back
       years — but those coupons were never ours to credit: whatever cash they
       became is already baked into the balance the user entered. Paying them
       now would invent money. created_at is "when this app started tracking
       it", which is exactly the right boundary. Missing created_at (shouldn't
       happen; the column is defaulted) degrades to a same-day-only sweep. */
    const trackedFrom = h.created_at ? etDateStr(h.created_at) : date;
    const acquired = h.acquired_at ? etDateStr(h.acquired_at) : null;

    // ── 1. Coupons ────────────────────────────────────────────────────────
    const due = couponsDue(spec, { from: trackedFrom, to: date, acquiredDate: acquired });
    // Anything in the window that entitlement filtered out is a genuine skip
    // (owned too late), worth reporting rather than silently dropping.
    const dueDatesAll = couponsDue(spec, { from: trackedFrom, to: date, acquiredDate: null });
    summary.couponsSkipped += Math.max(0, dueDatesAll.length - due.length);

    for (const c of due) {
      if (applied.has(`${h.id}|coupon|${c.date}`)) continue;
      const amount = round2(c.amount);
      if (amount <= 0) continue;

      // Ledger first — it is the idempotency claim. Only credit cash once the
      // claim has landed, so a failure here can't pay the same coupon twice on
      // the next run.
      const { error: ledErr } = await db.from("applied_corporate_actions").insert({
        holding_id: h.id,
        user_id: h.user_id,
        action_type: "coupon",
        effective_date: c.date,
        pay_date: c.date, // a coupon's ex/pay distinction doesn't exist — it pays on the date
        detail:
          `Coupon ${spec.couponRate}% × $${spec.faceValue.toLocaleString()} face ÷ ${spec.couponFreq}/yr` +
          ` → $${amount.toFixed(2)} to cash`,
        ticker: h.ticker,
        name: h.name,
        amount,
        reinvested: false,
        shares_delta: 0,
        cash_delta: amount,
        price_per_share: null,
        account,
        is_manual: false,
      });
      if (ledErr) {
        // A unique-index violation means a concurrent run already paid it —
        // not an error, just someone else's turn. Anything else is real.
        if (!/duplicate key|unique constraint/i.test(ledErr.message ?? "")) summary.errors++;
        continue;
      }

      addCash(h.user_id, account, amount);
      summary.couponsPaid++;
      summary.couponCash += amount;

      /* Mirror into the transactions ledger as INTEREST so the monthly and
         annual reports pick coupons up as interest income. No double-count:
         those reports read dividends from applied_corporate_actions and skip
         DIV in the ledger, while INTEREST has no other source. The dedupe hash
         is deterministic (unlike recordTransaction's random UUID) so a retry
         after a partial failure can't write the row twice. */
      const { error: txErr } = await db.from("transactions").insert({
        user_id: h.user_id,
        account,
        broker: "manual",
        trade_date: c.date,
        action: "INTEREST",
        symbol: h.ticker,
        description: `${label} coupon`,
        quantity: null,
        price: null,
        amount,
        dedupe_hash: `coupon:${h.id}:${c.date}`,
      });
      if (txErr && !/duplicate key|unique constraint/i.test(txErr.message ?? "")) {
        summary.errors++; // non-fatal: the cash and the ledger row both landed
      }
    }

    // ── 2. Redemption ─────────────────────────────────────────────────────
    // Strictly after coupons: the final coupon pays ON the maturity date, and
    // redeeming first would delete the holding out from under it.
    if (!isMatured(h.maturity_date, date)) continue;
    const maturity = h.maturity_date!.slice(0, 10);
    if (applied.has(`${h.id}|redemption|${maturity}`)) continue;

    const proceeds = round2(redemptionProceeds(Number(h.shares)));
    if (proceeds <= 0) continue;

    // closed_positions carries the realized gain into the reports — at par
    // under the face-value trick, so a bond bought at 97 books (1.00 − 0.97)
    // × face. Insert BEFORE deleting the holding; if it fails, leave the
    // position alone rather than vaporising it.
    const { error: closeErr } = await db.from("closed_positions").insert({
      user_id: h.user_id,
      ticker: h.ticker ?? label,
      name: h.name ?? label,
      shares: Number(h.shares), // face value
      cost_basis: Number(h.cost_basis), // clean purchase price / 100
      sale_price: REDEMPTION_PRICE, // par
      account,
      notes: h.notes,
      instrument_type: "bond",
    });
    if (closeErr) { summary.errors++; continue; }

    const { error: ledErr } = await db.from("applied_corporate_actions").insert({
      holding_id: h.id,
      user_id: h.user_id,
      action_type: "redemption",
      effective_date: maturity,
      pay_date: maturity,
      detail: `Matured — $${proceeds.toLocaleString()} face redeemed at par to cash`,
      ticker: h.ticker,
      name: h.name,
      amount: proceeds,
      reinvested: false,
      shares_delta: -Number(h.shares),
      cash_delta: proceeds,
      price_per_share: null,
      account,
      is_manual: false,
    });
    if (ledErr) {
      if (!/duplicate key|unique constraint/i.test(ledErr.message ?? "")) summary.errors++;
      continue;
    }

    // The ledger row outlives this delete — dividend-ledger-columns.sql dropped
    // the holding_id FK precisely so history survives a closed position.
    const { error: delErr } = await db.from("holdings").delete().eq("id", h.id);
    if (delErr) { summary.errors++; continue; }

    addCash(h.user_id, account, proceeds);
    summary.redemptions++;
    summary.redemptionCash += proceeds;
  }

  // Flush cash — read current balance, add delta, upsert. Mirrors the dividend
  // sweep's flush exactly.
  for (const { user_id, account, amount } of cashDelta.values()) {
    if (amount === 0) continue;
    const { data: existing } = await db
      .from("cash_balances")
      .select("balance,label")
      .eq("user_id", user_id)
      .eq("account", account)
      .maybeSingle();
    const newBalance = round2(Number(existing?.balance ?? 0) + amount);
    const { error: cErr } = await db.from("cash_balances").upsert(
      {
        user_id,
        account,
        label: existing?.label ?? "Cash",
        balance: newBalance,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,account" },
    );
    if (cErr) summary.errors++;
  }

  summary.couponCash = round2(summary.couponCash);
  summary.redemptionCash = round2(summary.redemptionCash);
  return summary;
}
