import { NextResponse, type NextRequest } from "next/server";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;

// Sectors are stable — cache aggressively (12h)
const cache = new Map<string, { sector: string; ts: number }>();
const TTL = 12 * 60 * 60_000;

async function fetchSector(ticker: string): Promise<string> {
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.ts < TTL) return hit.sector;

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`,
      { next: { revalidate: 43200 } }
    );
    if (!res.ok) return "";
    const d = await res.json();
    const sector = (d.finnhubIndustry ?? "").trim();
    cache.set(ticker, { sector, ts: Date.now() });
    return sector;
  } catch {
    return "";
  }
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
