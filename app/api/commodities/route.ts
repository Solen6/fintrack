import { NextResponse } from "next/server";

// 1-hour cache
const cache = new Map<string, { data: unknown; ts: number }>();
const TTL = 60 * 60_000;

async function yahooCandles(symbol: string) {
  const key = symbol;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; fintrack/1.0)" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol} ${res.status}`);
  const json = await res.json();

  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${symbol}`);

  const timestamps: number[] = result.timestamp ?? [];
  const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
  const meta = result.meta ?? {};

  if (timestamps.length === 0 || closes.length === 0) throw new Error(`Empty data for ${symbol}`);

  const data = timestamps
    .map((t, i) => ({
      date:  new Date(t * 1000).toISOString().split("T")[0],
      price: closes[i] != null ? parseFloat(closes[i].toFixed(2)) : null,
    }))
    .filter((d): d is { date: string; price: number } => d.price != null);

  const currentPrice = meta.regularMarketPrice ?? closes[closes.length - 1] ?? 0;
  const prevClose    = meta.chartPreviousClose ?? closes[closes.length - 2] ?? currentPrice;
  const changePct    = prevClose > 0
    ? parseFloat((((currentPrice - prevClose) / prevClose) * 100).toFixed(2))
    : 0;

  const out = { data, currentPrice, changePct };
  cache.set(key, { data: out, ts: Date.now() });
  return out as typeof out;
}

const COMMODITIES = [
  { id: "gold",   symbol: "GLD",      name: "Gold",      unit: "$/oz (GLD)"  },
  { id: "silver", symbol: "SLV",      name: "Silver",    unit: "$/oz (SLV)"  },
  { id: "oil",    symbol: "USO",      name: "WTI Crude", unit: "$/bbl (USO)" },
  { id: "copper", symbol: "CPER",     name: "Copper",    unit: "$/lb (CPER)" },
];

export async function GET() {
  const results = await Promise.allSettled(
    COMMODITIES.map((c) => yahooCandles(c.symbol))
  );

  const commodities = COMMODITIES.map((meta, i) => {
    const r = results[i];
    if (r.status !== "fulfilled") {
      return { ...meta, currentPrice: 0, changePct: 0, data: [] };
    }
    const v = r.value as { data: { date: string; price: number }[]; currentPrice: number; changePct: number };
    return { ...meta, currentPrice: v.currentPrice, changePct: v.changePct, data: v.data };
  });

  return NextResponse.json({ commodities });
}
