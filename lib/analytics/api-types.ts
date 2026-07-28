/* Shared response shapes for the /api/analysis/* endpoints. Tool components
   import these so the client/server contract stays in one place. */

export interface AnalysisAsset {
  ticker: string;
  name: string;
  sector: string;
  /** Total shares held across all accounts (aggregated). */
  shares: number;
  /** Latest close used for valuation. */
  lastClose: number;
  /** Market value = shares × lastClose. */
  value: number;
  /** Weight within the risky (priceable) sleeve, sums to 1 across assets. */
  weight: number;
  /** Weight within total portfolio including cash. */
  weightWithCash: number;
  /** Share-weighted average cost basis per share across accounts. */
  costBasis: number;
  /** Unrealized P/L in dollars = (lastClose − costBasis) × shares. */
  unrealizedPL: number;
  /** Unrealized P/L as a fraction of cost. */
  unrealizedPct: number;
  /** Most recent acquisition date (YYYY-MM-DD) across accounts, or null. */
  acquiredAt: string | null;
}

export interface AnalysisHistoryResponse {
  asOf: string; // YYYY-MM-DD of the latest aligned trading day
  /** Aligned trading dates (ascending) common to all assets + benchmark. */
  dates: string[];
  assets: AnalysisAsset[];
  /** Aligned closes per ticker, indexed to `dates`. */
  closes: Record<string, number[]>;
  /** Daily simple returns per ticker (length dates.length − 1). */
  returns: Record<string, number[]>;
  benchmark: {
    ticker: string;
    closes: number[];
    returns: number[];
  };
  /** Candidate tickers requested via ?extra= that are NOT currently held.
      Their aligned closes/returns live in the `closes`/`returns` maps keyed by
      ticker; this array is just their metadata (+ `start` = the candidate's own
      earliest available date). Empty unless ?extra= was passed. */
  candidates: { ticker: string; name: string; sector: string; start: string }[];
  /** Length of the date window using HOLDINGS ONLY (no candidates) — lets the
      client tell when a short-history candidate shortened the shared window. */
  heldWindowDays: number;
  /** Earliest date of the holdings-only window (YYYY-MM-DD). */
  heldWindowStart: string;
  /** Total cash across cash accounts (0 if the table isn't migrated). */
  cash: number;
  /** Total risky (priceable-asset) market value. */
  riskyValue: number;
  /** Tickers dropped for insufficient history, with reason. */
  excluded: { ticker: string; reason: string }[];
  /** Present when there's nothing to analyze. */
  empty?: boolean;
}

export interface AnalysisFundamental {
  ticker: string;
  name: string | null;
  sector: string;
  shares: number;
  value: number;
  price: number | null;
  marketCap: number | null;
  trailingPE: number | null;
  /** Dividend yield as a fraction (0.0132 = 1.32%). */
  dividendYield: number | null;
  week52Low: number | null;
  week52High: number | null;
  /** Position within the 52-week range [0,1] — a momentum proxy. */
  range52Pos: number | null;
  nextDividend: {
    exDate: string;
    payDate: string | null;
    amountPerShare: number | null;
  } | null;
}

export interface AnalysisFundamentalsResponse {
  asOf: string;
  fundamentals: AnalysisFundamental[];
  riskyValue: number;
  cash: number;
  empty?: boolean;
}

/* ─── Ticker-basket analysis (Optimization / Monte Carlo) ───
   These tools run on a user-chosen basket of tickers, using each ticker's OWN
   multi-month price history — independent of how long the user has held it. */

export interface AnalysisBasketResponse {
  asOf: string;
  /** Aligned trading dates common to every included ticker + benchmark. */
  dates: string[];
  /** Tickers that had usable, aligned history (a subset of what was requested). */
  tickers: { ticker: string; lastClose: number }[];
  closes: Record<string, number[]>;
  returns: Record<string, number[]>;
  benchmark: { ticker: string; closes: number[]; returns: number[] };
  /** Overlapping-window transparency. */
  windowDays: number;
  windowStart: string;
  /** Per-ticker earliest available date (for "X limits the window" hints). */
  starts: Record<string, string>;
  /** Requested tickers dropped for no/short history. */
  excluded: { ticker: string; reason: string }[];
  /** Reference-only tickers (`extra=`) that priced cleanly over the window.
      Their series live in `closes`/`returns` alongside the basket's, but they
      are not part of the basket and never constrain the window. */
  referenced?: string[];
  empty?: boolean;
}

export interface AnalysisPosition {
  ticker: string;
  shares: number;
  price: number;
  value: number;
  /** Weight within the risky (priceable) sleeve, sums to 1 across positions. */
  weight: number;
}

export interface AnalysisPositionsResponse {
  positions: AnalysisPosition[];
  cash: number;
  riskyValue: number;
  totalValue: number;
  /** True when live prices couldn't be fetched (weights fall back to cost basis). */
  pricesStale?: boolean;
  empty?: boolean;
}
