/**
 * Server-side Finnhub quote fetching, shared by /api/quotes, /api/paper
 * (order fills), and /api/snapshots (daily value capture).
 */

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;

export interface FinnhubQuote {
  ticker: string;
  price: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
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
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(key)}&token=${FINNHUB_KEY}`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return null;
    const d = await res.json();

    // Finnhub returns 0s for invalid tickers
    if (!d.c || d.c === 0) return null;

    const quote: FinnhubQuote = {
      ticker: key,
      price: d.c,
      change: d.d,
      changePct: d.dp,
      open: d.o,
      high: d.h,
      low: d.l,
      prevClose: d.pc,
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
