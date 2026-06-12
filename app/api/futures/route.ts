import { NextResponse, type NextRequest } from "next/server";

export type FuturesTimeframe = "1D" | "1W" | "1M" | "YTD";

export interface FutureCell {
  symbol:    string;
  name:      string;
  category:  string;
  price:     number;
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
const cache = new Map<string, { data: { price: number; changePct: number }; ts: number }>();
const TTL = 5 * 60_000;

async function fetchChange(sym: string, tf: FuturesTimeframe): Promise<{ price: number; changePct: number }> {
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
  let changePct: number;

  if (tf === "1D") {
    const prev = meta.chartPreviousClose ?? meta.previousClose ?? price;
    changePct = prev ? ((price - prev) / prev) * 100 : 0;
  } else {
    const closes: number[] = (result.indicators?.quote?.[0]?.close ?? []).filter(
      (c: number | null): c is number => c != null
    );
    const first = closes[0];
    const last = closes[closes.length - 1] ?? price;
    changePct = first ? ((last - first) / first) * 100 : 0;
  }

  const data = { price, changePct: parseFloat(changePct.toFixed(2)) };
  cache.set(key, { data, ts: Date.now() });
  return data;
}

export async function GET(request: NextRequest) {
  const tfParam = (request.nextUrl.searchParams.get("range") ?? "1D").toUpperCase();
  const tf: FuturesTimeframe = (["1D", "1W", "1M", "YTD"].includes(tfParam) ? tfParam : "1D") as FuturesTimeframe;

  const results = await Promise.allSettled(FUTURES.map((f) => fetchChange(f.sym, tf)));

  const cells: FutureCell[] = FUTURES.map((f, i) => {
    const r = results[i];
    if (r.status !== "fulfilled") {
      return { symbol: f.sym, name: f.name, category: f.cat, price: 0, changePct: 0, error: true };
    }
    return { symbol: f.sym, name: f.name, category: f.cat, price: r.value.price, changePct: r.value.changePct };
  });

  return NextResponse.json({ cells, timeframe: tf });
}
