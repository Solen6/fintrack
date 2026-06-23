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
  shortAllowed,
  FUTURES_SPECS,
  FOREX_SPECS,
} from "./contract-specs";
import { priceInstrument, priceInstrumentForFill, assessOptionLiquidity } from "./paper-pricing";
import { mapLimit } from "./async";
import {
  aggregatePayoff,
  priceAxisMax,
  summarize,
  type Leg as MathLeg,
} from "./options-math";
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
  competition_id: string | null;   // null = a normal/main account
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
  combo_id: string | null;
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

const isoToUnix = (iso: string | null): number =>
  iso ? Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 1000) : 0;

/** The options-math Leg view of a position row (premium = entry cost basis). */
function rowToMathLeg(p: PositionRow): MathLeg {
  const side = p.direction === "LONG" ? "long" : "short";
  if (p.asset_class === "STOCK") {
    return { type: "stock", side, strike: Number(p.avg_cost), expiry: 0, qty: Number(p.shares), premium: Number(p.avg_cost), iv: 0 };
  }
  return {
    type: p.option_type === "CALL" ? "call" : "put",
    side,
    strike: Number(p.strike),
    expiry: isoToUnix(p.expiry),
    qty: Number(p.shares),
    premium: Number(p.avg_cost),
    iv: 0,
  };
}

/**
 * Collateral to reserve for a (possibly multi-leg) option strategy.
 *  - Net-debit positions reserve nothing — the debit you paid IS the max risk.
 *  - Defined-risk credit positions reserve their max loss (e.g. a credit spread
 *    holds width − credit + the credit = the spread width; a cash-secured put
 *    holds strike × 100).
 *  - Naked (unbounded) shorts fall back to a Reg-T-style 20%-of-strike estimate.
 */
export function comboMarginUsd(legs: MathLeg[], spot: number): number {
  const optLegs = legs.filter((l) => l.type !== "stock");
  if (optLegs.length === 0) return 0;
  const points = aggregatePayoff(legs, priceAxisMax(legs, spot));
  const summary = summarize(legs, points);
  const credit = Math.max(0, -summary.netCost);
  if (!Number.isFinite(summary.maxLoss)) {
    let m = 0;
    for (const l of optLegs) if (l.side === "short") m += 0.2 * l.strike * 100 * l.qty;
    return m + credit;
  }
  if (summary.netCost > 0) return 0;                  // net debit — risk already paid
  return Math.abs(summary.maxLoss) + credit;          // net credit — reserve full liability
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

/**
 * The user's MAIN (non-competition) accounts — what the Paper UI shows, the
 * account-limit counts, and reset/delete operate on. Auto-creates "Main" the
 * first time. Competition sandboxes are deliberately excluded so they can't be
 * reset (anti-restart), deleted, or pollute the account switcher.
 */
export async function listAccounts(db: DB, userId: string): Promise<AccountRow[]> {
  let { data, error } = await db
    .from("paper_accounts")
    .select("*")
    .eq("user_id", userId)
    .is("competition_id", null)
    .order("created_at");
  // Pre-competitions migration the competition_id column doesn't exist yet —
  // fall back to all accounts so normal paper trading keeps working.
  if (error) {
    ({ data } = await db.from("paper_accounts").select("*").eq("user_id", userId).order("created_at"));
  }
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

/** Every account for a user, including competition sandboxes (for the cron). */
export async function listAllAccounts(db: DB, userId: string): Promise<AccountRow[]> {
  const { data } = await db.from("paper_accounts").select("*").eq("user_id", userId).order("created_at");
  return (data ?? []) as AccountRow[];
}

/**
 * Resolve a requested account id to one the user owns (main OR competition),
 * else default to their first main account. Looking the id up directly (rather
 * than scanning main accounts) is what lets competition sandboxes be traded.
 */
export async function resolveAccount(db: DB, userId: string, accountId?: string | null): Promise<AccountRow> {
  if (accountId) {
    const { data } = await db
      .from("paper_accounts")
      .select("*")
      .eq("id", accountId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return data as AccountRow;
  }
  const accounts = await listAccounts(db, userId);
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
    // Cash-settled asset. Stocks are long-only; options can be sold-to-open.
    if (!shortAllowed(ref.assetClass) && newSigned < -EPS) {
      throw new Error("Shorting is not supported for stocks — you can't sell more than you hold.");
    }
    // Every buy pays cash, every sell receives cash (open or close alike).
    cashDelta = side === "BUY" ? -notionalUsd(ref, price, qty) : notionalUsd(ref, price, qty);

    const sameSign = curSigned !== 0 && Math.sign(orderSigned) === Math.sign(curSigned);
    if (curSigned === 0) {
      newAvg = price;
      newDir = newSigned > 0 ? "LONG" : "SHORT";
    } else if (sameSign) {
      newAvg = (current!.shares * current!.avg_cost + qty * price) / (current!.shares + qty);
      newDir = current!.direction;
    } else {
      // Opposite side: realize P/L on the closed portion (and maybe flip).
      const closeQty = Math.min(current!.shares, qty);
      realized = pnlUsd(ref, current!.direction, current!.avg_cost, price, closeQty);
      if (Math.abs(newSigned) < EPS) {
        newQtyAbs = 0;
      } else if (Math.sign(newSigned) === Math.sign(curSigned)) {
        newAvg = current!.avg_cost;      // partial close, same direction
        newDir = current!.direction;
      } else {
        newAvg = price;                   // flipped
        newDir = newSigned > 0 ? "LONG" : "SHORT";
      }
    }
    // Option collateral is held at the combo level, not per-leg.
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

/* ─── Order pricing + options liquidity guard ─── */

async function getPositionRow(db: DB, accountId: string, symbol: string): Promise<PositionRow | null> {
  const { data } = await db
    .from("paper_positions")
    .select("*")
    .eq("account_id", accountId)
    .eq("symbol", symbol)
    .maybeSingle();
  return (data as PositionRow | null) ?? null;
}

/** Does an order OPEN or INCREASE exposure (vs purely reduce/close an existing one)? */
function increasesExposure(current: PositionRow | null, side: Side, qty: number): boolean {
  if (!current) return true;
  const curSigned = current.direction === "LONG" ? current.shares : -current.shares;
  const orderSigned = side === "BUY" ? qty : -qty;
  if (Math.sign(orderSigned) === Math.sign(curSigned)) return true;   // adding to the same side
  return qty > current.shares + EPS;                                   // opposite side, big enough to flip → new exposure
}

/**
 * Price an order for execution. Options fill side-aware (buy lifts the ask, sell
 * hits the bid, plus slippage); other assets fill at their single live quote.
 * When the order OPENS option exposure the contract must clear the liquidity
 * guard, else the fill is rejected — this is what stops a thin/stale contract
 * from being bought at a fantasy mid and marked into instant P/L. Closing and
 * expiring an existing position is never blocked (you can always exit).
 */
export async function priceForOrder(
  db: DB,
  accountId: string,
  ref: InstrumentRef,
  side: Side,
  qty: number
): Promise<number> {
  const priced = await priceInstrumentForFill(ref, side);
  if (!priced) throw new Error(`No live price for "${ref.symbol}" — check the symbol/contract.`);
  if (ref.assetClass === "OPTION" && priced.contract) {
    const current = await getPositionRow(db, accountId, ref.symbol);
    if (increasesExposure(current, side, qty)) {
      const a = assessOptionLiquidity(priced.contract);
      if (!a.ok) throw new Error(`Can't open ${instrumentName(ref)} — ${a.reason}.`);
    }
  }
  return priced.price;
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
  price: number,
  comboId?: string
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
      // Only reference combo_id for actual combos, so single-asset trades keep
      // working before the paper-combo migration is run.
      ...(comboId ? { combo_id: comboId } : {}),
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
  competitionAccounts: { id: string; name: string; competitionId: string }[];
  positions: PaperPosition[];
  orders: PaperOrder[];
  realizedTotal: number;
  summary: MarginSummary;
}

export async function loadAccountState(db: DB, userId: string, account: AccountRow): Promise<AccountState> {
  const allAccounts = await listAccounts(db, userId);

  // Competition sandboxes, surfaced separately so the Paper account switcher can
  // offer them (under their own group) without letting them be reset/deleted.
  let competitionAccounts: { id: string; name: string; competitionId: string }[] = [];
  {
    const { data, error } = await db
      .from("paper_accounts")
      .select("id, name, competition_id")
      .eq("user_id", userId)
      .not("competition_id", "is", null)
      .order("created_at");
    if (!error) {
      competitionAccounts = ((data ?? []) as { id: string; name: string; competition_id: string }[])
        .map((a) => ({ id: a.id, name: a.name, competitionId: a.competition_id }));
    }
  }

  const [{ data: posData }, { data: orderData }, { data: realizedData }] = await Promise.all([
    db.from("paper_positions").select("*").eq("account_id", account.id).order("asset_class").order("symbol"),
    db.from("paper_orders").select("*").eq("account_id", account.id).order("created_at", { ascending: false }).limit(80),
    db.from("paper_realized").select("realized_pl").eq("account_id", account.id),
  ]);

  const posRows = (posData ?? []) as PositionRow[];
  // Mark every position in parallel — this is a pure read, so order doesn't
  // matter. (Was a sequential loop with a 40ms sleep per position, which made a
  // 10-leg account take seconds instead of one round-trip.)
  const priceMap = new Map<string, { price: number; livePrice: boolean }>();
  const priced = await mapLimit(posRows, 8, (p) => priceInstrument(rowToRef(p)));
  posRows.forEach((p, i) => {
    priceMap.set(p.symbol, priced[i] ?? { price: Number(p.avg_cost), livePrice: false });
  });

  let positionsValue = 0;
  let unrealizedTotal = 0;
  let marginUsed = 0;
  let maintenanceTotal = 0;

  const positions: PaperPosition[] = posRows.map((p) => {
    const ref = rowToRef(p);
    const mark = priceMap.get(p.symbol)!;
    const dirSign = p.direction === "LONG" ? 1 : -1;
    const unrealized = pnlUsd(ref, p.direction, Number(p.avg_cost), mark.price, Number(p.shares));
    const cost = Math.abs(notionalUsd(ref, Number(p.avg_cost), Number(p.shares)));
    // Long positions are assets (+); a short option is a liability (−).
    const marketValue = isMarginAsset(p.asset_class) ? 0 : dirSign * notionalUsd(ref, mark.price, Number(p.shares));
    positionsValue += marketValue;
    unrealizedTotal += unrealized;
    marginUsed += Number(p.margin_held);
    if (isMarginAsset(p.asset_class)) {
      maintenanceTotal += maintenanceMarginFor(ref, mark.price, Number(p.shares));
    }
    return {
      id: p.id,
      comboId: p.combo_id ?? undefined,
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

  // Option collateral is reserved per strategy (combo), not per leg. Group the
  // option legs (and any stock leg that's part of a combo) and reserve max loss.
  const comboGroups = new Map<string, PositionRow[]>();
  for (const p of posRows) {
    if (p.asset_class === "OPTION" || (p.asset_class === "STOCK" && p.combo_id)) {
      const key = p.combo_id ?? `solo:${p.id}`;
      const arr = comboGroups.get(key) ?? [];
      arr.push(p);
      comboGroups.set(key, arr);
    }
  }
  for (const legsRows of comboGroups.values()) {
    const legs = legsRows.map(rowToMathLeg);
    const spotProxy = Math.max(1, ...legs.map((l) => l.strike));
    const m = comboMarginUsd(legs, spotProxy);
    marginUsed += m;
    maintenanceTotal += m;   // defined-risk: you can't lose more than the reserve
  }

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
    competitionAccounts,
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
    // Close toward zero: a long is sold, a short is bought back (worthless = $0,
    // so a short option that expires OTM keeps the full premium). Side-aware
    // exit price; never liquidity-guarded — a forced expiry must always settle.
    const closeSide: Side = pos.direction === "LONG" ? "SELL" : "BUY";
    const priced = await priceInstrumentForFill(ref, closeSide);
    const closePrice = priced?.price ?? 0;

    const account = await resolveAccount(db, userId, pos.account_id);
    try {
      await executeFill(db, account, ref, closeSide, Number(pos.shares), closePrice, pos.combo_id ?? undefined);
      count++;
    } catch {
      // If the fill fails, delete the position so it doesn't linger.
      await db.from("paper_positions").delete().eq("id", pos.id);
      count++;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return count;
}

/* ─── Multi-leg option combos (open + close as one strategy) ─── */

export interface ComboLegInput {
  ref: InstrumentRef;       // OPTION or STOCK
  side: Side;               // BUY (long) / SELL (short) to OPEN
  qty: number;
}

export interface ComboResult {
  comboId: string;
  legs: { symbol: string; side: Side; qty: number; price: number }[];
  margin: number;
  netCost: number;          // >0 net debit paid, <0 net credit received
}

/**
 * Open a multi-leg strategy atomically-ish: prices every leg live, validates the
 * whole combo's buying-power need (net debit + reserved max-loss collateral) up
 * front, then fills each leg tagged with one combo_id. Throws before any fill if
 * the combo can't be priced or afforded.
 */
export async function openCombo(
  db: DB,
  account: AccountRow,
  legInputs: ComboLegInput[],
  comboId: string
): Promise<ComboResult> {
  if (legInputs.length === 0) throw new Error("No legs to trade.");

  // Price every leg first (side-aware: long legs lift the ask, short legs hit
  // the bid). A combo always OPENS exposure, so every option leg must clear the
  // liquidity guard; bail out before any fill if a leg has no price or is too thin.
  const priced: { input: ComboLegInput; price: number }[] = [];
  for (const input of legInputs) {
    const p = await priceInstrumentForFill(input.ref, input.side);
    if (!p) throw new Error(`No live price for ${instrumentName(input.ref)} — can't fill the strategy.`);
    if (input.ref.assetClass === "OPTION" && p.contract) {
      const a = assessOptionLiquidity(p.contract);
      if (!a.ok) throw new Error(`Can't open ${instrumentName(input.ref)} — ${a.reason}.`);
    }
    priced.push({ input, price: p.price });
    await new Promise((r) => setTimeout(r, 40));
  }

  // Compute net debit/credit and reserved collateral from the live fill prices.
  const mathLegs: MathLeg[] = priced.map(({ input, price }) => ({
    type: input.ref.assetClass === "STOCK" ? "stock" : input.ref.optionType === "CALL" ? "call" : "put",
    side: input.side === "BUY" ? "long" : "short",
    strike: input.ref.assetClass === "STOCK" ? price : Number(input.ref.strike),
    expiry: isoToUnix(input.ref.expiry ?? null),
    qty: input.qty,
    premium: price,
    iv: 0,
  }));
  const netCost = priced.reduce(
    (s, { input, price }) =>
      s + (input.side === "BUY" ? 1 : -1) * price * multiplierFor(input.ref.assetClass, input.ref.symbol) * input.qty,
    0
  );
  const spotProxy = Math.max(1, ...mathLegs.map((l) => l.strike));
  const margin = comboMarginUsd(mathLegs, spotProxy);

  // Buying-power check on the whole combo before any cash moves.
  const { data: acc } = await db.from("paper_accounts").select("*").eq("id", account.id).single();
  const a = acc as AccountRow;
  const buyingPower = Number(a.cash) - Number(a.margin_used);
  const need = Math.max(0, netCost) + margin;
  if (need > buyingPower + EPS) {
    throw new Error(`Insufficient buying power for this strategy: need $${need.toFixed(2)}, have $${buyingPower.toFixed(2)}.`);
  }

  // Fill BUY legs first (cash out) then SELL legs (cash in) so intermediate cash
  // never dips below what the leg-level check allows.
  const ordered = [...priced].sort((x, y) => (x.input.side === y.input.side ? 0 : x.input.side === "BUY" ? -1 : 1));
  const legs: ComboResult["legs"] = [];
  for (const { input, price } of ordered) {
    await executeFill(db, account, input.ref, input.side, input.qty, price, comboId);
    legs.push({ symbol: input.ref.symbol, side: input.side, qty: input.qty, price });
  }

  return { comboId, legs, margin, netCost };
}

/** Close every leg of a combo (or a single tagged leg) at live marks. */
export async function closeCombo(db: DB, userId: string, comboId: string): Promise<{ realized: number; legs: number }> {
  const { data } = await db
    .from("paper_positions")
    .select("*")
    .eq("user_id", userId)
    .eq("combo_id", comboId);
  const rows = (data ?? []) as PositionRow[];
  if (rows.length === 0) return { realized: 0, legs: 0 };

  let realized = 0;
  let closed = 0;
  for (const pos of rows) {
    const ref = rowToRef(pos);
    const closeSide: Side = pos.direction === "LONG" ? "SELL" : "BUY";
    const priced = await priceInstrumentForFill(ref, closeSide);  // side-aware exit; no open-guard on closes
    const closePrice = priced?.price ?? 0;
    const account = await resolveAccount(db, userId, pos.account_id);
    try {
      const r = await executeFill(db, account, ref, closeSide, Number(pos.shares), closePrice, comboId);
      realized += r.realized;
      closed++;
      // Record the closing leg in order history.
      await db.from("paper_orders").insert({
        user_id: userId,
        account_id: pos.account_id,
        combo_id: comboId,
        ticker: ref.symbol,
        asset_class: ref.assetClass,
        symbol: ref.symbol,
        underlying: ref.underlying ?? null,
        expiry: ref.expiry ?? null,
        strike: ref.strike ?? null,
        option_type: ref.optionType ?? null,
        side: closeSide,
        direction: closeSide === "BUY" ? "LONG" : "SHORT",
        shares: Number(pos.shares),
        multiplier: Number(pos.multiplier),
        order_type: "MARKET",
        status: "FILLED",
        price: closePrice,
        filled_at: new Date().toISOString(),
      });
    } catch {
      await db.from("paper_positions").delete().eq("id", pos.id);
      closed++;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return { realized, legs: closed };
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
    // Trigger off the MARK; fill at the side-aware price. priceForOrder also
    // rejects an opening option leg whose contract is too illiquid.
    const mark = await priceInstrument(ref);
    if (!mark) continue;
    if (!isTriggered(o, mark.price)) continue;

    const account = await resolveAccount(db, userId, o.account_id);
    try {
      const fillPrice = await priceForOrder(db, account.id, ref, o.side, Number(o.shares));
      await executeFill(db, account, ref, o.side, Number(o.shares), fillPrice);
      await db.from("paper_orders").update({
        status: "FILLED", price: fillPrice, filled_at: new Date().toISOString(),
      }).eq("id", o.id);
      filled++;
    } catch {
      // Couldn't fill (buying power, or too illiquid to open) — reject so it stops re-trying.
      await db.from("paper_orders").update({ status: "REJECTED" }).eq("id", o.id);
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return filled;
}

/* ─── Equity snapshots (per account, idempotent per day) ─── */
export async function captureSnapshot(db: DB, userId: string): Promise<void> {
  // ALL accounts, including competition sandboxes — their equity curve is what
  // the leaderboard's return + risk-adjusted scores are computed from.
  const accounts = await listAllAccounts(db, userId);
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
