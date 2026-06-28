import { NextResponse, type NextRequest } from "next/server";

export type FuturesTimeframe = "1D" | "1W" | "1M" | "YTD";

export interface FutureCell {
  symbol:    string;
  name:      string;
  category:  string;
  price:     number;
  change:    number;
  changePct: number;
  error?:    boolean;
}

const FUTURES: Array<{ sym: string; name: string; cat: string }> = [
  // Energy
  { sym: "CL=F", name: "WTI Crude",     cat: "Energy" },
  { sym: "BZ=F", name: "Brent Crude",   cat: "Energy" },
  { sym: "NG=F", name: "Nat Gas",       cat: "Energy" },
  { sym: "RB=F", name: "Gasoline",      cat: "Energy" },
  { sym: "HO=F", name: "Heating Oil",   cat: "Energy" },
  // Metals
  { sym: "GC=F", name: "Gold",          cat: "Metals" },
  { sym: "SI=F", name: "Silver",        cat: "Metals" },
  { sym: "HG=F", name: "Copper",        cat: "Metals" },
  { sym: "PL=F", name: "Platinum",      cat: "Metals" },
  { sym: "PA=F", name: "Palladium",     cat: "Metals" },
  // Indices
  { sym: "ES=F", name: "S&P 500",       cat: "Indices" },
  { sym: "NQ=F", name: "Nasdaq 100",    cat: "Indices" },
  { sym: "YM=F", name: "Dow",           cat: "Indices" },
  { sym: "RTY=F", name: "Russell 2000", cat: "Indices" },
  // Rates
  { sym: "ZB=F", name: "30Y T-Bond",    cat: "Rates" },
  { sym: "ZN=F", name: "10Y T-Note",    cat: "Rates" },
  { sym: "ZF=F", name: "5Y T-Note",     cat: "Rates" },
  { sym: "ZT=F", name: "2Y T-Note",     cat: "Rates" },
  // Currencies
  { sym: "DX-Y.NYB", name: "US Dollar Index", cat: "Currencies" },
  { sym: "6E=F", name: "Euro",          cat: "Currencies" },
  { sym: "6J=F", name: "Yen",           cat: "Currencies" },
  { sym: "6B=F", name: "Pound",         cat: "Currencies" },
  // Agriculture
  { sym: "ZC=F", name: "Corn",          cat: "Agriculture" },
  { sym: "ZW=F", name: "Wheat",         cat: "Agriculture" },
  { sym: "ZS=F", name: "Soybeans",      cat: "Agriculture" },
  { sym: "KC=F", name: "Coffee",        cat: "Agriculture" },
  { sym: "SB=F", name: "Sugar",         cat: "Agriculture" },
  { sym: "CT=F", name: "Cotton",        cat: "Agriculture" },
];

const RANGE_MAP: Record<FuturesTimeframe, { range: string; interval: string }> = {
  "1D":  { range: "1d",  interval: "5m" },
  "1W":  { range: "5d",  interval: "1d" },
  "1M":  { range: "1mo", interval: "1d" },
  "YTD": { range: "ytd", interval: "1d" },
};

// Cache per symbol:timeframe — 5 min (1D moves intraday)
type FetchResult = { price: number; change: number; changePct: number };
const cache = new Map<string, { data: FetchResult; ts: number }>();
const dailyClosesCache = new Map<string, { data: number[]; ts: number }>();
const TTL = 5 * 60_000;

// Cap concurrent Yahoo requests so the ~28 symbols don't fire all at once (429s).
const CONCURRENCY = 6;

async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      try {
        results[idx] = { status: "fulfilled", value: await fn(items[idx]) };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

async function fetchChange(sym: string, tf: FuturesTimeframe): Promise<FetchResult> {
  const key = `${sym}:${tf}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const { range, interval } = RANGE_MAP[tf];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; fintrack/1.0)" },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Yahoo ${sym} ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta?.regularMarketPrice) throw new Error(`No data for ${sym}`);

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

  let outPrice = price;
  let outChange = price - base;
  let outPct = base ? (outChange / base) * 100 : 0;

  // When the market is closed, Yahoo carries the previous close as the "live"
  // price, so the 1D change collapses to a meaningless 0 and the whole map goes
  // flat/grey (e.g. weekends, overnight gaps before the Globex re-open). Fall
  // back to the most recent completed session's move (Finviz-style) so the board
  // still reflects the last real trading day. Only the 1D path needs this —
  // 1W/1M/YTD measure against an older close and are unaffected.
  if (tf === "1D" && price === base) {
    try {
      const closes = await fetchDailyCloses(sym);
      if (closes.length >= 2) {
        const last = closes[closes.length - 1];
        const prev = closes[closes.length - 2];
        if (prev) {
          outPrice = last;
          outChange = last - prev;
          outPct = (outChange / prev) * 100;
        }
      }
    } catch {
      /* keep the flat result if the daily fallback is unavailable */
    }
  }

  const data: FetchResult = {
    price: outPrice,
    change: parseFloat(outChange.toFixed(4)),
    changePct: parseFloat(outPct.toFixed(2)),
  };
  cache.set(key, { data, ts: Date.now() });
  return data;
}

// Daily closes for the "last completed session" 1D fallback. Yahoo appends a
// synthetic placeholder bar on non-trading days that simply duplicates the prior
// session's close; we strip that trailing duplicate so the last two entries are
// genuine consecutive sessions. Cached 5 min per symbol.
async function fetchDailyCloses(sym: string): Promise<number[]> {
  const key = `${sym}:DAILYCLOSES`;
  const hit = dailyClosesCache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1mo`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; fintrack/1.0)" },
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Yahoo ${sym} ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const closes: number[] = (result?.indicators?.quote?.[0]?.close ?? []).filter(
    (c: number | null): c is number => c != null
  );
  if (closes.length >= 2 && closes[closes.length - 1] === closes[closes.length - 2]) {
    closes.pop();
  }
  dailyClosesCache.set(key, { data: closes, ts: Date.now() });
  return closes;
}

export async function GET(request: NextRequest) {
  const tfParam = (request.nextUrl.searchParams.get("range") ?? "1D").toUpperCase();
  const tf: FuturesTimeframe = (["1D", "1W", "1M", "YTD"].includes(tfParam) ? tfParam : "1D") as FuturesTimeframe;

  const results = await pool(FUTURES, CONCURRENCY, (f) => fetchChange(f.sym, tf));

  const cells: FutureCell[] = FUTURES.map((f, i) => {
    const r = results[i];
    if (r.status !== "fulfilled") {
      return { symbol: f.sym, name: f.name, category: f.cat, price: 0, change: 0, changePct: 0, error: true };
    }
    return {
      symbol: f.sym,
      name: f.name,
      category: f.cat,
      price: r.value.price,
      change: r.value.change,
      changePct: r.value.changePct,
    };
  });

  return NextResponse.json({ cells, timeframe: tf });
}
