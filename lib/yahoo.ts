/**
 * Shared Yahoo Finance access — used by /api/options, /api/futures-style quotes,
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
