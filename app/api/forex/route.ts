import { NextResponse, type NextRequest } from "next/server";

export type ForexTimeframe = "1D" | "1W" | "1M" | "YTD";

export interface ForexCell {
  symbol:    string;   // canonical, e.g. "EURUSD"
  name:      string;
  base:      string;   // base currency, e.g. "EUR"
  quote:     string;   // quote currency, e.g. "USD"
  price:     number;
  change:    number;
  changePct: number;
  error?:    boolean;
}

/* Curated majors — must mirror FOREX_SPECS. Yahoo wants `${symbol}=X`. */
const PAIRS: Array<{ sym: string; name: string; base: string; quote: string }> = [
  { sym: "EURUSD", name: "Euro / Dollar",      base: "EUR", quote: "USD" },
  { sym: "GBPUSD", name: "Pound / Dollar",     base: "GBP", quote: "USD" },
  { sym: "USDJPY", name: "Dollar / Yen",       base: "USD", quote: "JPY" },
  { sym: "AUDUSD", name: "Aussie / Dollar",    base: "AUD", quote: "USD" },
  { sym: "USDCAD", name: "Dollar / Loonie",    base: "USD", quote: "CAD" },
  { sym: "USDCHF", name: "Dollar / Franc",     base: "USD", quote: "CHF" },
  { sym: "NZDUSD", name: "Kiwi / Dollar",      base: "NZD", quote: "USD" },
];

const RANGE_MAP: Record<ForexTimeframe, { range: string; interval: string }> = {
  "1D":  { range: "1d",  interval: "5m" },
  "1W":  { range: "5d",  interval: "1d" },
  "1M":  { range: "1mo", interval: "1d" },
  "YTD": { range: "ytd", interval: "1d" },
};

type FetchResult = { price: number; change: number; changePct: number };
const cache = new Map<string, { data: FetchResult; ts: number }>();
const TTL = 5 * 60_000;
const CONCURRENCY = 4;

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      try { results[idx] = { status: "fulfilled", value: await fn(items[idx]) }; }
      catch (reason) { results[idx] = { status: "rejected", reason }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchChange(yahooSym: string, tf: ForexTimeframe): Promise<FetchResult> {
  const key = `${yahooSym}:${tf}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const { range, interval } = RANGE_MAP[tf];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; fintrack/1.0)" },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Yahoo ${yahooSym} ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta?.regularMarketPrice) throw new Error(`No data for ${yahooSym}`);

  const price: number = meta.regularMarketPrice;
  let base: number;
  if (tf === "1D") {
    base = meta.chartPreviousClose ?? meta.previousClose ?? price;
  } else {
    const closes: number[] = (result.indicators?.quote?.[0]?.close ?? []).filter(
      (c: number | null): c is number => c != null
    );
    base = closes[0] ?? price;
  }
  const change = price - base;
  const changePct = base ? (change / base) * 100 : 0;

  const data: FetchResult = {
    price: parseFloat(price.toFixed(5)),
    change: parseFloat(change.toFixed(5)),
    changePct: parseFloat(changePct.toFixed(2)),
  };
  cache.set(key, { data, ts: Date.now() });
  return data;
}

export async function GET(request: NextRequest) {
  const tfParam = (request.nextUrl.searchParams.get("range") ?? "1D").toUpperCase();
  const tf: ForexTimeframe = (["1D", "1W", "1M", "YTD"].includes(tfParam) ? tfParam : "1D") as ForexTimeframe;

  const results = await pool(PAIRS, CONCURRENCY, (p) => fetchChange(`${p.sym}=X`, tf));

  const cells: ForexCell[] = PAIRS.map((p, i) => {
    const r = results[i];
    if (r.status !== "fulfilled") {
      return { symbol: p.sym, name: p.name, base: p.base, quote: p.quote, price: 0, change: 0, changePct: 0, error: true };
    }
    return {
      symbol: p.sym, name: p.name, base: p.base, quote: p.quote,
      price: r.value.price, change: r.value.change, changePct: r.value.changePct,
    };
  });

  // DXY (US Dollar Index) — credibility anchor for the USD-strength ribbon.
  let dxy: { price: number; changePct: number } | null = null;
  try {
    const d = await fetchChange("DX-Y.NYB", tf);
    dxy = { price: d.price, changePct: d.changePct };
  } catch { /* anchor is optional */ }

  return NextResponse.json({ cells, dxy, timeframe: tf });
}
