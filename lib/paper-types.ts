/**
 * Shared types for the multi-asset paper trading engine.
 * Used by the pricing layer, the engine, the API routes, and the UI.
 */

export type AssetClass = "STOCK" | "OPTION" | "FUTURE" | "FOREX";
export type Side = "BUY" | "SELL";
export type Direction = "LONG" | "SHORT";
export type OrderType = "MARKET" | "LIMIT" | "STOP";
export type OrderStatus = "PENDING" | "FILLED" | "CANCELLED" | "REJECTED";
export type OptionType = "CALL" | "PUT";

/** Canonical reference to a tradable instrument. */
export interface InstrumentRef {
  assetClass: AssetClass;
  symbol: string;        // canonical: stock ticker / OCC option / "CL=F" / "EURUSD"
  underlying?: string;   // options only
  expiry?: string;       // options only, ISO date (YYYY-MM-DD)
  strike?: number;       // options only
  optionType?: OptionType;
}

/** A position row as returned to the client (marked to market). */
export interface PaperPosition extends InstrumentRef {
  id: string;
  comboId?: string;      // legs of one multi-leg strategy share this
  name: string;
  qty: number;           // shares / contracts / units
  avgCost: number;       // per-unit entry price (premium for options)
  multiplier: number;
  direction: Direction;
  price: number;         // current mark
  marketValue: number;   // long market value (cash assets) — informational
  unrealized: number;    // USD unrealized P/L
  unrealizedPct: number;
  marginHeld: number;    // USD margin reserved (futures/forex)
  livePrice: boolean;
  dayPL: number | null;  // USD P/L vs prior session close (null when no prev close, e.g. options)
  exposure: number;      // |USD notional| at current mark — sizing/allocation weight
}

/** One closing fill from the realized-P/L log. */
export interface RealizedTrade {
  id: string;
  symbol: string;
  assetClass: AssetClass;
  realizedPl: number;
  closedAt: string;
}

/** An order row as returned to the client. */
export interface PaperOrder extends InstrumentRef {
  id: string;
  side: Side;
  direction: Direction;
  qty: number;
  multiplier: number;
  orderType: OrderType;
  limitPrice: number | null;
  stopPrice: number | null;
  price: number | null;  // fill price (null while PENDING)
  status: OrderStatus;
  createdAt: string;
  filledAt: string | null;
}

export interface MarginSummary {
  cash: number;
  startingCash: number;
  positionsValue: number;   // long market value of cash assets
  unrealized: number;       // total unrealized across all positions
  equity: number;           // cash + long value + futures/forex unrealized
  marginUsed: number;
  buyingPower: number;      // cash − marginUsed
  maintenanceMargin: number;
  marginCall: boolean;      // equity < maintenanceMargin
  totalPL: number;          // equity − startingCash
  totalPLPct: number;
}

export interface PaperAccountMeta {
  id: string;
  name: string;
}
