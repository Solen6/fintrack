/**
 * Shared Yahoo Finance access — used by /api/options/chain, /api/futures-style quotes,
 * and the paper-trading pricing layer (lib/paper-pricing.ts).
 *
 * Two endpoints:
 *  - v8 chart  → spot quote for any symbol (stocks, futures `CL=F`, forex `EURUSD=X`).
 *               No auth needed.
 *  - v7 options → full option chain (per-contract bid/ask/last/IV).
 *               Requires a cookie + crumb handshake.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/* ─── v8 chart: simple spot quote (no auth) ─── */
export interface YahooQuote {
  price: number;
  prevClose: number;
  changePct: number;
  currency?: string;
}

const quoteCache = new Map<string, { data: YahooQuote; ts: number }>();
const QUOTE_TTL = 60_000;

export async function yahooQuote(symbol: string): Promise<YahooQuote | null> {
  const key = symbol.trim().toUpperCase();
  const hit = quoteCache.get(key);
  if (hit && Date.now() - hit.ts < QUOTE_TTL) return hit.data;

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; fintrack/1.0)" },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const price: number | undefined = meta?.regularMarketPrice;
    if (!price) return null;
    const prevClose: number = meta.chartPreviousClose ?? meta.previousClose ?? price;
    const data: YahooQuote = {
      price,
      prevClose,
      changePct: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
      currency: meta.currency,
    };
    quoteCache.set(key, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

/* ─── v8 chart: daily close history (no auth) ───
   One point per US trading day in [from, to], oldest first. Used by the ledger
   derivation engine to value reconstructed holdings on each past date. */
export interface DailyClose { date: string; close: number } // date = YYYY-MM-DD (Eastern)

export async function yahooDailyHistory(
  symbol: string,
  fromUnixSec: number,
  toUnixSec: number,
): Promise<DailyClose[]> {
  const key = symbol.trim().toUpperCase();
  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}` +
      `?interval=1d&period1=${Math.floor(fromUnixSec)}&period2=${Math.floor(toUnixSec)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; fintrack/1.0)" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const timestamps: number[] | undefined = result?.timestamp;
    const closes: (number | null)[] | undefined =
      result?.indicators?.quote?.[0]?.close ??
      result?.indicators?.adjclose?.[0]?.adjclose;
    if (!timestamps || !closes) return [];
    const out: DailyClose[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (c == null) continue;
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
        .format(new Date(timestamps[i] * 1000));
      out.push({ date, close: c });
    }
    return out;
  } catch {
    return [];
  }
}

/* ─── v7 options: cookie + crumb handshake, then chain fetch ─── */
let authCache: { cookie: string; crumb: string; ts: number } | null = null;
const AUTH_TTL = 60 * 60_000;

async function getAuth(force = false): Promise<{ cookie: string; crumb: string }> {
  if (!force && authCache && Date.now() - authCache.ts < AUTH_TTL) return authCache;

  const cookieRes = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA } });
  const setCookies =
    (cookieRes.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");

  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie },
  });
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes("<")) throw new Error("Failed to obtain Yahoo crumb");

  authCache = { cookie, crumb, ts: Date.now() };
  return authCache;
}

export interface YahooContract {
  contractSymbol?: string;
  strike: number;
  lastPrice?: number;
  bid?: number;
  ask?: number;
  impliedVolatility?: number;
  volume?: number;
  openInterest?: number;
}

export interface YahooChain {
  quote: { regularMarketPrice?: number; regularMarketChangePercent?: number };
  expirationDates: number[];     // unix seconds
  calls: YahooContract[];
  puts: YahooContract[];
}

/** Fetch one option chain for a symbol; pass a unix-second `date` to pick an expiry. */
export async function fetchOptionChain(symbol: string, date?: number): Promise<YahooChain> {
  const dateParam = date ? `&date=${date}` : "";
  const build = (crumb: string) =>
    `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(crumb)}${dateParam}`;

  let { cookie, crumb } = await getAuth();
  let res = await fetch(build(crumb), { headers: { "User-Agent": UA, Cookie: cookie } });
  if (res.status === 401) {
    ({ cookie, crumb } = await getAuth(true));
    res = await fetch(build(crumb), { headers: { "User-Agent": UA, Cookie: cookie } });
  }
  if (!res.ok) throw new Error(`Yahoo options ${symbol} ${res.status}`);

  const json = await res.json();
  const result = json?.optionChain?.result?.[0];
  if (!result) throw new Error(`No option chain for ${symbol}`);
  const opt = result.options?.[0] ?? {};
  return {
    quote: result.quote ?? {},
    expirationDates: result.expirationDates ?? [],
    calls: opt.calls ?? [],
    puts: opt.puts ?? [],
  };
}

/* ─── Fund (ETF / mutual-fund) category ───
   Finnhub's profile2 returns nothing for funds, so /api/sectors falls back here
   to give ETFs a meaningful "sector" instead of "—". Returns the fund's
   Morningstar category (e.g. "Equity Energy", "Large Blend"), or its dominant
   holding sector, or "ETF"; null if the symbol isn't a fund / lookup fails. */

const fundCache = new Map<string, { data: string | null; ts: number }>();
const FUND_TTL = 12 * 60 * 60_000;

// Yahoo sectorWeightings keys → readable labels.
const SECTOR_LABELS: Record<string, string> = {
  technology: "Technology",
  financial_services: "Financial Services",
  healthcare: "Healthcare",
  consumer_cyclical: "Consumer Cyclical",
  consumer_defensive: "Consumer Defensive",
  energy: "Energy",
  industrials: "Industrials",
  basic_materials: "Materials",
  communication_services: "Communication Services",
  utilities: "Utilities",
  realestate: "Real Estate",
};

export async function yahooFundCategory(symbol: string): Promise<string | null> {
  const key = symbol.trim().toUpperCase();
  const hit = fundCache.get(key);
  if (hit && Date.now() - hit.ts < FUND_TTL) return hit.data;

  const build = (crumb: string) =>
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(key)}?modules=quoteType,fundProfile,topHoldings&crumb=${encodeURIComponent(crumb)}`;

  const remember = (data: string | null) => {
    fundCache.set(key, { data, ts: Date.now() });
    return data;
  };

  try {
    let { cookie, crumb } = await getAuth();
    let res = await fetch(build(crumb), { headers: { "User-Agent": UA, Cookie: cookie } });
    if (res.status === 401) {
      ({ cookie, crumb } = await getAuth(true));
      res = await fetch(build(crumb), { headers: { "User-Agent": UA, Cookie: cookie } });
    }
    if (!res.ok) return remember(null);

    const json = await res.json();
    const result = json?.quoteSummary?.result?.[0];
    if (!result) return remember(null);

    const quoteType: string | undefined = result.quoteType?.quoteType;
    if (quoteType !== "ETF" && quoteType !== "MUTUALFUND") return remember(null);

    // Prefer the Morningstar category; else the dominant holding sector.
    let label = (result.fundProfile?.categoryName ?? "").trim();
    if (!label) {
      const weights: Array<Record<string, { raw?: number }>> = result.topHoldings?.sectorWeightings ?? [];
      let topKey = "";
      let topVal = 0;
      for (const entry of weights) {
        const k = Object.keys(entry)[0];
        const v = entry[k]?.raw ?? 0;
        if (v > topVal) { topVal = v; topKey = k; }
      }
      if (topKey) label = SECTOR_LABELS[topKey] ?? topKey;
    }
    return remember(label || "ETF");
  } catch {
    return remember(null);
  }
}
