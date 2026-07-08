/**
 * Unified pricing for the paper-trading engine. One entry point —
 * `priceInstrument(ref)` — routes to the right data source per asset class.
 *
 * Two flavors of option price:
 *  - `optionMark` (mid) is used to MARK open positions to market.
 *  - `optionFillPrice` (side-aware: buy→ask, sell→bid, + slippage) is used to
 *    FILL orders, via `priceInstrumentForFill`. Crossing the spread on every
 *    fill — plus a liquidity guard on opens — kills the "buy a thin contract at a
 *    stale mid and book an instant markup" exploit that competitions invite.
 */

import { fetchQuote } from "./finnhub";
import { yahooQuote, fetchOptionChain, type YahooContract } from "./yahoo";
import { mapLimit } from "./async";
import type { InstrumentRef, OptionType, Side } from "./paper-types";

export interface PricedInstrument {
  price: number;
  livePrice: boolean;
  prevClose?: number;   // prior session close — absent for options (chains carry no close)
}

/* ─── Options liquidity hardening ─── */

/** Tunable guards for opening an option fill (see `assessOptionLiquidity`). */
export const OPT_LIQ = {
  // Reject if (ask−bid)/mid exceeds this. Kept tight (25%) so the mid we MARK
  // positions at is always close to a real tradeable price — a very wide market
  // lets the "fantasy mid" overstate equity (and thus leaderboard rank).
  MAX_SPREAD_PCT: 0.25,
  SLIPPAGE_PCT: 0.01,    // extra adverse slippage applied on top of bid/ask
};

export interface OptionLiquidity {
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  twoSided: boolean;          // both bid and ask quoted
  spreadPct: number | null;   // (ask−bid)/mid, null when not two-sided
}

export function contractLiquidity(c: YahooContract): OptionLiquidity {
  const bid = c.bid ?? 0;
  const ask = c.ask ?? 0;
  const twoSided = bid > 0 && ask > 0;
  const mid = twoSided ? (bid + ask) / 2 : 0;
  return {
    bid,
    ask,
    volume: c.volume ?? 0,
    openInterest: c.openInterest ?? 0,
    twoSided,
    spreadPct: twoSided && mid > 0 ? (ask - bid) / mid : null,
  };
}

/** Mid price of a contract, falling back to last traded. Used to MARK positions. */
export function optionMark(c: YahooContract): number {
  const bid = c.bid ?? 0;
  const ask = c.ask ?? 0;
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  return c.lastPrice ?? 0;
}

/**
 * Side-aware FILL price: a BUY lifts the ask, a SELL hits the bid, then an extra
 * slippage nudge against you. Falls back to mid/last (with slippage) only when
 * the contract isn't two-sided — opens are separately blocked by the guard.
 */
export function optionFillPrice(c: YahooContract, side: Side, slippagePct = OPT_LIQ.SLIPPAGE_PCT): number {
  const bid = c.bid ?? 0;
  const ask = c.ask ?? 0;
  const adverse = side === "BUY" ? 1 + slippagePct : 1 - slippagePct;
  if (bid > 0 && ask > 0) {
    const base = side === "BUY" ? ask : bid;
    return Math.max(0, base * adverse);
  }
  const fallback = c.lastPrice ?? 0;
  return Math.max(0, fallback * adverse);
}

/** Whether an option contract is liquid enough to OPEN a position in. */
export function assessOptionLiquidity(c: YahooContract): { ok: boolean; reason?: string } {
  const L = contractLiquidity(c);
  if (!L.twoSided) return { ok: false, reason: "no two-sided market (missing bid/ask)" };
  if (L.openInterest < 1 && L.volume < 1) return { ok: false, reason: "no liquidity (0 open interest and 0 volume)" };
  if (L.spreadPct != null && L.spreadPct > OPT_LIQ.MAX_SPREAD_PCT) {
    return { ok: false, reason: `bid/ask spread too wide (${Math.round(L.spreadPct * 100)}%)` };
  }
  return { ok: true };
}

/** Navigate the chain to the one contract matching underlying/expiry/strike/type. */
export async function fetchOptionContract(
  underlying: string,
  expiry: string,           // ISO YYYY-MM-DD
  strike: number,
  optionType: OptionType
): Promise<YahooContract | null> {
  const base = await fetchOptionChain(underlying);
  const matchUnix = base.expirationDates.find(
    (u) => new Date(u * 1000).toISOString().slice(0, 10) === expiry
  );
  if (!matchUnix) return null;

  const chain =
    new Date(base.expirationDates[0] * 1000).toISOString().slice(0, 10) === expiry
      ? base
      : await fetchOptionChain(underlying, matchUnix);

  const list = optionType === "CALL" ? chain.calls : chain.puts;
  return list.find((c) => Math.abs(c.strike - strike) < 1e-6) ?? null;
}

/** Resolve a single option's mark from underlying/expiry/strike/type. */
export async function priceOption(
  underlying: string,
  expiry: string,           // ISO YYYY-MM-DD
  strike: number,
  optionType: OptionType
): Promise<number | null> {
  const contract = await fetchOptionContract(underlying, expiry, strike, optionType);
  if (!contract) return null;
  const mark = optionMark(contract);
  return mark > 0 ? mark : null;
}

/** Price any instrument at its MARK. Returns null only if no source had a usable quote. */
export async function priceInstrument(ref: InstrumentRef): Promise<PricedInstrument | null> {
  switch (ref.assetClass) {
    case "STOCK": {
      const q = await fetchQuote(ref.symbol);
      return q ? { price: q.price, livePrice: true, prevClose: q.prevClose } : null;
    }
    case "FUTURE": {
      const q = await yahooQuote(ref.symbol);
      return q ? { price: q.price, livePrice: true, prevClose: q.prevClose } : null;
    }
    case "FOREX": {
      const q = await yahooQuote(`${ref.symbol}=X`);
      return q ? { price: q.price, livePrice: true, prevClose: q.prevClose } : null;
    }
    case "OPTION": {
      if (!ref.underlying || !ref.expiry || ref.strike == null || !ref.optionType) return null;
      const mark = await priceOption(ref.underlying, ref.expiry, ref.strike, ref.optionType);
      return mark != null ? { price: mark, livePrice: true } : null;
    }
  }
}

export interface FillPrice extends PricedInstrument {
  liquidity?: OptionLiquidity;   // options only
  contract?: YahooContract;      // options only — for the open-time liquidity guard
}

/**
 * Price an instrument for a FILL on a given side. For options this crosses the
 * spread (buy→ask, sell→bid) plus slippage and carries the contract so callers
 * can run `assessOptionLiquidity` before opening. Non-options behave exactly
 * like `priceInstrument` (single consolidated quote, no spread/guard needed).
 */
export async function priceInstrumentForFill(ref: InstrumentRef, side: Side): Promise<FillPrice | null> {
  if (ref.assetClass !== "OPTION") return priceInstrument(ref);
  if (!ref.underlying || !ref.expiry || ref.strike == null || !ref.optionType) return null;
  const contract = await fetchOptionContract(ref.underlying, ref.expiry, ref.strike, ref.optionType);
  if (!contract) return null;
  const price = optionFillPrice(contract, side);
  if (!(price > 0)) return null;
  return { price, livePrice: true, liquidity: contractLiquidity(contract), contract };
}

/** Price several instruments in parallel (bounded concurrency; caches dedupe repeats). */
export async function priceMany(refs: InstrumentRef[]): Promise<Map<string, PricedInstrument>> {
  const out = new Map<string, PricedInstrument>();
  const priced = await mapLimit(refs, 8, (ref) => priceInstrument(ref));
  refs.forEach((ref, i) => {
    const p = priced[i];
    if (p) out.set(ref.symbol, p);
  });
  return out;
}
