import { NextResponse, type NextRequest } from "next/server";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;
const BASE = "https://finnhub.io/api/v1";

// 15-minute cache
const cache = new Map<string, { data: unknown; ts: number }>();
const TTL = 15 * 60_000;

async function finnhub<T>(path: string): Promise<T | null> {
  const key = path;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data as T;

  try {
    const res = await fetch(`${BASE}${path}&token=${FINNHUB_KEY}`, {
      next: { revalidate: 900 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    cache.set(key, { data, ts: Date.now() });
    return data as T;
  } catch {
    return null;
  }
}

interface RawArticle {
  id: number;
  headline: string;
  summary: string;
  source: string;
  datetime: number;   // unix seconds
  url: string;
  related: string;    // ticker or ""
  category?: string;
}

export interface NewsArticle {
  id: string;
  ticker: string | null;
  headline: string;
  summary: string;
  source: string;
  timestamp: number;  // unix ms
  url: string;
}

function toArticle(raw: RawArticle, ticker: string | null): NewsArticle {
  return {
    id:        `${raw.id}-${ticker ?? "general"}`,
    ticker,
    headline:  raw.headline,
    summary:   raw.summary ?? "",
    source:    raw.source,
    timestamp: raw.datetime * 1000,
    url:       raw.url,
  };
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("tickers") ?? "";
  const tickers = raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 12);

  const today = new Date();
  const toDate = today.toISOString().split("T")[0];
  const fromDate = new Date(today.getTime() - 30 * 24 * 3600_000)
    .toISOString()
    .split("T")[0];

  // Fetch company news per ticker + general market news in parallel
  const fetches: Promise<RawArticle[] | null>[] = [
    ...tickers.map((t) =>
      finnhub<RawArticle[]>(`/company-news?symbol=${t}&from=${fromDate}&to=${toDate}`)
    ),
    finnhub<RawArticle[]>(`/news?category=general`),
  ];

  const results = await Promise.allSettled(fetches);

  const articles: NewsArticle[] = [];
  const seen = new Set<number>();

  results.forEach((result, i) => {
    if (result.status !== "fulfilled" || !result.value) return;
    const ticker = i < tickers.length ? tickers[i] : null;
    for (const raw of result.value) {
      if (!raw.headline || seen.has(raw.id)) continue;
      seen.add(raw.id);
      articles.push(toArticle(raw, ticker));
    }
  });

  // Sort newest first, cap at 100
  articles.sort((a, b) => b.timestamp - a.timestamp);
  const trimmed = articles.slice(0, 100);

  return NextResponse.json({ articles: trimmed, tickers });
}
