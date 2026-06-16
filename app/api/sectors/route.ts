import { NextResponse, type NextRequest } from "next/server";
import { yahooFundCategory } from "@/lib/yahoo";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;

// Sectors are stable — cache aggressively (12h)
const cache = new Map<string, { sector: string; ts: number }>();
const TTL = 12 * 60 * 60_000;

async function fetchSector(ticker: string): Promise<string> {
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.ts < TTL) return hit.sector;

  // Stocks: Finnhub industry. ETFs/funds return nothing here.
  let sector = "";
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`,
      { next: { revalidate: 43200 } }
    );
    if (res.ok) {
      const d = await res.json();
      sector = (d.finnhubIndustry ?? "").trim();
    }
  } catch {
    /* fall through to the fund lookup */
  }

  // ETFs/mutual funds: fall back to Yahoo's fund category so they get a real
  // sector label instead of "—".
  if (!sector) {
    sector = (await yahooFundCategory(ticker)) ?? "";
  }

  cache.set(ticker, { sector, ts: Date.now() });
  return sector;
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("tickers") ?? "";
  const tickers = raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);

  if (tickers.length === 0) return NextResponse.json({ sectors: {} });

  const limited = tickers.slice(0, 30);
  const sectors: Record<string, string> = {};
  for (const ticker of limited) {
    const s = await fetchSector(ticker);
    if (s) sectors[ticker] = s;
    await new Promise((r) => setTimeout(r, 50)); // gentle on the rate limit
  }

  return NextResponse.json({ sectors });
}
