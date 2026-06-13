import { NextResponse } from "next/server";
import { fetchOptionChain, type YahooContract } from "@/lib/yahoo";

/* ─── Response type ─── */
export interface OptionMetric {
  ticker:       string;
  spot:         number;
  dayChangePct: number;
  expiry:       string;  // ISO date of the ~30d expiry used
  dte:          number;  // days to that expiry
  atmIV:        number;  // ATM implied vol, % (avg of ATM call/put)
  pcRatio:      number;  // put/call ratio by volume on that expiry
  skew:         number;  // putIV − callIV, percentage points
  error?:       boolean;
}

// Per-ticker metrics cached 15m (the cookie/crumb handshake lives in lib/yahoo).
const metricCache = new Map<string, { data: OptionMetric; ts: number }>();
const METRIC_TTL = 15 * 60_000;

async function metricFor(symbol: string): Promise<OptionMetric> {
  const hit = metricCache.get(symbol);
  if (hit && Date.now() - hit.ts < METRIC_TTL) return hit.data;

  const first = await fetchOptionChain(symbol);
  const spot: number = first.quote.regularMarketPrice ?? 0;
  const dayChangePct: number = first.quote.regularMarketChangePercent ?? 0;

  const expirations = first.expirationDates;
  if (expirations.length === 0) throw new Error(`No expirations for ${symbol}`);

  // Pick the expiry closest to 30 days out — avoids noisy 0DTE implied vol
  const nowSec = Date.now() / 1000;
  const daysTo = (t: number) => Math.abs((t - nowSec) / 86400 - 30);
  const target = expirations.reduce((a, b) => (daysTo(b) < daysTo(a) ? b : a));

  const chain = target === expirations[0] ? first : await fetchOptionChain(symbol, target);
  const calls: YahooContract[] = chain.calls;
  const puts: YahooContract[] = chain.puts;
  if (calls.length === 0 || puts.length === 0) throw new Error(`Thin chain for ${symbol}`);

  const nearestStrike = (arr: YahooContract[]) =>
    arr.reduce((a, b) => (Math.abs(b.strike - spot) < Math.abs(a.strike - spot) ? b : a));
  const callIV = (nearestStrike(calls).impliedVolatility ?? 0) * 100;
  const putIV  = (nearestStrike(puts).impliedVolatility ?? 0) * 100;

  const callVol = calls.reduce((s, c) => s + (c.volume ?? 0), 0);
  const putVol  = puts.reduce((s, p) => s + (p.volume ?? 0), 0);

  const data: OptionMetric = {
    ticker:       symbol,
    spot:         parseFloat(spot.toFixed(2)),
    dayChangePct: parseFloat(dayChangePct.toFixed(2)),
    expiry:       new Date(target * 1000).toISOString().split("T")[0],
    dte:          Math.round((target - nowSec) / 86400),
    atmIV:        parseFloat(((callIV + putIV) / 2).toFixed(1)),
    pcRatio:      callVol > 0 ? parseFloat((putVol / callVol).toFixed(2)) : 0,
    skew:         parseFloat((putIV - callIV).toFixed(1)),
  };

  metricCache.set(symbol, { data, ts: Date.now() });
  return data;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tickers = (searchParams.get("tickers") ?? "")
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);

  if (tickers.length === 0) return NextResponse.json({ options: [] });

  const results = await Promise.allSettled(tickers.map((t) => metricFor(t)));
  const options: OptionMetric[] = results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { ticker: tickers[i], spot: 0, dayChangePct: 0, expiry: "", dte: 0, atmIV: 0, pcRatio: 0, skew: 0, error: true }
  );

  return NextResponse.json({ options });
}
