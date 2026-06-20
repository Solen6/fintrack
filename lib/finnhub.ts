/**
 * Server-side equity quote fetching for /api/quotes, /api/paper (order fills),
 * and /api/snapshots (daily value capture).
 *
 * Previously used Finnhub `d.c` (last trade on one exchange), which diverged
 * by a few cents from what Fidelity shows. Now uses Yahoo Finance
 * `v8/finance/chart → meta.regularMarketPrice`, which matches the NBBO-derived
 * price displayed by Fidelity and most retail brokerages.
 */

const UA = "Mozilla/5.0 (compatible; fintrack/1.0)";

export interface FinnhubQuote {
  ticker:    string;
  price:     number;
  change:    number;
  changePct: number;
  open:      number;
  high:      number;
  low:       number;
  prevClose: number;
}

// In-memory cache — 60 second TTL
const cache = new Map<string, { data: FinnhubQuote; ts: number }>();
const CACHE_TTL = 60_000;

export async function fetchQuote(ticker: string): Promise<FinnhubQuote | null> {
  const key = ticker.trim().toUpperCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}` +
      `?interval=1d&range=1d&includePrePost=false`;

    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;

    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;

    const price:     number = meta.regularMarketPrice;
    const prevClose: number = meta.chartPreviousClose ?? meta.previousClose ?? price;
    const open:      number = meta.regularMarketOpen      ?? prevClose;
    const high:      number = meta.regularMarketDayHigh   ?? price;
    const low:       number = meta.regularMarketDayLow    ?? price;
    const change:    number = meta.regularMarketChange    ?? (price - prevClose);
    const changePct: number = meta.regularMarketChangePercent
      ?? (prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0);

    const quote: FinnhubQuote = {
      ticker: key,
      price,
      change,
      changePct,
      open,
      high,
      low,
      prevClose,
    };
    cache.set(key, { data: quote, ts: Date.now() });
    return quote;
  } catch {
    return null;
  }
}

/** Fetch many quotes with a small stagger (rate-limit safety). */
export async function fetchQuotes(tickers: string[]): Promise<Record<string, FinnhubQuote>> {
  const quotes: Record<string, FinnhubQuote> = {};
  for (const t of tickers.slice(0, 30)) {
    const q = await fetchQuote(t);
    if (q) quotes[q.ticker] = q;
    await new Promise((r) => setTimeout(r, 50));
  }
  return quotes;
}
