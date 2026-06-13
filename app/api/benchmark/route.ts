import { NextResponse } from "next/server";

/**
 * S&P 500 (SPY) return over standard timeframes, for the dashboard's
 * "vs Market" comparison. Yahoo v8 chart API (no key needed), 15 min cache.
 */

export type BenchRange = "1D" | "5D" | "1M" | "6M" | "YTD" | "1Y";

const RANGES: Record<BenchRange, { range: string; interval: string }> = {
  "1D":  { range: "1d",  interval: "5m" },
  "5D":  { range: "5d",  interval: "1d" },
  "1M":  { range: "1mo", interval: "1d" },
  "6M":  { range: "6mo", interval: "1d" },
  "YTD": { range: "ytd", interval: "1d" },
  "1Y":  { range: "1y",  interval: "1d" },
};

const SYMBOL = "SPY";

let cache: { data: Record<BenchRange, number | null>; ts: number } | null = null;
const TTL = 15 * 60_000;

async function fetchReturn(key: BenchRange): Promise<number | null> {
  const { range, interval } = RANGES[key];
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${SYMBOL}?interval=${interval}&range=${range}`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; fintrack/1.0)" },
        next: { revalidate: 900 },
      }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    const price: number | undefined = meta?.regularMarketPrice;
    if (!price) return null;

    let base: number | undefined;
    if (key === "1D") {
      base = meta.chartPreviousClose ?? meta.previousClose;
    } else {
      const closes: number[] = (result.indicators?.quote?.[0]?.close ?? []).filter(
        (c: number | null): c is number => c != null
      );
      base = closes[0];
    }
    if (!base) return null;
    return parseFloat((((price - base) / base) * 100).toFixed(2));
  } catch {
    return null;
  }
}

export async function GET() {
  if (cache && Date.now() - cache.ts < TTL) {
    return NextResponse.json({ symbol: SYMBOL, returns: cache.data });
  }

  const keys = Object.keys(RANGES) as BenchRange[];
  const values = await Promise.all(keys.map(fetchReturn));
  const returns = Object.fromEntries(keys.map((k, i) => [k, values[i]])) as Record<BenchRange, number | null>;

  cache = { data: returns, ts: Date.now() };
  return NextResponse.json({ symbol: SYMBOL, returns });
}
