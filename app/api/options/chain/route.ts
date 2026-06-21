import { NextResponse } from "next/server";
import { fetchOptionChain } from "@/lib/yahoo";
import { impliedVol, RISK_FREE } from "@/lib/options-math";
import type { ChainStrike } from "@/lib/option-strategies";

/* ─── Response type ─── */
export interface ChainResponse {
  ticker: string;
  spot: number;
  dayChangePct: number;
  expiry: number; // unix seconds of the returned expiry
  expirations: number[]; // all available expiries (unix seconds)
  strikes: ChainStrike[];
  error?: string;
}

// Per-(ticker, expiry) cache, 15m — mirrors the cadence of the old /api/options route.
const cache = new Map<string, { data: ChainResponse; ts: number }>();
const TTL = 15 * 60_000;

type RawContract = {
  strike: number;
  bid?: number;
  ask?: number;
  lastPrice?: number;
  impliedVolatility?: number;
  openInterest?: number;
  volume?: number;
};

function buildStrikes(calls: RawContract[], puts: RawContract[], spot: number, T: number): ChainStrike[] {
  const byStrike = new Map<number, ChainStrike>();
  const blank = (strike: number): ChainStrike => ({
    strike, callBid: 0, callAsk: 0, callIV: 0, callOI: 0, putBid: 0, putAsk: 0, putIV: 0, putOI: 0,
    callVol: 0, putVol: 0,
  });
  // Mid (or last) so we can invert IV when the feed omits it.
  const mid = (c: RawContract) => {
    const b = c.bid ?? 0, a = c.ask ?? 0;
    return b > 0 && a > 0 ? (b + a) / 2 : c.lastPrice ?? 0;
  };
  const resolveIV = (c: RawContract, type: "call" | "put") => {
    if (c.impliedVolatility && c.impliedVolatility > 0) return c.impliedVolatility;
    const m = mid(c);
    if (m > 0 && spot > 0 && T > 0) {
      const v = impliedVol({ type, S: spot, K: c.strike, T, r: RISK_FREE, price: parseFloat(m.toFixed(2)) });
      if (v != null) return v;
    }
    return 0;
  };
  for (const c of calls) {
    const row = byStrike.get(c.strike) ?? blank(c.strike);
    row.callBid = c.bid ?? 0;
    row.callAsk = c.ask ?? 0;
    row.callIV = resolveIV(c, "call");
    row.callOI = c.openInterest ?? 0;
    row.callVol = c.volume ?? 0;
    byStrike.set(c.strike, row);
  }
  for (const p of puts) {
    const row = byStrike.get(p.strike) ?? blank(p.strike);
    row.putBid = p.bid ?? 0;
    row.putAsk = p.ask ?? 0;
    row.putIV = resolveIV(p, "put");
    row.putOI = p.openInterest ?? 0;
    row.putVol = p.volume ?? 0;
    byStrike.set(p.strike, row);
  }
  return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ticker = (searchParams.get("ticker") ?? "").trim().toUpperCase();
  const expiryParam = searchParams.get("expiry");
  const wantExpiry = expiryParam ? parseInt(expiryParam, 10) : undefined;

  if (!ticker) {
    return NextResponse.json({ error: "Missing ?ticker" } satisfies Partial<ChainResponse>, { status: 400 });
  }

  const key = `${ticker}:${wantExpiry ?? "near"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return NextResponse.json(hit.data);

  try {
    const first = await fetchOptionChain(ticker);
    const expirations = first.expirationDates;
    if (expirations.length === 0) {
      return NextResponse.json(
        { error: `No listed options for ${ticker}` } satisfies Partial<ChainResponse>,
        { status: 404 }
      );
    }

    // Default to the expiry nearest ~30 days out (avoids noisy 0DTE chains).
    const nowSec = Date.now() / 1000;
    const nearest = expirations.reduce((a, b) =>
      Math.abs((b - nowSec) / 86400 - 30) < Math.abs((a - nowSec) / 86400 - 30) ? b : a
    );
    const expiry = wantExpiry && expirations.includes(wantExpiry) ? wantExpiry : nearest;

    const chain = expiry === expirations[0] ? first : await fetchOptionChain(ticker, expiry);
    const spot = parseFloat((chain.quote.regularMarketPrice ?? 0).toFixed(2));
    const T = Math.max((expiry - nowSec) / (365 * 86400), 0);
    const data: ChainResponse = {
      ticker,
      spot,
      dayChangePct: parseFloat((chain.quote.regularMarketChangePercent ?? 0).toFixed(2)),
      expiry,
      expirations,
      strikes: buildStrikes(chain.calls, chain.puts, spot, T),
    };

    cache.set(key, { data, ts: Date.now() });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : `Failed to load options for ${ticker}` } satisfies Partial<ChainResponse>,
      { status: 502 }
    );
  }
}
