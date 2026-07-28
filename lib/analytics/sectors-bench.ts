/* ──────────────────────────────────────────────────────────────────────────
   S&P 500 sector benchmark scaffolding for attribution.

   Maps the messy sector strings that ride on holdings (Finnhub/Yahoo/manual)
   onto the 11 GICS sectors, each proxied by its SPDR Select Sector ETF, with
   approximate index weights. Weights are a static snapshot (they drift slowly);
   the exact numbers matter far less than the relative tilts they reveal.
   ────────────────────────────────────────────────────────────────────────── */

export interface SpSector {
  name: string;
  etf: string;
  /** Approximate S&P 500 weight (fraction). */
  weight: number;
}

export const SP_SECTORS: SpSector[] = [
  { name: "Information Technology", etf: "XLK", weight: 0.315 },
  { name: "Financials", etf: "XLF", weight: 0.128 },
  { name: "Health Care", etf: "XLV", weight: 0.115 },
  { name: "Consumer Discretionary", etf: "XLY", weight: 0.104 },
  { name: "Communication Services", etf: "XLC", weight: 0.094 },
  { name: "Industrials", etf: "XLI", weight: 0.083 },
  { name: "Consumer Staples", etf: "XLP", weight: 0.057 },
  { name: "Energy", etf: "XLE", weight: 0.036 },
  { name: "Utilities", etf: "XLU", weight: 0.024 },
  { name: "Real Estate", etf: "XLRE", weight: 0.022 },
  { name: "Materials", etf: "XLB", weight: 0.022 },
];

export const OTHER_SECTOR = "Other";

const KEYWORDS: { match: RegExp; name: string }[] = [
  { match: /tech|semiconduct|software|hardware|it services|information/i, name: "Information Technology" },
  { match: /financ|bank|insur|capital market|asset manage/i, name: "Financials" },
  { match: /health|pharma|biotech|medical|life science/i, name: "Health Care" },
  { match: /consumer (cyclical|discretion)|retail|auto|apparel|leisure|hotel|restaurant/i, name: "Consumer Discretionary" },
  { match: /communicat|telecom|media|entertain|interactive/i, name: "Communication Services" },
  { match: /industrial|aerospace|defense|machinery|transport|airlines|construction & eng/i, name: "Industrials" },
  { match: /consumer (defensive|staple)|food|beverage|household|tobacco|grocery/i, name: "Consumer Staples" },
  { match: /energy|oil|gas|petroleum/i, name: "Energy" },
  { match: /utilit|electric|water/i, name: "Utilities" },
  { match: /real estate|reit|property/i, name: "Real Estate" },
  { match: /material|chemical|metal|mining|basic materials/i, name: "Materials" },
];

/** Normalize an arbitrary sector string to a GICS bucket, or "Other". */
export function normalizeSector(raw: string | null | undefined): string {
  if (!raw) return OTHER_SECTOR;
  const s = raw.trim();
  // Exact match first
  const exact = SP_SECTORS.find((x) => x.name.toLowerCase() === s.toLowerCase());
  if (exact) return exact.name;
  for (const k of KEYWORDS) if (k.match.test(s)) return k.name;
  return OTHER_SECTOR;
}

export function etfForSector(name: string): string | null {
  return SP_SECTORS.find((s) => s.name === name)?.etf ?? null;
}
