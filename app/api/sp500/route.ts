import { NextResponse, type NextRequest } from "next/server";
import { SP500, SP500_SECTORS } from "@/lib/sp500";

/* S&P 500 heatmap feed. Static constituent caps (lib/sp500.ts) drive tile AREA;
   this route supplies the LIVE % change that drives color, over the selected
   timeframe. % change comes from Yahoo's v8 *spark* endpoint, which (unlike v7
   quote) needs no crumb and returns close arrays for MANY symbols per request —
   so all ~500 names resolve in ~7 batched calls. Cached 5 min per timeframe. */

export type Sp500Timeframe = "1D" | "1W" | "1M" | "YTD";

export interface StockCell {
  symbol:    string;
  name:      string;
  sector:    string;
  capB:      number;
  price:     number;
  change:    number;
  changePct: number;
  error?:    boolean;
}

const RANGE_MAP: Record<Sp500Timeframe, { range: string; interval: string }> = {
  "1D":  { range: "1d",  interval: "5m" },
  "1W":  { range: "5d",  interval: "1d" },
  "1M":  { range: "1mo", interval: "1d" },
  "YTD": { range: "ytd", interval: "1d" },
};

const UA = "Mozilla/5.0 (compatible; fintrack/1.0)";
const BATCH = 20;          // spark hard-caps at 20 symbols per request
const CONCURRENCY = 5;     // parallel spark requests (~26 batches total)

type Live = { price: number; change: number; changePct: number };
const cache = new Map<Sp500Timeframe, { data: Map<string, Live>; ts: number }>();
const TTL = 5 * 60_000;

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      try { await fn(items[idx]); } catch { /* batch failures degrade per-symbol */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** One spark request for up to BATCH symbols → fills `out` with live values. */
async function fetchSparkBatch(
  symbols: string[],
  tf: Sp500Timeframe,
  out: Map<string, Live>,
): Promise<void> {
  const { range, interval } = RANGE_MAP[tf];
  const url =
    `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(symbols.join(","))}` +
    `&range=${range}&interval=${interval}`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`spark ${res.status}`);
  const json: Record<string, { close?: (number | null)[]; chartPreviousClose?: number }> = await res.json();

  for (const sym of symbols) {
    const node = json[sym];
    if (!node?.close) continue;
    const closes = node.close.filter((c): c is number => c != null);
    if (closes.length === 0) continue;
    const price = closes[closes.length - 1];
    const base = tf === "1D" ? (node.chartPreviousClose ?? closes[0]) : closes[0];
    const change = price - base;
    const changePct = base ? (change / base) * 100 : 0;
    out.set(sym, {
      price,
      change: parseFloat(change.toFixed(4)),
      changePct: parseFloat(changePct.toFixed(2)),
    });
  }
}

async function getLive(tf: Sp500Timeframe): Promise<Map<string, Live>> {
  const hit = cache.get(tf);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const out = new Map<string, Live>();
  const batches: string[][] = [];
  for (let i = 0; i < SP500.length; i += BATCH) {
    batches.push(SP500.slice(i, i + BATCH).map((m) => m.symbol));
  }
  await pool(batches, CONCURRENCY, (b) => fetchSparkBatch(b, tf, out));

  // Only cache a "good" result (most symbols resolved) so a transient Yahoo
  // hiccup doesn't pin an empty map for 5 min.
  if (out.size >= SP500.length * 0.5) cache.set(tf, { data: out, ts: Date.now() });
  return out;
}

export async function GET(request: NextRequest) {
  const tfParam = (request.nextUrl.searchParams.get("range") ?? "1D").toUpperCase();
  const tf: Sp500Timeframe = (["1D", "1W", "1M", "YTD"].includes(tfParam) ? tfParam : "1D") as Sp500Timeframe;

  const live = await getLive(tf);

  const cells: StockCell[] = SP500.map((m) => {
    const v = live.get(m.symbol);
    if (!v) {
      return { symbol: m.symbol, name: m.name, sector: m.sector, capB: m.capB, price: 0, change: 0, changePct: 0, error: true };
    }
    return { symbol: m.symbol, name: m.name, sector: m.sector, capB: m.capB, price: v.price, change: v.change, changePct: v.changePct };
  });

  return NextResponse.json({ cells, sectors: SP500_SECTORS, timeframe: tf });
}
