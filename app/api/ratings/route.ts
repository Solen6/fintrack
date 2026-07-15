import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mapLimit } from "@/lib/async";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;

/* Analyst recommendation trends (Finnhub, free tier): monthly counts of
   strong-buy → strong-sell. We serve the latest month per symbol plus a
   1–5 consensus score (5 = strong buy) and a label, shared by every surface
   that shows a rating (watchlist, holding insights, paper stock detail). */

export interface AnalystRating {
  symbol: string;
  period: string; // YYYY-MM-DD month the counts are from
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  total: number;
  score: number; // 1–5 weighted mean, 5 = strong buy
  label: "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell";
}

function labelFor(score: number): AnalystRating["label"] {
  if (score >= 4.2) return "Strong Buy";
  if (score >= 3.5) return "Buy";
  if (score >= 2.6) return "Hold";
  if (score >= 1.8) return "Sell";
  return "Strong Sell";
}

// Ratings move on analyst notes, not ticks — cache half a day per symbol.
const cache = new Map<string, { rating: AnalystRating | null; ts: number }>();
const TTL = 12 * 60 * 60 * 1000;

async function fetchRating(symbol: string): Promise<AnalystRating | null> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.ts < TTL) return hit.rating;
  let rating: AnalystRating | null = null;
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`,
      { next: { revalidate: 21600 } },
    );
    if (res.ok) {
      const data: Array<{
        period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number;
      }> = await res.json();
      const latest = Array.isArray(data) && data.length > 0 ? data[0] : null; // Finnhub returns newest first
      if (latest) {
        const { strongBuy = 0, buy = 0, hold = 0, sell = 0, strongSell = 0 } = latest;
        const total = strongBuy + buy + hold + sell + strongSell;
        if (total > 0) {
          const score = (5 * strongBuy + 4 * buy + 3 * hold + 2 * sell + 1 * strongSell) / total;
          rating = {
            symbol,
            period: latest.period,
            strongBuy, buy, hold, sell, strongSell,
            total,
            score,
            label: labelFor(score),
          };
        }
      }
    }
  } catch {
    // no data → null (ETFs, indices and small caps often have no coverage)
  }
  cache.set(symbol, { rating, ts: Date.now() });
  return rating;
}

/* GET /api/ratings?symbols=AAPL,MSFT,… → { ratings: { AAPL: {...} | null } } */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = req.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)),
    ),
  ].slice(0, 60); // Finnhub free tier is 60 req/min — stay under one burst

  if (symbols.length === 0) return NextResponse.json({ ratings: {} });

  const results = await mapLimit(symbols, 6, async (s) => [s, await fetchRating(s)] as const);
  return NextResponse.json({ ratings: Object.fromEntries(results) });
}
