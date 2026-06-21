/**
 * Option strategy presets for the builder. Each preset is a set of leg templates
 * with relative strike rules; `instantiateStrategy` snaps them to real strikes and
 * live premiums from the option chain to produce concrete `Leg`s for the math engine.
 */

import { bsPrice, RISK_FREE, type Leg, type OptionType, type Side } from "./options-math";

/** One strike row of an expiry, as returned by /api/options/chain. */
export interface ChainStrike {
  strike: number;
  callBid: number;
  callAsk: number;
  callIV: number; // decimal
  callOI: number;
  putBid: number;
  putAsk: number;
  putIV: number; // decimal
  putOI: number;
  // Optional day volume — surfaced by the chain explorer; ignored by the math engine.
  callVol?: number;
  putVol?: number;
}

export type StrategyCategory = "Single" | "Vertical" | "Volatility" | "Advanced";

type StrikeRule = "atm" | { steps: number } | { pctOTM: number };

interface LegTemplate {
  type: OptionType;
  side: Side;
  strikeRule: StrikeRule;
  /** Contracts (options) or round-lots×100 shares (stock) per 1 unit of size. */
  qtyRatio: number;
}

export interface StrategyDef {
  id: string;
  name: string;
  category: StrategyCategory;
  description: string;
  legs: LegTemplate[];
}

export const STRATEGIES: StrategyDef[] = [
  // ── Single ──
  { id: "long-call", name: "Long Call", category: "Single",
    description: "Bullish. Unlimited upside, risk capped at the premium paid.",
    legs: [{ type: "call", side: "long", strikeRule: "atm", qtyRatio: 1 }] },
  { id: "long-put", name: "Long Put", category: "Single",
    description: "Bearish. Profits as the stock falls, risk capped at the premium.",
    legs: [{ type: "put", side: "long", strikeRule: "atm", qtyRatio: 1 }] },
  { id: "covered-call", name: "Covered Call", category: "Single",
    description: "Own 100 shares and sell an OTM call for income; caps upside.",
    legs: [
      { type: "stock", side: "long", strikeRule: "atm", qtyRatio: 100 },
      { type: "call", side: "short", strikeRule: { steps: 2 }, qtyRatio: 1 },
    ] },
  { id: "cash-secured-put", name: "Cash-Secured Put", category: "Single",
    description: "Sell an OTM put to collect premium / buy the stock lower.",
    legs: [{ type: "put", side: "short", strikeRule: { steps: -2 }, qtyRatio: 1 }] },

  // ── Vertical ──
  { id: "bull-call-spread", name: "Bull Call Spread", category: "Vertical",
    description: "Debit spread. Bullish with capped profit and capped risk.",
    legs: [
      { type: "call", side: "long", strikeRule: "atm", qtyRatio: 1 },
      { type: "call", side: "short", strikeRule: { steps: 2 }, qtyRatio: 1 },
    ] },
  { id: "bear-put-spread", name: "Bear Put Spread", category: "Vertical",
    description: "Debit spread. Bearish with capped profit and capped risk.",
    legs: [
      { type: "put", side: "long", strikeRule: "atm", qtyRatio: 1 },
      { type: "put", side: "short", strikeRule: { steps: -2 }, qtyRatio: 1 },
    ] },
  { id: "bull-put-spread", name: "Bull Put Spread", category: "Vertical",
    description: "Credit spread. Mildly bullish; collect premium above the short put.",
    legs: [
      { type: "put", side: "short", strikeRule: { steps: -1 }, qtyRatio: 1 },
      { type: "put", side: "long", strikeRule: { steps: -3 }, qtyRatio: 1 },
    ] },
  { id: "bear-call-spread", name: "Bear Call Spread", category: "Vertical",
    description: "Credit spread. Mildly bearish; collect premium below the short call.",
    legs: [
      { type: "call", side: "short", strikeRule: { steps: 1 }, qtyRatio: 1 },
      { type: "call", side: "long", strikeRule: { steps: 3 }, qtyRatio: 1 },
    ] },

  // ── Volatility ──
  { id: "long-straddle", name: "Long Straddle", category: "Volatility",
    description: "Buy an ATM call + put. Profits on a big move either direction.",
    legs: [
      { type: "call", side: "long", strikeRule: "atm", qtyRatio: 1 },
      { type: "put", side: "long", strikeRule: "atm", qtyRatio: 1 },
    ] },
  { id: "long-strangle", name: "Long Strangle", category: "Volatility",
    description: "Buy an OTM call + put. Cheaper than a straddle, needs a bigger move.",
    legs: [
      { type: "call", side: "long", strikeRule: { pctOTM: 0.05 }, qtyRatio: 1 },
      { type: "put", side: "long", strikeRule: { pctOTM: 0.05 }, qtyRatio: 1 },
    ] },

  // ── Advanced ──
  { id: "iron-condor", name: "Iron Condor", category: "Advanced",
    description: "Sell an OTM put spread + call spread. Profits if price stays range-bound.",
    legs: [
      { type: "put", side: "long", strikeRule: { steps: -4 }, qtyRatio: 1 },
      { type: "put", side: "short", strikeRule: { steps: -2 }, qtyRatio: 1 },
      { type: "call", side: "short", strikeRule: { steps: 2 }, qtyRatio: 1 },
      { type: "call", side: "long", strikeRule: { steps: 4 }, qtyRatio: 1 },
    ] },
  { id: "long-call-butterfly", name: "Long Call Butterfly", category: "Advanced",
    description: "Long 1 ITM + short 2 ATM + long 1 OTM call. Peaks if price pins the middle.",
    legs: [
      { type: "call", side: "long", strikeRule: { steps: -2 }, qtyRatio: 1 },
      { type: "call", side: "short", strikeRule: "atm", qtyRatio: 2 },
      { type: "call", side: "long", strikeRule: { steps: 2 }, qtyRatio: 1 },
    ] },
];

export function strategyById(id: string): StrategyDef | undefined {
  return STRATEGIES.find((s) => s.id === id);
}

/* ─── Chain helpers ─── */

const sortStrikes = (chain: ChainStrike[]) => [...chain].sort((a, b) => a.strike - b.strike);

function atmIndex(strikes: ChainStrike[], spot: number): number {
  let best = 0;
  let bestD = Infinity;
  strikes.forEach((s, i) => {
    const d = Math.abs(s.strike - spot);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

const clamp = (i: number, n: number) => Math.max(0, Math.min(n - 1, i));

function resolveStrike(rule: StrikeRule, type: OptionType, strikes: ChainStrike[], spot: number): ChainStrike {
  const atm = atmIndex(strikes, spot);
  if (rule === "atm") return strikes[atm];
  if ("steps" in rule) return strikes[clamp(atm + rule.steps, strikes.length)];
  // pctOTM: move away from spot in the option's OTM direction.
  const target = type === "put" ? spot * (1 - rule.pctOTM) : spot * (1 + rule.pctOTM);
  return strikes.reduce((a, b) => (Math.abs(b.strike - target) < Math.abs(a.strike - target) ? b : a));
}

/** Mid price for a type at a strike row, with a Black-Scholes fallback for illiquid quotes. */
function premiumFor(row: ChainStrike, type: "call" | "put", spot: number, expiry: number): { premium: number; iv: number } {
  const bid = type === "call" ? row.callBid : row.putBid;
  const ask = type === "call" ? row.callAsk : row.putAsk;
  const iv = (type === "call" ? row.callIV : row.putIV) || 0.3;
  let mid = (bid + ask) / 2;
  if (!(mid > 0)) {
    const T = Math.max((expiry - Date.now() / 1000) / (365 * 86400), 0);
    mid = bsPrice({ type, S: spot, K: row.strike, T, r: RISK_FREE, sigma: iv });
  }
  return { premium: Math.max(parseFloat(mid.toFixed(2)), 0.01), iv };
}

/** Build a concrete option/stock Leg from a chosen strike row (also used by the leg editor on edit). */
export function buildLeg(
  type: OptionType,
  side: Side,
  row: ChainStrike,
  qty: number,
  spot: number,
  expiry: number
): Leg {
  if (type === "stock") {
    return { type, side, strike: spot, expiry: 0, qty, premium: spot, iv: 0 };
  }
  const { premium, iv } = premiumFor(row, type, spot, expiry);
  return { type, side, strike: row.strike, expiry, qty, premium, iv };
}

/** Turn a strategy preset into concrete legs against the live chain. */
export function instantiateStrategy(
  def: StrategyDef,
  chain: ChainStrike[],
  spot: number,
  expiry: number,
  size = 1
): Leg[] {
  const strikes = sortStrikes(chain);
  if (strikes.length === 0) return [];
  return def.legs.map((t) => {
    const row = resolveStrike(t.strikeRule, t.type, strikes, spot);
    return buildLeg(t.type, t.side, row, t.qtyRatio * size, spot, expiry);
  });
}

/**
 * Best-effort recognition of a freely-built leg set into a named strategy — used
 * by the click-to-build mode to label a position as you assemble it (e.g. a long
 * call + long put at the same strike → "Long Straddle"). Matches by structure
 * (types, sides, strike ordering); falls back to a generic descriptor.
 */
export function recognizeStrategy(legs: Leg[]): string | null {
  const opt = legs.filter((l) => l.type !== "stock");
  const stock = legs.filter((l) => l.type === "stock");
  if (opt.length === 0 && stock.length === 0) return null;
  if (opt.length === 0) return stock[0].side === "long" ? "Long Stock" : "Short Stock";

  const calls = opt.filter((l) => l.type === "call").sort((a, b) => a.strike - b.strike);
  const puts = opt.filter((l) => l.type === "put").sort((a, b) => a.strike - b.strike);
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const sorted = [...opt].sort((a, b) => a.strike - b.strike);

  // Stock + one option.
  if (stock.length === 1 && opt.length === 1) {
    const o = opt[0];
    if (stock[0].side === "long" && o.type === "call" && o.side === "short") return "Covered Call";
    if (stock[0].side === "long" && o.type === "put" && o.side === "long") return "Protective Put";
  }

  if (stock.length === 0) {
    if (opt.length === 1) {
      const o = opt[0];
      if (o.type === "call") return o.side === "long" ? "Long Call" : "Short Call";
      return o.side === "long" ? "Long Put" : "Short Put";
    }

    if (opt.length === 2) {
      const [a, b] = sorted; // a = lower strike
      // 1 call + 1 put.
      if (calls.length === 1 && puts.length === 1) {
        if (a.side === b.side) {
          const same = eq(a.strike, b.strike);
          if (a.side === "long") return same ? "Long Straddle" : "Long Strangle";
          return same ? "Short Straddle" : "Short Strangle";
        }
        // Opposite sides.
        if (eq(a.strike, b.strike)) return calls[0].side === "long" ? "Synthetic Long" : "Synthetic Short";
        return "Risk Reversal";
      }
      // Vertical spreads — two calls.
      if (calls.length === 2 && a.side !== b.side) return a.side === "long" ? "Bull Call Spread" : "Bear Call Spread";
      // Vertical spreads — two puts (label by the higher-strike leg).
      if (puts.length === 2 && a.side !== b.side) return b.side === "short" ? "Bull Put Spread" : "Bear Put Spread";
    }

    // Four legs: iron condor / iron butterfly.
    if (opt.length === 4 && calls.length === 2 && puts.length === 2) {
      const iron =
        puts[0].side === "long" && puts[1].side === "short" &&
        calls[0].side === "short" && calls[1].side === "long";
      if (iron) return eq(puts[1].strike, calls[0].strike) ? "Iron Butterfly" : "Iron Condor";
    }
  }

  // Generic fallback by composition.
  const n = legs.length;
  if (calls.length && !puts.length && !stock.length) return `Call combo · ${n} legs`;
  if (puts.length && !calls.length && !stock.length) return `Put combo · ${n} legs`;
  return `Custom · ${n} legs`;
}
