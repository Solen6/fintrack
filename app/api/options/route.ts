import { NextResponse } from "next/server";

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

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Yahoo cookie+crumb (auth handshake) cached ~1h; per-ticker metrics cached 15m
let authCache: { cookie: string; crumb: string; ts: number } | null = null;
const AUTH_TTL = 60 * 60_000;
const metricCache = new Map<string, { data: OptionMetric; ts: number }>();
const METRIC_TTL = 15 * 60_000;

async function getAuth(force = false): Promise<{ cookie: string; crumb: string }> {
  if (!force && authCache && Date.now() - authCache.ts < AUTH_TTL) return authCache;

  const cookieRes = await fetch("https://fc.yahoo.com", { headers: { "User-Agent": UA } });
  const setCookies =
    (cookieRes.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");

  const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie },
  });
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes("<")) throw new Error("Failed to obtain Yahoo crumb");

  authCache = { cookie, crumb, ts: Date.now() };
  return authCache;
}

interface YContract {
  strike: number;
  impliedVolatility?: number;
  volume?: number;
  openInterest?: number;
}

async function fetchChain(symbol: string, date?: number) {
  const dateParam = date ? `&date=${date}` : "";
  const build = (crumb: string) =>
    `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(crumb)}${dateParam}`;

  let { cookie, crumb } = await getAuth();
  let res = await fetch(build(crumb), { headers: { "User-Agent": UA, Cookie: cookie } });

  // Crumb can go stale — refresh once on 401
  if (res.status === 401) {
    ({ cookie, crumb } = await getAuth(true));
    res = await fetch(build(crumb), { headers: { "User-Agent": UA, Cookie: cookie } });
  }
  if (!res.ok) throw new Error(`Yahoo options ${symbol} ${res.status}`);

  const json = await res.json();
  const result = json?.optionChain?.result?.[0];
  if (!result) throw new Error(`No option chain for ${symbol}`);
  return result;
}

async function metricFor(symbol: string): Promise<OptionMetric> {
  const hit = metricCache.get(symbol);
  if (hit && Date.now() - hit.ts < METRIC_TTL) return hit.data;

  const first = await fetchChain(symbol);
  const quote = first.quote ?? {};
  const spot: number = quote.regularMarketPrice ?? 0;
  const dayChangePct: number = quote.regularMarketChangePercent ?? 0;

  const expirations: number[] = first.expirationDates ?? [];
  if (expirations.length === 0) throw new Error(`No expirations for ${symbol}`);

  // Pick the expiry closest to 30 days out — avoids noisy 0DTE implied vol
  const nowSec = Date.now() / 1000;
  const daysTo = (t: number) => Math.abs((t - nowSec) / 86400 - 30);
  const target = expirations.reduce((a, b) => (daysTo(b) < daysTo(a) ? b : a));

  const chainResult = target === expirations[0] ? first : await fetchChain(symbol, target);
  const opt = chainResult.options?.[0] ?? {};
  const calls: YContract[] = opt.calls ?? [];
  const puts: YContract[] = opt.puts ?? [];
  if (calls.length === 0 || puts.length === 0) throw new Error(`Thin chain for ${symbol}`);

  const nearestStrike = (arr: YContract[]) =>
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
