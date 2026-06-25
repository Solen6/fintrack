import { NextResponse, type NextRequest } from "next/server";
import type { NewsArticle } from "@/app/api/news/route";

const AV_KEY = process.env.ALPHAVANTAGE_API_KEY;

// Single global cache — all users share one AV fetch to stay within 25 req/day
// TTL = 60 min → at most 24 calls/day
let cachedRaw: RawAVArticle[] | null = null;
let cacheTs = 0;
const TTL = 60 * 60_000;

interface RawAVArticle {
  title: string;
  url: string;
  time_published: string; // "20240101T120000"
  summary: string;
  source: string;
  ticker_sentiment?: Array<{
    ticker: string;
    relevance_score: string;
  }>;
}

// "20240101T120000" → unix ms
function parseTs(s: string): number {
  const d = s.slice(0, 8);
  const t = s.slice(9, 15);
  return new Date(
    `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`
  ).getTime();
}

function shape(raw: RawAVArticle[], portfolio: Set<string>): NewsArticle[] {
  return raw
    .map((a) => {
      const matched =
        a.ticker_sentiment
          ?.filter((ts) => portfolio.has(ts.ticker))
          .sort((x, y) => parseFloat(y.relevance_score) - parseFloat(x.relevance_score))[0]
          ?.ticker ?? null;
      return {
        id: `av-${a.url}`,
        ticker: matched,
        headline: a.title,
        summary: a.summary ?? "",
        source: a.source,
        timestamp: parseTs(a.time_published),
        url: a.url,
      };
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("tickers") ?? "";
  const portfolio = new Set(
    raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)
  );

  // Serve stale if AV key is missing
  if (!AV_KEY) {
    return NextResponse.json({ articles: [], error: "no_key" });
  }

  // Refresh global cache if stale
  if (!cachedRaw || Date.now() - cacheTs > TTL) {
    try {
      const res = await fetch(
        `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&topics=financial_markets&sort=LATEST&limit=50&apikey=${AV_KEY}`,
        { next: { revalidate: 3600 } }
      );
      if (!res.ok) {
        return NextResponse.json({
          articles: cachedRaw ? shape(cachedRaw, portfolio) : [],
          error: `http_${res.status}`,
        });
      }
      const data = await res.json();
      if (data.Information) {
        // Rate limit hit — serve stale cache if available
        console.warn("[AV news] rate limited:", data.Information);
        return NextResponse.json({
          articles: cachedRaw ? shape(cachedRaw, portfolio) : [],
          error: "rate_limit",
        });
      }
      cachedRaw = data.feed ?? [];
      cacheTs = Date.now();
    } catch (e) {
      console.error("[AV news] fetch error:", e);
      return NextResponse.json({
        articles: cachedRaw ? shape(cachedRaw, portfolio) : [],
        error: "fetch_error",
      });
    }
  }

  return NextResponse.json({ articles: shape(cachedRaw!, portfolio) });
}
