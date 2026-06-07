import { NextResponse } from "next/server";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;
const BASE = "https://finnhub.io/api/v1";

// 1-hour cache
const cache = new Map<string, { data: unknown; ts: number }>();
const TTL = 60 * 60_000;

async function fetchCandles(symbol: string, from: number, to: number) {
  const key = `${symbol}-${from}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  try {
    const res = await fetch(
      `${BASE}/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_KEY}`,
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.s !== "ok") return null;
    cache.set(key, { data, ts: Date.now() });
    return data as { c: number[]; t: number[]; s: string };
  } catch {
    return null;
  }
}

const COMMODITIES = [
  { id: "gold",   symbol: "GLD",  name: "Gold",       unit: "$/oz (GLD)" },
  { id: "silver", symbol: "SLV",  name: "Silver",     unit: "$/oz (SLV)" },
  { id: "oil",    symbol: "USO",  name: "WTI Crude",  unit: "$/bbl (USO)" },
  { id: "copper", symbol: "CPER", name: "Copper",     unit: "$/lb (CPER)" },
];

export async function GET() {
  const now  = Math.floor(Date.now() / 1000);
  const from = now - 366 * 24 * 3600;

  const results = await Promise.allSettled(
    COMMODITIES.map((c) => fetchCandles(c.symbol, from, now))
  );

  const commodities = COMMODITIES.map((meta, i) => {
    const result = results[i];
    if (result.status !== "fulfilled" || !result.value) {
      return { ...meta, currentPrice: 0, changePct: 0, data: [] };
    }

    const raw = result.value as { c: number[]; t: number[] };
    const prices = raw.c;
    const times  = raw.t;

    const data = prices.map((price, idx) => ({
      date:  new Date(times[idx] * 1000).toISOString().split("T")[0],
      price: parseFloat(price.toFixed(2)),
    }));

    const currentPrice = prices[prices.length - 1] ?? 0;
    const prevPrice    = prices[prices.length - 2] ?? currentPrice;
    const changePct    = prevPrice > 0
      ? parseFloat((((currentPrice - prevPrice) / prevPrice) * 100).toFixed(2))
      : 0;

    return { ...meta, currentPrice, changePct, data };
  });

  return NextResponse.json({ commodities });
}
