/**
 * Corporate-action engine: detect splits / consolidations / dividends effective
 * on a given US market day and apply them to every user's holdings.
 *
 * Called as a pre-step inside the daily snapshot cron (so holdings are adjusted
 * BEFORE the day's value snapshot is taken) and exposed standalone at
 * /api/corporate-actions/cron for manual runs. Idempotent via the
 * applied_corporate_actions ledger — an action hits a holding exactly once.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchQuote } from "@/lib/finnhub";
import { isMarketDay } from "@/lib/market-calendar";

export interface SplitDue {
  ratio: number; // new shares per old share. 2:1 → 2, 1:10 reverse → 0.1
  label: string; // e.g. "2:1" or "1:10"
}
export interface DividendDue {
  amount: number; // cash per share
}

/** UTC YYYY-MM-DD for a unix-seconds timestamp. */
function utcDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/**
 * Splits effective on `date` (YYYY-MM-DD) from Yahoo chart events. Yahoo only
 * surfaces a split on/after its effective date, which is exactly when we want
 * to apply it. Free, no crumb needed on the v8 chart endpoint.
 */
export async function fetchSplitDue(ticker: string, date: string): Promise<SplitDue | null> {
  try {
    const from = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000) - 2 * 86400;
    const to = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000) + 2 * 86400;
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
      `?period1=${from}&period2=${to}&interval=1d&events=split`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data = await res.json();
    const splits = data?.chart?.result?.[0]?.events?.splits as
      | Record<string, { date: number; numerator: number; denominator: number; splitRatio?: string }>
      | undefined;
    if (!splits) return null;
    for (const s of Object.values(splits)) {
      if (utcDate(s.date) !== date) continue;
      if (!s.numerator || !s.denominator) continue;
      return {
        ratio: s.numerator / s.denominator,
        label: s.splitRatio ?? `${s.numerator}:${s.denominator}`,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Cash dividend with ex-date == `date` from Yahoo chart events (`events=div`).
 * Finnhub's /stock/dividend2 is a premium endpoint — it 403s on the free tier
 * we run on, so it silently yielded zero dividends. Yahoo surfaces the dividend
 * on/after its ex-date (same as splits), which is exactly when we apply it, and
 * keeps this consistent with fetchSplitDue + the Calendar tab. Free, no crumb.
 */
export async function fetchDividendDue(ticker: string, date: string): Promise<DividendDue | null> {
  try {
    const from = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000) - 2 * 86400;
    const to = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000) + 2 * 86400;
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
      `?period1=${from}&period2=${to}&interval=1d&events=div`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data = await res.json();
    const dividends = data?.chart?.result?.[0]?.events?.dividends as
      | Record<string, { date: number; amount: number }>
      | undefined;
    if (!dividends) return null;
    for (const d of Object.values(dividends)) {
      if (utcDate(d.date) !== date) continue;
      if (typeof d.amount !== "number") continue;
      return { amount: d.amount };
    }
    return null;
  } catch {
    return null;
  }
}

interface Holding {
  id: string;
  user_id: string;
  ticker: string;
  name: string | null;
  shares: number;
  cost_basis: number;
  account: string | null;
  drip: boolean;
}

export interface CorporateActionSummary {
  date: string;
  splits: number;
  dividendsReinvested: number;
  dividendsToCash: number;
  errors: number;
}

/**
 * Apply every split + dividend effective on `date` to all users' holdings.
 * `db` must be a service-role client (RLS bypassed) so it can read/write across
 * users. Safe to run multiple times per day — the ledger dedupes.
 */
export async function applyCorporateActions(
  db: SupabaseClient,
  date: string,
): Promise<CorporateActionSummary> {
  const summary: CorporateActionSummary = {
    date,
    splits: 0,
    dividendsReinvested: 0,
    dividendsToCash: 0,
    errors: 0,
  };

  const { data: holdingsRaw, error } = await db
    .from("holdings")
    .select("id,user_id,ticker,name,shares,cost_basis,account,drip");
  if (error) throw new Error(error.message);
  const holdings = (holdingsRaw ?? []) as Holding[];
  if (holdings.length === 0) return summary;

  // What's already been applied for this date (skip those). Exclude manual
  // entries — they have no idempotency constraint and shouldn't block the cron.
  const { data: appliedRows } = await db
    .from("applied_corporate_actions")
    .select("holding_id,action_type")
    .eq("effective_date", date)
    .eq("is_manual", false);
  const applied = new Set((appliedRows ?? []).map((r) => `${r.holding_id}|${r.action_type}`));

  // Detect actions once per unique ticker.
  const tickers = [...new Set(holdings.map((h) => h.ticker.toUpperCase()))];
  const splitByTicker = new Map<string, SplitDue | null>();
  const divByTicker = new Map<string, DividendDue | null>();
  for (const t of tickers) {
    splitByTicker.set(t, await fetchSplitDue(t, date));
    divByTicker.set(t, await fetchDividendDue(t, date));
  }

  // Price cache for DRIP reinvestment (only fetched if needed).
  const priceCache = new Map<string, number | null>();
  const priceFor = async (t: string): Promise<number | null> => {
    if (priceCache.has(t)) return priceCache.get(t)!;
    const q = await fetchQuote(t);
    const p = q?.price ?? null;
    priceCache.set(t, p);
    return p;
  };

  // Accumulate cash credits per (user_id, account) for a single upsert pass.
  const cashDelta = new Map<string, { user_id: string; account: string; amount: number }>();

  for (const h of holdings) {
    const t = h.ticker.toUpperCase();
    const split = splitByTicker.get(t) ?? null;
    const dividend = divByTicker.get(t) ?? null;
    if (!split && !dividend) continue;

    let shares = Number(h.shares);
    let costBasis = Number(h.cost_basis);
    let changed = false;
    const account = (h.account ?? "").trim() || "Unassigned";
    const ledger: {
      action_type: "split" | "dividend";
      detail: string;
      ticker?: string;
      name?: string | null;
      amount?: number;
      reinvested?: boolean;
      shares_delta?: number;
      cash_delta?: number;
      price_per_share?: number;
      account?: string;
    }[] = [];

    // 1. Split / consolidation first (so a same-day dividend uses post-split shares).
    if (split && !applied.has(`${h.id}|split`)) {
      shares = shares * split.ratio;
      costBasis = costBasis / split.ratio;
      changed = true;
      summary.splits++;
      ledger.push({
        action_type: "split",
        detail: `${split.label} split — ${Number(h.shares)}→${shares.toFixed(6)} sh, avg cost ${Number(h.cost_basis).toFixed(4)}→${costBasis.toFixed(4)}`,
      });
    }

    // 2. Dividend.
    if (dividend && !applied.has(`${h.id}|dividend`)) {
      const total = dividend.amount * shares;
      if (h.drip) {
        const price = await priceFor(t);
        if (price && price > 0) {
          const bought = total / price;
          const newShares = shares + bought;
          costBasis = (shares * costBasis + total) / newShares;
          shares = newShares;
          changed = true;
          summary.dividendsReinvested++;
          ledger.push({
            action_type: "dividend",
            detail: `DRIP $${dividend.amount}/sh → +${bought.toFixed(6)} sh @ $${price.toFixed(2)} ($${total.toFixed(2)})`,
            ticker: t,
            name: h.name,
            amount: total,
            reinvested: true,
            shares_delta: bought,
            cash_delta: 0,
            price_per_share: price,
            account,
          });
        } else {
          // No price → fall back to cash so the dividend isn't lost.
          const key = `${h.user_id}|${account}`;
          const cur = cashDelta.get(key) ?? { user_id: h.user_id, account, amount: 0 };
          cur.amount += total;
          cashDelta.set(key, cur);
          summary.dividendsToCash++;
          ledger.push({
            action_type: "dividend",
            detail: `DRIP $${dividend.amount}/sh — no live price, credited $${total.toFixed(2)} to cash instead`,
            ticker: t,
            name: h.name,
            amount: total,
            reinvested: false,
            shares_delta: 0,
            cash_delta: total,
            account,
          });
        }
      } else {
        const key = `${h.user_id}|${account}`;
        const cur = cashDelta.get(key) ?? { user_id: h.user_id, account, amount: 0 };
        cur.amount += total;
        cashDelta.set(key, cur);
        summary.dividendsToCash++;
        ledger.push({
          action_type: "dividend",
          detail: `$${dividend.amount}/sh × ${shares.toFixed(4)} sh → $${total.toFixed(2)} to cash`,
          ticker: t,
          name: h.name,
          amount: total,
          reinvested: false,
          shares_delta: 0,
          cash_delta: total,
          account,
        });
      }
    }

    if (ledger.length === 0) continue;

    // Persist holding change (if any), then the ledger rows.
    if (changed) {
      const { error: upErr } = await db
        .from("holdings")
        .update({ shares, cost_basis: costBasis })
        .eq("id", h.id);
      if (upErr) { summary.errors++; continue; } // don't ledger a change that didn't land
    }
    const baseRows = ledger.map((l) => ({
      holding_id: h.id,
      user_id: h.user_id,
      action_type: l.action_type,
      effective_date: date,
      detail: l.detail,
    }));
    const fullRows = ledger.map((l, i) => ({
      ...baseRows[i],
      ticker: l.ticker ?? null,
      name: l.name ?? null,
      amount: l.amount ?? null,
      reinvested: l.reinvested ?? null,
      shares_delta: l.shares_delta ?? 0,
      cash_delta: l.cash_delta ?? 0,
      price_per_share: l.price_per_share ?? null,
      account: l.account ?? null,
      is_manual: false,
    }));
    let { error: ledErr } = await db.from("applied_corporate_actions").insert(fullRows);
    // If new columns aren't migrated yet, fall back so the idempotency row still lands.
    if (ledErr && /column|schema cache|PGRST204/i.test(ledErr.message ?? "")) {
      ({ error: ledErr } = await db.from("applied_corporate_actions").insert(baseRows));
    }
    if (ledErr) summary.errors++;
  }

  // Flush cash credits — read current balance, add delta, upsert.
  for (const { user_id, account, amount } of cashDelta.values()) {
    if (amount === 0) continue;
    const { data: existing } = await db
      .from("cash_balances")
      .select("balance,label")
      .eq("user_id", user_id)
      .eq("account", account)
      .maybeSingle();
    const newBalance = Number(existing?.balance ?? 0) + amount;
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

  return summary;
}

/**
 * Re-scan a trailing window of trading days ending at `endDate` (inclusive) and
 * apply every action effective on each one. Our free data source (Yahoo) often
 * posts an ETF's ex-dividend 1-2 days AFTER the ex-date, so a same-day-only
 * check misses it permanently — the dividend lands in the feed on a day no cron
 * run will ever look at again. Re-checking recent days closes that gap; the
 * applied_corporate_actions ledger keeps it idempotent (each action hits a
 * holding once, keyed on its true ex-date), so overlapping daily windows never
 * double-count. Only real market days are scanned — ex-dates never fall on
 * weekends or holidays, so other dates are pure waste.
 */
export async function applyCorporateActionsWindow(
  db: SupabaseClient,
  endDate: string,
  lookbackDays: number,
): Promise<CorporateActionSummary & { datesScanned: string[] }> {
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  const dates: string[] = [];
  for (let i = lookbackDays; i >= 0; i--) {
    const d = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    if (isMarketDay(d)) dates.push(d);
  }
  const agg = {
    date: endDate,
    splits: 0,
    dividendsReinvested: 0,
    dividendsToCash: 0,
    errors: 0,
    datesScanned: dates,
  };
  for (const d of dates) {
    const s = await applyCorporateActions(db, d);
    agg.splits += s.splits;
    agg.dividendsReinvested += s.dividendsReinvested;
    agg.dividendsToCash += s.dividendsToCash;
    agg.errors += s.errors;
  }
  return agg;
}
