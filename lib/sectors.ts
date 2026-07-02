import { yahooFundCategory } from "@/lib/yahoo";

/* Sector lookup shared by /api/sectors (Accounts tab) and the monthly report
   generator (lib/monthly-reports.ts). Extracted verbatim from the route so
   both consumers share one in-process cache. */

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;

// Sectors are stable — cache aggressively (12h)
const cache = new Map<string, { sector: string; ts: number }>();
const TTL = 12 * 60 * 60_000;

export async function fetchSector(ticker: string): Promise<string> {
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

/** Sequential batch lookup (gentle on the rate limit), capped. */
export async function fetchSectors(
  tickers: string[],
  cap = 30,
): Promise<Record<string, string>> {
  const limited = tickers.slice(0, cap);
  const sectors: Record<string, string> = {};
  for (const ticker of limited) {
    const s = await fetchSector(ticker);
    if (s) sectors[ticker] = s;
    await new Promise((r) => setTimeout(r, 50)); // gentle on the rate limit
  }
  return sectors;
}
