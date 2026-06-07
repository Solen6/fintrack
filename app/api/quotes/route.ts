import { NextResponse, type NextRequest } from "next/server";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;

export interface Quote {
  ticker:  string;
  price:   number;
  change:  number;  // dollar change
  changePct: number; // percent change
  open:    number;
  high:    number;
  low:     number;
  prevClose: number;
}

// Simple in-memory cache — 60 second TTL
const cache = new Map<string, { data: Quote; ts: number }>();
const CACHE_TTL = 60_000;

async function fetchQuote(ticker: string): Promise<Quote | null> {
  const cached = cache.get(ticker);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return null;
    const d = await res.json();

    // Finnhub returns 0s for invalid tickers
    if (!d.c || d.c === 0) return null;

    const quote: Quote = {
      ticker,
      price:     d.c,  // current price
      change:    d.d,  // change
      changePct: d.dp, // change percent
      open:      d.o,
      high:      d.h,
      low:       d.l,
      prevClose: d.pc,
    };

    cache.set(ticker, { data: quote, ts: Date.now() });
    return quote;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("tickers") ?? "";
  const tickers = raw.split(",").map(t => t.trim().toUpperCase()).filter(Boolean);

  if (tickers.length === 0) {
    return NextResponse.json({ error: "No tickers provided" }, { status: 400 });
  }

  // Fetch up to 30 tickers (rate limit safety)
  const limited = tickers.slice(0, 30);

  // Stagger requests slightly to avoid rate limit
  const quotes: Record<string, Quote> = {};
  for (const ticker of limited) {
    const q = await fetchQuote(ticker);
    if (q) quotes[ticker] = q;
    // Small delay between calls
    await new Promise(r => setTimeout(r, 50));
  }

  return NextResponse.json({ quotes });
}
