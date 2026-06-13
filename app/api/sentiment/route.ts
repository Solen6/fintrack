import { NextResponse } from "next/server";

/**
 * CNN Fear & Greed Index — overall US equity-market sentiment, 0 (extreme
 * fear) to 100 (extreme greed). CNN's dataviz endpoint is unofficial but
 * stable; it requires a browser-like User-Agent or it 418s. Cached 30 min.
 */

export interface Component {
  score: number;
  rating: string;
}

export interface SentimentData {
  score: number;
  rating: string;
  previousClose: number;
  week: number;
  month: number;
  year: number;
  updatedAt: string;
  // breadth/internals components (for the Market page strip)
  components: {
    breadth: Component;
    strength: Component;
    momentum: Component;
    putCall: Component;
  };
  // recent overall-index history for the bull/bear sparkline
  history: Array<{ t: number; score: number }>;
}

function titleCase(s: unknown): string {
  return String(s ?? "").replace(/\b\w/g, (c) => c.toUpperCase());
}

function readComponent(node: unknown): Component {
  const n = (node ?? {}) as { score?: number; rating?: string };
  return { score: Math.round(n.score ?? 50), rating: titleCase(n.rating) };
}

let cache: { data: SentimentData; ts: number } | null = null;
const TTL = 30 * 60_000;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function GET() {
  if (cache && Date.now() - cache.ts < TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const res = await fetch(
      "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
      {
        headers: {
          "User-Agent": UA,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.cnn.com/markets/fear-and-greed",
          Origin: "https://www.cnn.com",
          "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"macOS"',
        },
        next: { revalidate: 1800 },
      }
    );
    if (!res.ok) throw new Error(`CNN ${res.status}`);
    const json = await res.json();
    const fg = json?.fear_and_greed;
    if (!fg || typeof fg.score !== "number") throw new Error("Unexpected shape");

    const histRaw = Array.isArray(json?.fear_and_greed_historical?.data)
      ? json.fear_and_greed_historical.data
      : [];
    const history = histRaw
      .slice(-40)
      .map((p: { x: number; y: number }) => ({ t: p.x, score: Math.round(p.y) }));

    const data: SentimentData = {
      score: Math.round(fg.score),
      rating: titleCase(fg.rating),
      previousClose: Math.round(fg.previous_close ?? fg.score),
      week: Math.round(fg.previous_1_week ?? fg.score),
      month: Math.round(fg.previous_1_month ?? fg.score),
      year: Math.round(fg.previous_1_year ?? fg.score),
      updatedAt: new Date().toISOString(),
      components: {
        breadth: readComponent(json?.stock_price_breadth),
        strength: readComponent(json?.stock_price_strength),
        momentum: readComponent(json?.market_momentum_sp500),
        putCall: readComponent(json?.put_call_options),
      },
      history,
    };

    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `Sentiment unavailable: ${msg}` }, { status: 502 });
  }
}
