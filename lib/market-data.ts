/**
 * Mock data for the Market Summary tab — indices, movers, most active, and
 * earnings. Deterministic (no Math.random/new Date at module scope).
 * Replace with a real market-data feed later.
 */

export interface IndexQuote {
  symbol: string;
  name: string;
  value: number;
  changePct: number;
}

export const INDICES: IndexQuote[] = [
  { symbol: "SPX",  name: "S&P 500",      value: 5487.03, changePct:  0.62 },
  { symbol: "IXIC", name: "Nasdaq Comp.",  value: 17862.4, changePct:  0.94 },
  { symbol: "DJI",  name: "Dow Jones",     value: 38921.1, changePct:  0.21 },
  { symbol: "RUT",  name: "Russell 2000",  value: 2034.55, changePct: -0.43 },
  { symbol: "VIX",  name: "Volatility",    value: 13.42,   changePct: -3.10 },
];

export interface Mover {
  ticker: string;
  name: string;
  price: number;
  changePct: number;
}

export const GAINERS: Mover[] = [
  { ticker: "SMCI", name: "Super Micro Computer", price: 48.20,  changePct: 11.4 },
  { ticker: "PLTR", name: "Palantir Tech.",       price: 28.65,  changePct:  8.9 },
  { ticker: "COIN", name: "Coinbase Global",      price: 245.10, changePct:  7.2 },
  { ticker: "ANET", name: "Arista Networks",      price: 372.40, changePct:  5.8 },
  { ticker: "MU",   name: "Micron Technology",    price: 118.90, changePct:  4.6 },
];

export const LOSERS: Mover[] = [
  { ticker: "LULU", name: "Lululemon Athletica",  price: 312.05, changePct: -9.3 },
  { ticker: "ENPH", name: "Enphase Energy",       price: 102.40, changePct: -6.7 },
  { ticker: "TSLA", name: "Tesla Inc.",           price: 178.30, changePct: -5.1 },
  { ticker: "PYPL", name: "PayPal Holdings",      price: 62.15,  changePct: -3.9 },
  { ticker: "NKE",  name: "Nike Inc.",            price: 74.80,  changePct: -3.2 },
];

export interface ActiveStock extends Mover {
  volume: string;
}

export const MOST_ACTIVE: ActiveStock[] = [
  { ticker: "NVDA", name: "NVIDIA Corp.",   price: 874.60, changePct: -1.4, volume: "412M" },
  { ticker: "AAPL", name: "Apple Inc.",     price: 195.50, changePct:  0.8, volume: "298M" },
  { ticker: "TSLA", name: "Tesla Inc.",     price: 178.30, changePct: -5.1, volume: "276M" },
  { ticker: "AMD",  name: "Adv. Micro Dev.", price: 162.40, changePct:  2.1, volume: "201M" },
  { ticker: "F",    name: "Ford Motor",     price: 12.18,  changePct:  0.5, volume: "188M" },
];

export interface EarningsRow {
  ticker: string;
  name: string;
  date: string;       // "Jun 13"
  when: "BMO" | "AMC";
  epsEst: number;
  /** present once reported */
  epsActual?: number;
}

export const UPCOMING_EARNINGS: EarningsRow[] = [
  { ticker: "ADBE", name: "Adobe Inc.",       date: "Jun 13", when: "AMC", epsEst: 4.39 },
  { ticker: "ORCL", name: "Oracle Corp.",     date: "Jun 13", when: "AMC", epsEst: 1.65 },
  { ticker: "KR",   name: "Kroger Co.",       date: "Jun 16", when: "BMO", epsEst: 1.34 },
  { ticker: "DRI",  name: "Darden Rest.",     date: "Jun 18", when: "BMO", epsEst: 2.61 },
  { ticker: "ACN",  name: "Accenture plc",    date: "Jun 20", when: "BMO", epsEst: 3.42 },
];

export const RECENT_EARNINGS: EarningsRow[] = [
  { ticker: "AVGO", name: "Broadcom Inc.",    date: "Jun 12", when: "AMC", epsEst: 10.84, epsActual: 11.12 },
  { ticker: "COST", name: "Costco Wholesale", date: "Jun 11", when: "AMC", epsEst: 3.70,  epsActual: 3.78 },
  { ticker: "DG",   name: "Dollar General",   date: "Jun 11", when: "BMO", epsEst: 1.58,  epsActual: 1.65 },
  { ticker: "GME",  name: "GameStop Corp.",   date: "Jun 10", when: "AMC", epsEst: -0.09, epsActual: -0.12 },
];
