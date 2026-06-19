export type AccountType = string;

export interface Holding {
  id: string;
  ticker: string;
  name: string;
  sector: string;
  shares: number;
  costBasis: number;
  currentPrice: number;
  account: AccountType;
  notes?: string;
  /* Dividend handling: true = reinvest (DRIP), false = pay to cash. */
  drip?: boolean;
}

export type SortField =
  | "ticker"
  | "name"
  | "sector"
  | "shares"
  | "value"
  | "gainDollar"
  | "gainPercent";

export type SortDir = "asc" | "desc";

export interface SortState {
  field: SortField;
  dir: SortDir;
}

export interface HoldingWithMetrics extends Holding {
  value: number;
  costTotal: number;
  gainDollar: number;
  gainPercent: number;
  todayChangePct: number;
}

export interface Quote {
  ticker: string;
  price: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
}

export function computeMetrics(h: Holding, todayChangePct = 0): HoldingWithMetrics {
  const value = h.shares * h.currentPrice;
  const costTotal = h.shares * h.costBasis;
  const gainDollar = value - costTotal;
  const gainPercent = costTotal > 0 ? (gainDollar / costTotal) * 100 : 0;
  return { ...h, value, costTotal, gainDollar, gainPercent, todayChangePct };
}
