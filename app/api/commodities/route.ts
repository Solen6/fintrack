import { NextResponse } from "next/server";
import { fetchCommodityCatalysts } from "@/lib/commodity-catalysts";

// 1-hour cache
const cache = new Map<string, { data: unknown; ts: number }>();
const TTL = 60 * 60_000;

/* Timeframe → Yahoo range/interval. `intraday` keeps the time component in the date string. */
const RANGE_MAP: Record<string, { range: string; interval: string; intraday: boolean }> = {
  "1D":  { range: "1d",  interval: "5m",  intraday: true  },
  "5D":  { range: "5d",  interval: "30m", intraday: true  },
  "1M":  { range: "1mo", interval: "1d",  intraday: false },
  "6M":  { range: "6mo", interval: "1d",  intraday: false },
  "YTD": { range: "ytd", interval: "1d",  intraday: false },
  "1Y":  { range: "1y",  interval: "1d",  intraday: false },
  "5Y":  { range: "5y",  interval: "1wk", intraday: false },
};

async function yahooCandles(symbol: string, tf: string) {
  const conf = RANGE_MAP[tf] ?? RANGE_MAP["1Y"];
  const key = `${symbol}:${tf}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${conf.interval}&range=${conf.range}&includePrePost=false`;
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
      date:  conf.intraday
        ? new Date(t * 1000).toISOString()
        : new Date(t * 1000).toISOString().split("T")[0],
      price: closes[i] != null ? parseFloat(closes[i].toFixed(2)) : null,
    }))
    .filter((d): d is { date: string; price: number } => d.price != null);

  const lastClose    = data.length > 0 ? data[data.length - 1].price : 0;
  const currentPrice = meta.regularMarketPrice ?? lastClose;
  const basePrice    = meta.chartPreviousClose ?? (data.length > 0 ? data[0].price : 1);
  const changePct    = basePrice > 0
    ? parseFloat((((currentPrice - basePrice) / basePrice) * 100).toFixed(2))
    : 0;

  const out = { data, currentPrice, changePct, basePrice };
  cache.set(key, { data: out, ts: Date.now() });
  return out as typeof out;
}

const COMMODITIES = [
  { id: "gold",    symbol: "GLD",   name: "Gold",      unit: "$/oz (GLD)"   },
  { id: "silver",  symbol: "SLV",   name: "Silver",    unit: "$/oz (SLV)"   },
  { id: "oil",     symbol: "USO",   name: "WTI Crude", unit: "$/bbl (USO)"  },
  { id: "copper",  symbol: "CPER",  name: "Copper",    unit: "$/lb (CPER)"  },
  { id: "uranium", symbol: "SRUUF", name: "Uranium",   unit: "$/lb (SRUUF)" },
];

// Fixed lookback window for catalysts, independent of the requested price
// timeframe — the client filters catalysts down to whatever price-series
// date range it's actually showing, so it's fine (and cache-friendlier) to
// always fetch the same wide window here.
function catalystWindow(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 14);
  return { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] };
}

const MAX_EXTRA = 5;

/** User-added tickers beyond the 5 curated commodities — `?extra=NVDA,PL=F`.
 *  No catalyst keyword mapping exists for these (fetchCommodityCatalysts
 *  returns [] for an unrecognized id), so they chart price only. */
function parseExtra(searchParams: URLSearchParams): typeof COMMODITIES {
  const raw = searchParams.get("extra");
  if (!raw) return [];
  const preset = new Set(COMMODITIES.map((c) => c.symbol));
  const symbols = [...new Set(
    raw.split(",").map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0 && s.length <= 15 && !preset.has(s))
  )].slice(0, MAX_EXTRA);
  return symbols.map((symbol) => ({ id: symbol.toLowerCase(), symbol, name: symbol, unit: "" }));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tf = searchParams.get("range") ?? "1Y";
  const { from, to } = catalystWindow();
  const allMeta = [...COMMODITIES, ...parseExtra(searchParams)];

  const [priceResults, catalystResults] = await Promise.all([
    Promise.allSettled(allMeta.map((c) => yahooCandles(c.symbol, tf))),
    Promise.allSettled(allMeta.map((c) => fetchCommodityCatalysts(c.id, from, to))),
  ]);

  const commodities = allMeta.map((meta, i) => {
    const r = priceResults[i];
    const catalysts = catalystResults[i].status === "fulfilled" ? catalystResults[i].value : [];
    if (r.status !== "fulfilled") {
      return { ...meta, currentPrice: 0, changePct: 0, data: [], catalysts };
    }
    const v = r.value as { data: { date: string; price: number }[]; currentPrice: number; changePct: number; basePrice: number };
    return { ...meta, currentPrice: v.currentPrice, changePct: v.changePct, basePrice: v.basePrice, data: v.data, catalysts };
  });

  return NextResponse.json({ commodities });
}
