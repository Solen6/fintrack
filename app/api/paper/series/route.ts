import { NextResponse, type NextRequest } from "next/server";

/* Per-contract price history for the paper-trading futures chart.
   Yahoo v8 chart passthrough — returns a clean {date, price} series plus
   current price + % change over the window. Cached 5 min per symbol:range. */

export type SeriesRange = "1D" | "5D" | "1M" | "6M" | "YTD";

const RANGE_MAP: Record<SeriesRange, { range: string; interval: string; intraday: boolean }> = {
  "1D":  { range: "1d",  interval: "5m",  intraday: true  },
  "5D":  { range: "5d",  interval: "30m", intraday: true  },
  "1M":  { range: "1mo", interval: "1d",  intraday: false },
  "6M":  { range: "6mo", interval: "1d",  intraday: false },
  "YTD": { range: "ytd", interval: "1d",  intraday: false },
};

interface SeriesResult {
  data: { date: string; price: number }[];
  currentPrice: number;
  changePct: number;
}

const cache = new Map<string, { data: SeriesResult; ts: number }>();
const TTL = 5 * 60_000;

async function fetchSeries(symbol: string, tf: SeriesRange): Promise<SeriesResult> {
  const key = `${symbol}:${tf}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const conf = RANGE_MAP[tf];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${conf.interval}&range=${conf.range}&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; fintrack/1.0)" },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol} ${res.status}`);
  const json = await res.json();

  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${symbol}`);

  const timestamps: number[] = result.timestamp ?? [];
  const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
  const meta = result.meta ?? {};

  const data = timestamps
    .map((t, i) => ({
      date: conf.intraday
        ? new Date(t * 1000).toISOString()
        : new Date(t * 1000).toISOString().split("T")[0],
      price: closes[i] != null ? parseFloat(closes[i].toFixed(4)) : null,
    }))
    .filter((d): d is { date: string; price: number } => d.price != null);

  if (data.length === 0) throw new Error(`Empty data for ${symbol}`);

  const currentPrice = meta.regularMarketPrice ?? data[data.length - 1].price;
  const base = tf === "1D"
    ? (meta.chartPreviousClose ?? meta.previousClose ?? data[0].price)
    : data[0].price;
  const changePct = base > 0 ? parseFloat((((currentPrice - base) / base) * 100).toFixed(2)) : 0;

  const out: SeriesResult = { data, currentPrice, changePct };
  cache.set(key, { data: out, ts: Date.now() });
  return out;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const symbol = (sp.get("symbol") ?? "").trim();
  if (!symbol) return NextResponse.json({ error: "symbol is required." }, { status: 400 });

  const rangeParam = (sp.get("range") ?? "1M").toUpperCase();
  const tf: SeriesRange = (["1D", "5D", "1M", "6M", "YTD"].includes(rangeParam) ? rangeParam : "1M") as SeriesRange;

  try {
    const out = await fetchSeries(symbol, tf);
    return NextResponse.json({ ...out, symbol, range: tf });
  } catch {
    return NextResponse.json({ data: [], currentPrice: null, changePct: 0, symbol, range: tf });
  }
}
