/**
 * Unified pricing for the paper-trading engine. One entry point —
 * `priceInstrument(ref)` — routes to the right data source per asset class.
 */

import { fetchQuote } from "./finnhub";
import { yahooQuote, fetchOptionChain, type YahooContract } from "./yahoo";
import type { InstrumentRef, OptionType } from "./paper-types";

export interface PricedInstrument {
  price: number;
  livePrice: boolean;
}

/** Mid price of a contract, falling back to last traded. */
export function optionMark(c: YahooContract): number {
  const bid = c.bid ?? 0;
  const ask = c.ask ?? 0;
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  return c.lastPrice ?? 0;
}

/** Resolve a single option's mark from underlying/expiry/strike/type. */
export async function priceOption(
  underlying: string,
  expiry: string,           // ISO YYYY-MM-DD
  strike: number,
  optionType: OptionType
): Promise<number | null> {
  // First fetch gives us the list of expirations.
  const base = await fetchOptionChain(underlying);
  const want = expiry;
  const matchUnix = base.expirationDates.find(
    (u) => new Date(u * 1000).toISOString().slice(0, 10) === want
  );
  if (!matchUnix) return null;

  const chain =
    new Date(base.expirationDates[0] * 1000).toISOString().slice(0, 10) === want
      ? base
      : await fetchOptionChain(underlying, matchUnix);

  const list = optionType === "CALL" ? chain.calls : chain.puts;
  const contract = list.find((c) => Math.abs(c.strike - strike) < 1e-6);
  if (!contract) return null;
  const mark = optionMark(contract);
  return mark > 0 ? mark : null;
}

/** Price any instrument. Returns null only if no source had a usable quote. */
export async function priceInstrument(ref: InstrumentRef): Promise<PricedInstrument | null> {
  switch (ref.assetClass) {
    case "STOCK": {
      const q = await fetchQuote(ref.symbol);
      return q ? { price: q.price, livePrice: true } : null;
    }
    case "FUTURE": {
      const q = await yahooQuote(ref.symbol);
      return q ? { price: q.price, livePrice: true } : null;
    }
    case "FOREX": {
      const q = await yahooQuote(`${ref.symbol}=X`);
      return q ? { price: q.price, livePrice: true } : null;
    }
    case "OPTION": {
      if (!ref.underlying || !ref.expiry || ref.strike == null || !ref.optionType) return null;
      const mark = await priceOption(ref.underlying, ref.expiry, ref.strike, ref.optionType);
      return mark != null ? { price: mark, livePrice: true } : null;
    }
  }
}

/** Price several instruments with a small stagger to stay under rate limits. */
export async function priceMany(refs: InstrumentRef[]): Promise<Map<string, PricedInstrument>> {
  const out = new Map<string, PricedInstrument>();
  for (const ref of refs) {
    const p = await priceInstrument(ref);
    if (p) out.set(ref.symbol, p);
    await new Promise((r) => setTimeout(r, 50));
  }
  return out;
}
