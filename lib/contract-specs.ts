/**
 * Contract specifications and margin/notional math for the paper-trading engine.
 *
 * Margin model (simplified but directionally realistic — clearly labeled as a sim):
 *  - STOCK  : cash-settled, long-only. Margin held = 0 (notional paid from cash).
 *  - OPTION : cash-settled, long-only (buy-to-open). Premium paid from cash, ×100.
 *  - FUTURE : long/short on margin. Initial margin per contract held; MTM accrues.
 *  - FOREX  : long/short on margin. Margin = USD notional / leverage.
 */

import type { AssetClass, Direction, InstrumentRef } from "./paper-types";

export const OPTION_MULTIPLIER = 100;
export const FOREX_LEVERAGE = 50;     // 50:1
export const FOREX_STANDARD_LOT = 100_000;

export interface FuturesSpec {
  symbol: string;
  name: string;
  category: string;
  multiplier: number;        // $ per 1.00 price move per contract
  initialMargin: number;     // USD per contract
  maintenanceMargin: number; // USD per contract
}

/** Yahoo futures symbols → contract specs. Margins are representative round numbers. */
export const FUTURES_SPECS: Record<string, FuturesSpec> = {
  // Energy
  "CL=F": { symbol: "CL=F", name: "WTI Crude",    category: "Energy", multiplier: 1000,  initialMargin: 6000,  maintenanceMargin: 5400 },
  "BZ=F": { symbol: "BZ=F", name: "Brent Crude",  category: "Energy", multiplier: 1000,  initialMargin: 6000,  maintenanceMargin: 5400 },
  "NG=F": { symbol: "NG=F", name: "Nat Gas",      category: "Energy", multiplier: 10000, initialMargin: 3500,  maintenanceMargin: 3000 },
  "RB=F": { symbol: "RB=F", name: "Gasoline",     category: "Energy", multiplier: 42000, initialMargin: 7000,  maintenanceMargin: 6300 },
  "HO=F": { symbol: "HO=F", name: "Heating Oil",  category: "Energy", multiplier: 42000, initialMargin: 7000,  maintenanceMargin: 6300 },
  // Metals
  "GC=F": { symbol: "GC=F", name: "Gold",         category: "Metals", multiplier: 100,   initialMargin: 11000, maintenanceMargin: 10000 },
  "SI=F": { symbol: "SI=F", name: "Silver",       category: "Metals", multiplier: 5000,  initialMargin: 16000, maintenanceMargin: 14500 },
  "HG=F": { symbol: "HG=F", name: "Copper",       category: "Metals", multiplier: 25000, initialMargin: 6000,  maintenanceMargin: 5400 },
  "PL=F": { symbol: "PL=F", name: "Platinum",     category: "Metals", multiplier: 50,    initialMargin: 4000,  maintenanceMargin: 3600 },
  "PA=F": { symbol: "PA=F", name: "Palladium",    category: "Metals", multiplier: 100,   initialMargin: 9000,  maintenanceMargin: 8100 },
  // Indices
  "ES=F":  { symbol: "ES=F",  name: "S&P 500",      category: "Indices", multiplier: 50, initialMargin: 13200, maintenanceMargin: 12000 },
  "NQ=F":  { symbol: "NQ=F",  name: "Nasdaq 100",   category: "Indices", multiplier: 20, initialMargin: 19000, maintenanceMargin: 17000 },
  "YM=F":  { symbol: "YM=F",  name: "Dow",          category: "Indices", multiplier: 5,  initialMargin: 9500,  maintenanceMargin: 8600 },
  "RTY=F": { symbol: "RTY=F", name: "Russell 2000", category: "Indices", multiplier: 50, initialMargin: 7000,  maintenanceMargin: 6300 },
  // Rates
  "ZB=F": { symbol: "ZB=F", name: "30Y T-Bond",  category: "Rates", multiplier: 1000, initialMargin: 4500, maintenanceMargin: 4000 },
  "ZN=F": { symbol: "ZN=F", name: "10Y T-Note",  category: "Rates", multiplier: 1000, initialMargin: 2000, maintenanceMargin: 1800 },
  "ZF=F": { symbol: "ZF=F", name: "5Y T-Note",   category: "Rates", multiplier: 1000, initialMargin: 1300, maintenanceMargin: 1150 },
  "ZT=F": { symbol: "ZT=F", name: "2Y T-Note",   category: "Rates", multiplier: 2000, initialMargin: 1000, maintenanceMargin: 900 },
  // Agriculture
  "ZC=F": { symbol: "ZC=F", name: "Corn",     category: "Agriculture", multiplier: 50,    initialMargin: 2000,  maintenanceMargin: 1800 },
  "ZW=F": { symbol: "ZW=F", name: "Wheat",    category: "Agriculture", multiplier: 50,    initialMargin: 2700,  maintenanceMargin: 2400 },
  "ZS=F": { symbol: "ZS=F", name: "Soybeans", category: "Agriculture", multiplier: 50,    initialMargin: 3500,  maintenanceMargin: 3150 },
  "KC=F": { symbol: "KC=F", name: "Coffee",   category: "Agriculture", multiplier: 37500, initialMargin: 12000, maintenanceMargin: 10800 },
  "SB=F": { symbol: "SB=F", name: "Sugar",    category: "Agriculture", multiplier: 1120,  initialMargin: 1500,  maintenanceMargin: 1350 },
  "CT=F": { symbol: "CT=F", name: "Cotton",   category: "Agriculture", multiplier: 500,   initialMargin: 3000,  maintenanceMargin: 2700 },
};

export interface ForexSpec {
  symbol: string;   // canonical, e.g. "EURUSD"
  name: string;
  usdBase: boolean; // true when USD is the BASE currency (USDJPY) vs quote (EURUSD)
}

/** Curated major FX pairs. `symbol` is canonical; Yahoo wants `${symbol}=X`. */
export const FOREX_SPECS: Record<string, ForexSpec> = {
  EURUSD: { symbol: "EURUSD", name: "Euro / US Dollar",        usdBase: false },
  GBPUSD: { symbol: "GBPUSD", name: "British Pound / US Dollar", usdBase: false },
  AUDUSD: { symbol: "AUDUSD", name: "Australian / US Dollar",  usdBase: false },
  NZDUSD: { symbol: "NZDUSD", name: "NZ / US Dollar",          usdBase: false },
  USDJPY: { symbol: "USDJPY", name: "US Dollar / Yen",         usdBase: true },
  USDCHF: { symbol: "USDCHF", name: "US Dollar / Swiss Franc", usdBase: true },
  USDCAD: { symbol: "USDCAD", name: "US Dollar / Canadian",    usdBase: true },
};

/** Per-unit/contract multiplier for an instrument. */
export function multiplierFor(assetClass: AssetClass, symbol: string): number {
  switch (assetClass) {
    case "STOCK": return 1;
    case "OPTION": return OPTION_MULTIPLIER;
    case "FUTURE": return FUTURES_SPECS[symbol]?.multiplier ?? 1;
    case "FOREX": return 1;
  }
}

/** USD notional exposure of a position/order. */
export function notionalUsd(ref: InstrumentRef, price: number, qty: number): number {
  switch (ref.assetClass) {
    case "STOCK":  return qty * price;
    case "OPTION": return qty * price * OPTION_MULTIPLIER;
    case "FUTURE": return qty * price * (FUTURES_SPECS[ref.symbol]?.multiplier ?? 1);
    case "FOREX": {
      const spec = FOREX_SPECS[ref.symbol];
      // usdBase pair (USDJPY): qty is already USD. Else (EURUSD): qty × rate = USD.
      return spec?.usdBase ? qty : qty * price;
    }
  }
}

/**
 * Margin reserved when opening. STOCK/OPTION are paid in full (handled as cash
 * outflow, not margin); this returns the amount to *hold* against buying power.
 */
export function initialMarginFor(ref: InstrumentRef, price: number, qty: number): number {
  switch (ref.assetClass) {
    case "STOCK":
    case "OPTION":
      return 0;
    case "FUTURE":
      return (FUTURES_SPECS[ref.symbol]?.initialMargin ?? 0) * qty;
    case "FOREX":
      return notionalUsd(ref, price, qty) / FOREX_LEVERAGE;
  }
}

/** Maintenance margin — the floor below which a margin call triggers. */
export function maintenanceMarginFor(ref: InstrumentRef, price: number, qty: number): number {
  switch (ref.assetClass) {
    case "STOCK":
    case "OPTION":
      return 0;
    case "FUTURE":
      return (FUTURES_SPECS[ref.symbol]?.maintenanceMargin ?? 0) * qty;
    case "FOREX":
      return notionalUsd(ref, price, qty) / FOREX_LEVERAGE / 2;
  }
}

/**
 * USD unrealized/realized P/L for a directional position.
 * entry/exit are per-unit prices; qty is contracts/shares/units.
 */
export function pnlUsd(
  ref: InstrumentRef,
  direction: Direction,
  entry: number,
  exit: number,
  qty: number
): number {
  const sign = direction === "LONG" ? 1 : -1;
  switch (ref.assetClass) {
    case "STOCK":  return sign * (exit - entry) * qty;
    case "OPTION": return sign * (exit - entry) * qty * OPTION_MULTIPLIER;
    case "FUTURE": return sign * (exit - entry) * qty * (FUTURES_SPECS[ref.symbol]?.multiplier ?? 1);
    case "FOREX": {
      const spec = FOREX_SPECS[ref.symbol];
      // usdBase pair: P/L is in quote ccy → convert to USD at the exit rate.
      const raw = sign * (exit - entry) * qty;
      return spec?.usdBase ? raw / exit : raw;
    }
  }
}

/** Whether shorting is allowed for an asset class in this sim. */
export function shortAllowed(assetClass: AssetClass): boolean {
  return assetClass === "FUTURE" || assetClass === "FOREX";
}
