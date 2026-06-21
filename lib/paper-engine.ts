/**
 * Paper-trading engine: position math, fills, margin accounting, pending-order
 * evaluation, and equity snapshots. Shared by the API routes and the cron.
 *
 * Margin model:
 *  - STOCK / OPTION : cash-settled, long-only. Buy spends cash; sell returns cash
 *    and books realized P/L. No margin held.
 *  - FUTURE / FOREX : long/short. Opening holds initial margin (no cash moves);
 *    closing books realized P/L to cash and releases margin. Positions mark to
 *    market; a margin call flags when equity falls below total maintenance margin.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  initialMarginFor,
  maintenanceMarginFor,
  multiplierFor,
  notionalUsd,
  pnlUsd,
  FUTURES_SPECS,
  FOREX_SPECS,
} from "./contract-specs";
import { priceInstrument } from "./paper-pricing";
import type {
  AssetClass,
  Direction,
  InstrumentRef,
  MarginSummary,
  PaperAccountMeta,
  PaperOrder,
  PaperPosition,
  Side,
} from "./paper-types";

export const STARTING_CASH = 100_000;
const EPS = 1e-9;

/* ─── DB row shapes ─── */
export interface AccountRow {
  id: string;
  user_id: string;
  name: string;
  cash: number;
  starting_cash: number;
  margin_used: number;
}
interface PositionRow {
  id: string;
  account_id: string;
  user_id: string;
  asset_class: AssetClass;
  symbol: string;
  name: string;
  underlying: string | null;
  expiry: string | null;
  strike: number | null;
  option_type: "CALL" | "PUT" | null;
  shares: number;
  avg_cost: number;
  multiplier: number;
  direction: Direction;
  margin_held: number;
}
interface OrderRow {
  id: string;
  account_id: string;
  asset_class: AssetClass;
  symbol: string;
  underlying: string | null;
  expiry: string | null;
  strike: number | null;
  option_type: "CALL" | "PUT" | null;
  side: Side;
  direction: Direction;
  shares: number;
  multiplier: number;
  order_type: "MARKET" | "LIMIT" | "STOP";
  limit_price: number | null;
  stop_price: number | null;
  price: number | null;
  status: "PENDING" | "FILLED" | "CANCELLED" | "REJECTED";
  created_at: string;
  filled_at: string | null;
}

type DB = SupabaseClient;

function rowToRef(r: PositionRow | OrderRow): InstrumentRef {
  return {
    assetClass: r.asset_class,
    symbol: r.symbol,
    underlying: r.underlying ?? undefined,
    expiry: r.expiry ?? undefined,
    strike: r.strike ?? undefined,
    optionType: r.option_type ?? undefined,
  };
}

export function isMarginAsset(ac: AssetClass): boolean {
  return ac === "FUTURE" || ac === "FOREX";
}

/** Human label for a position/order. */
export function instrumentName(ref: InstrumentRef): string {
  switch (ref.assetClass) {
    case "STOCK": return ref.symbol;
    case "FUTURE": return FUTURES_SPECS[ref.symbol]?.name ?? ref.symbol;
    case "FOREX": return FOREX_SPECS[ref.symbol]?.name ?? ref.symbol;
    case "OPTION":
      return `${ref.underlying} ${ref.expiry} ${ref.strike}${ref.optionType === "CALL" ? "C" : "P"}`;
  }
}

/* ─── Accounts ─── */
export async function listAccounts(db: DB, userId: string): Promise<AccountRow[]> {
  const { data } = await db.from("paper_accounts").select("*").eq("user_id", userId).order("created_at");
  let rows = (data ?? []) as AccountRow[];
  if (rows.length === 0) {
    const { data: created, error } = await db
      .from("paper_accounts")
      .insert({ user_id: userId, name: "Main", cash: STARTING_CASH, starting_cash: STARTING_CASH })
      .select()
      .single();
    if (error) throw new Error(error.message);
    rows = [created as AccountRow];
  }
  // Pre-v2 rows lack the `id` column — surface a clear "run the migration" error
  // instead of silently returning an account with an undefined id.
  if (!rows[0]?.id) {
    throw new Error("paper_accounts is missing the v2 columns — run supabase/paper-v2-multi-asset.sql");
  }
  return rows;
}

/** Resolve a requested account id to one the user owns, else their first (Main). */
export async function resolveAccount(db: DB, userId: string, accountId?: string | null): Promise<AccountRow> {
  const accounts = await listAccounts(db, userId);
  if (accountId) {
    const match = accounts.find((a) => a.id === accountId);
    if (match) return match;
  }
  return accounts[0];
}

/* ─── Fill execution (mutates positions + account + realized log) ─── */

interface FillPlan {
  newQtyAbs: number;        // 0 ⇒ close/delete
  newAvg: number;
  newDir: Direction;
  newMargin: number;
  cashDelta: number;
  realized: number;
  marginDelta: number;      // change to account.margin_used
}

/** Pure: compute the resulting position state for a fill. Throws on illegal short. */
function computeFill(
  ref: InstrumentRef,
  current: PositionRow | null,
  side: Side,
  qty: number,
  price: number
): FillPlan {
  const margin = isMarginAsset(ref.assetClass);
  const orderSigned = side === "BUY" ? qty : -qty;
  const curSigned = current ? (current.direction === "LONG" ? current.shares : -current.shares) : 0;
  const newSigned = curSigned + orderSigned;

  let cashDelta = 0;
  let realized = 0;
  let newAvg = current?.avg_cost ?? price;
  let newDir: Direction = current?.direction ?? (orderSigned >= 0 ? "LONG" : "SHORT");
  let newQtyAbs = Math.abs(newSigned);

  if (!margin) {
    // Long-only cash asset.
    if (newSigned < -EPS) throw new Error("Shorting is not supported for stocks/options — you can't sell more than you hold.");
    if (orderSigned > 0) {
      cashDelta = -notionalUsd(ref, price, qty);
      newAvg = current ? (current.shares * current.avg_cost + qty * price) / (current.shares + qty) : price;
    } else {
      cashDelta = notionalUsd(ref, price, qty);
      if (current) realized = pnlUsd(ref, "LONG", current.avg_cost, price, qty);
      newAvg = current?.avg_cost ?? price;
    }
    newDir = "LONG";
    return { newQtyAbs, newAvg, newDir, newMargin: 0, cashDelta, realized, marginDelta: 0 };
  }

  // Margin asset (futures/forex): signed math with partial close + flip.
  const sameSign = curSigned !== 0 && Math.sign(orderSigned) === Math.sign(curSigned);
  if (curSigned === 0) {
    newAvg = price;
    newDir = newSigned > 0 ? "LONG" : "SHORT";
  } else if (sameSign) {
    newAvg = (current!.shares * current!.avg_cost + qty * price) / (current!.shares + qty);
    newDir = current!.direction;
  } else {
    // Opposite side: close (and maybe flip).
    const closeQty = Math.min(current!.shares, qty);
    realized = pnlUsd(ref, current!.direction, current!.avg_cost, price, closeQty);
    cashDelta = realized;
    if (Math.abs(newSigned) < EPS) {
      newQtyAbs = 0;
    } else if (Math.sign(newSigned) === Math.sign(curSigned)) {
      newAvg = current!.avg_cost;       // partial close, same direction
      newDir = current!.direction;
    } else {
      newAvg = price;                    // flipped
      newDir = newSigned > 0 ? "LONG" : "SHORT";
    }
  }

  const newMargin = newQtyAbs < EPS ? 0 : initialMarginFor(ref, price, newQtyAbs);
  const marginDelta = newMargin - (current?.margin_held ?? 0);
  return { newQtyAbs, newAvg, newDir, newMargin, cashDelta, realized, marginDelta };
}

/**
 * Execute a fill against the live account state. Validates buying power,
 * mutates the position, account cash/margin, and writes a realized row.
 * Returns the realized P/L and notional. Throws (caller decides reject vs error).
 */
export async function executeFill(
  db: DB,
  account: AccountRow,
  ref: InstrumentRef,
  side: Side,
  qty: number,
  price: number
): Promise<{ realized: number; notional: number }> {
  // Fresh account read (avoid stale cash/margin under concurrent fills).
  const { data: acc } = await db.from("paper_accounts").select("*").eq("id", account.id).single();
  const a = acc as AccountRow;

  const { data: posData } = await db
    .from("paper_positions")
    .select("*")
    .eq("account_id", a.id)
    .eq("symbol", ref.symbol)
    .maybeSingle();
  const current = posData as PositionRow | null;

  const plan = computeFill(ref, current, side, qty, price);

  const buyingPower = Number(a.cash) - Number(a.margin_used);
  // Cash assets: a buy must be affordable. Margin assets: added margin must fit.
  if (!isMarginAsset(ref.assetClass)) {
    if (plan.cashDelta < 0 && -plan.cashDelta > buyingPower + EPS) {
      throw new Error(`Insufficient buying power: need $${(-plan.cashDelta).toFixed(2)}, have $${buyingPower.toFixed(2)}.`);
    }
  } else if (plan.marginDelta > 0 && plan.marginDelta > buyingPower + EPS) {
    throw new Error(`Insufficient margin: need $${plan.marginDelta.toFixed(2)}, have $${buyingPower.toFixed(2)}.`);
  }

  // Persist position. Errors are checked (not swallowed) so a failed write
  // surfaces as a rejected order instead of a phantom "filled" with no position.
  let writeErr: { message: string } | null = null;
  if (plan.newQtyAbs < EPS) {
    if (current) ({ error: writeErr } = await db.from("paper_positions").delete().eq("id", current.id));
  } else if (current) {
    ({ error: writeErr } = await db.from("paper_positions").update({
      shares: plan.newQtyAbs,
      avg_cost: plan.newAvg,
      direction: plan.newDir,
      margin_held: plan.newMargin,
    }).eq("id", current.id));
  } else {
    ({ error: writeErr } = await db.from("paper_positions").insert({
      account_id: a.id,
      user_id: a.user_id,
      ticker: ref.symbol,           // legacy NOT NULL column — keep it populated
      asset_class: ref.assetClass,
      symbol: ref.symbol,
      name: instrumentName(ref),
      underlying: ref.underlying ?? null,
      expiry: ref.expiry ?? null,
      strike: ref.strike ?? null,
      option_type: ref.optionType ?? null,
      shares: plan.newQtyAbs,
      avg_cost: plan.newAvg,
      multiplier: multiplierFor(ref.assetClass, ref.symbol),
      direction: plan.newDir,
      margin_held: plan.newMargin,
    }));
  }
  if (writeErr) throw new Error(`Position write failed: ${writeErr.message}`);

  // Persist account cash + margin.
  const { error: acctErr } = await db.from("paper_accounts").update({
    cash: Number(a.cash) + plan.cashDelta,
    margin_used: Math.max(0, Number(a.margin_used) + plan.marginDelta),
  }).eq("id", a.id);
  if (acctErr) throw new Error(`Account write failed: ${acctErr.message}`);

  // Realized log.
  if (Math.abs(plan.realized) > EPS) {
    await db.from("paper_realized").insert({
      user_id: a.user_id,
      account_id: a.id,
      symbol: ref.symbol,
      asset_class: ref.assetClass,
      realized_pl: plan.realized,
    });
  }

  return { realized: plan.realized, notional: notionalUsd(ref, price, qty) };
}

/* ─── Account state for the client (marked to market) ─── */
export interface AccountState {
  account: PaperAccountMeta;
  accounts: PaperAccountMeta[];
  positions: PaperPosition[];
  orders: PaperOrder[];
  realizedTotal: number;
  summary: MarginSummary;
}

export async function loadAccountState(db: DB, userId: string, account: AccountRow): Promise<AccountState> {
  const allAccounts = await listAccounts(db, userId);

  const [{ data: posData }, { data: orderData }, { data: realizedData }] = await Promise.all([
    db.from("paper_positions").select("*").eq("account_id", account.id).order("asset_class").order("symbol"),
    db.from("paper_orders").select("*").eq("account_id", account.id).order("created_at", { ascending: false }).limit(80),
    db.from("paper_realized").select("realized_pl").eq("account_id", account.id),
  ]);

  const posRows = (posData ?? []) as PositionRow[];
  const priceMap = new Map<string, { price: number; livePrice: boolean }>();
  for (const p of posRows) {
    const priced = await priceInstrument(rowToRef(p));
    priceMap.set(p.symbol, priced ?? { price: Number(p.avg_cost), livePrice: false });
    await new Promise((r) => setTimeout(r, 40));
  }

  let positionsValue = 0;
  let unrealizedTotal = 0;
  let marginUsed = 0;
  let maintenanceTotal = 0;

  const positions: PaperPosition[] = posRows.map((p) => {
    const ref = rowToRef(p);
    const mark = priceMap.get(p.symbol)!;
    const unrealized = pnlUsd(ref, p.direction, Number(p.avg_cost), mark.price, Number(p.shares));
    const cost = Math.abs(notionalUsd(ref, Number(p.avg_cost), Number(p.shares)));
    const marketValue = isMarginAsset(p.asset_class) ? 0 : notionalUsd(ref, mark.price, Number(p.shares));
    positionsValue += marketValue;
    unrealizedTotal += unrealized;
    marginUsed += Number(p.margin_held);
    if (isMarginAsset(p.asset_class)) {
      maintenanceTotal += maintenanceMarginFor(ref, mark.price, Number(p.shares));
    }
    return {
      id: p.id,
      assetClass: p.asset_class,
      symbol: p.symbol,
      underlying: p.underlying ?? undefined,
      expiry: p.expiry ?? undefined,
      strike: p.strike ?? undefined,
      optionType: p.option_type ?? undefined,
      name: p.name,
      qty: Number(p.shares),
      avgCost: Number(p.avg_cost),
      multiplier: Number(p.multiplier),
      direction: p.direction,
      price: mark.price,
      marketValue,
      unrealized,
      unrealizedPct: cost > 0 ? (unrealized / cost) * 100 : 0,
      marginHeld: Number(p.margin_held),
      livePrice: mark.livePrice,
    };
  });

  const cash = Number(account.cash);
  const equity = cash + positionsValue + posRows
    .filter((p) => isMarginAsset(p.asset_class))
    .reduce((s, p) => s + pnlUsd(rowToRef(p), p.direction, Number(p.avg_cost), priceMap.get(p.symbol)!.price, Number(p.shares)), 0);
  const startingCash = Number(account.starting_cash);
  const totalPL = equity - startingCash;

  const summary: MarginSummary = {
    cash,
    startingCash,
    positionsValue,
    unrealized: unrealizedTotal,
    equity,
    marginUsed,
    buyingPower: cash - marginUsed,
    maintenanceMargin: maintenanceTotal,
    marginCall: maintenanceTotal > 0 && equity < maintenanceTotal,
    totalPL,
    totalPLPct: startingCash > 0 ? (totalPL / startingCash) * 100 : 0,
  };

  const orders: PaperOrder[] = ((orderData ?? []) as OrderRow[]).map((o) => ({
    id: o.id,
    assetClass: o.asset_class,
    symbol: o.symbol,
    underlying: o.underlying ?? undefined,
    expiry: o.expiry ?? undefined,
    strike: o.strike ?? undefined,
    optionType: o.option_type ?? undefined,
    side: o.side,
    direction: o.direction,
    qty: Number(o.shares),
    multiplier: Number(o.multiplier),
    orderType: o.order_type,
    limitPrice: o.limit_price != null ? Number(o.limit_price) : null,
    stopPrice: o.stop_price != null ? Number(o.stop_price) : null,
    price: o.price != null ? Number(o.price) : null,
    status: o.status,
    createdAt: o.created_at,
    filledAt: o.filled_at,
  }));

  const realizedTotal = ((realizedData ?? []) as { realized_pl: number }[])
    .reduce((s, r) => s + Number(r.realized_pl), 0);

  return {
    account: { id: account.id, name: account.name },
    accounts: allAccounts.map((a) => ({ id: a.id, name: a.name })),
    positions,
    orders,
    realizedTotal,
    summary,
  };
}

/* ─── Expire options past their expiry date ─── */

/**
 * Close all OPTION positions whose expiry has passed. Sells at market price if
 * still quoted (ITM), otherwise expires worthless at $0.
 * Returns the number of positions expired.
 */
export async function expireOptions(db: DB, userId: string): Promise<number> {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());

  const { data } = await db
    .from("paper_positions")
    .select("*")
    .eq("user_id", userId)
    .eq("asset_class", "OPTION")
    .lt("expiry", today);

  const expired = (data ?? []) as PositionRow[];

  // Also cancel any PENDING orders for expired options.
  await db
    .from("paper_orders")
    .update({ status: "CANCELLED" })
    .eq("user_id", userId)
    .eq("asset_class", "OPTION")
    .eq("status", "PENDING")
    .lt("expiry", today);

  if (expired.length === 0) return 0;

  let count = 0;
  for (const pos of expired) {
    const ref = rowToRef(pos);
    const priced = await priceInstrument(ref);
    const closePrice = priced?.price ?? 0;

    const account = await resolveAccount(db, userId, pos.account_id);
    try {
      await executeFill(db, account, ref, "SELL", Number(pos.shares), closePrice);
      count++;
    } catch {
      // If sell fails (shouldn't for long-only options), delete the position
      // at $0 so it doesn't linger.
      await db.from("paper_positions").delete().eq("id", pos.id);
      count++;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return count;
}

/* ─── Pending-order evaluation (triggered fills) ─── */

function isTriggered(o: OrderRow, price: number): boolean {
  if (o.order_type === "LIMIT" && o.limit_price != null) {
    return o.side === "BUY" ? price <= o.limit_price : price >= o.limit_price;
  }
  if (o.order_type === "STOP" && o.stop_price != null) {
    return o.side === "BUY" ? price >= o.stop_price : price <= o.stop_price;
  }
  return false;
}

/** Evaluate all PENDING orders for a user; fill those whose trigger is crossed. */
export async function evaluateFills(db: DB, userId: string): Promise<number> {
  const { data } = await db
    .from("paper_orders")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "PENDING");
  const pending = (data ?? []) as (OrderRow & { user_id: string })[];
  if (pending.length === 0) return 0;

  let filled = 0;
  for (const o of pending) {
    const ref = rowToRef(o);
    const priced = await priceInstrument(ref);
    if (!priced) continue;
    if (!isTriggered(o, priced.price)) continue;

    const account = await resolveAccount(db, userId, o.account_id);
    try {
      await executeFill(db, account, ref, o.side, Number(o.shares), priced.price);
      await db.from("paper_orders").update({
        status: "FILLED", price: priced.price, filled_at: new Date().toISOString(),
      }).eq("id", o.id);
      filled++;
    } catch {
      // Couldn't fill (e.g. buying power) — reject so it stops re-trying.
      await db.from("paper_orders").update({ status: "REJECTED" }).eq("id", o.id);
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return filled;
}

/* ─── Equity snapshots (per account, idempotent per day) ─── */
export async function captureSnapshot(db: DB, userId: string): Promise<void> {
  const accounts = await listAccounts(db, userId);
  // Key to the US market day (Eastern), not UTC — an evening capture in a US
  // timezone would otherwise roll over to "tomorrow" and plot a phantom date.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
  for (const account of accounts) {
    const state = await loadAccountState(db, userId, account);
    await db.from("paper_snapshots").upsert(
      {
        user_id: userId,
        account_id: account.id,
        snapshot_date: today,
        equity: state.summary.equity,
        cash: state.summary.cash,
      },
      { onConflict: "account_id,snapshot_date" }
    );
  }
}
