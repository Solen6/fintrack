/**
 * Treasury par-yield curve — the free input that lets us mark Treasuries (and
 * spread-price corporates/munis) without a per-bond price feed.
 *
 * Primary source: the U.S. Treasury daily par-yield-curve XML feed (no key).
 * Fallback: a coarse 4-point curve from Yahoo yield indices (^IRX/^FVX/^TNX/^TYX),
 * so pricing degrades gracefully if the Treasury feed is unreachable (e.g. from
 * a Vercel datacenter IP). If both fail, callers hold bonds at cost.
 */

import { fetchQuote } from "./finnhub";

export interface CurvePoint {
  /** Tenor in years. */
  years: number;
  /** Par yield, percent. */
  yield: number;
}

export interface TreasuryCurve {
  points: CurvePoint[];
  asOf: string; // yyyy-mm-dd
  source: "treasury" | "yahoo";
}

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6h — the curve updates once per business day
let cache: { data: TreasuryCurve; ts: number } | null = null;

const TENORS: Array<{ tag: string; years: number }> = [
  { tag: "BC_1MONTH", years: 1 / 12 },
  { tag: "BC_2MONTH", years: 2 / 12 },
  { tag: "BC_3MONTH", years: 0.25 },
  { tag: "BC_4MONTH", years: 4 / 12 },
  { tag: "BC_6MONTH", years: 0.5 },
  { tag: "BC_1YEAR", years: 1 },
  { tag: "BC_2YEAR", years: 2 },
  { tag: "BC_3YEAR", years: 3 },
  { tag: "BC_5YEAR", years: 5 },
  { tag: "BC_7YEAR", years: 7 },
  { tag: "BC_10YEAR", years: 10 },
  { tag: "BC_20YEAR", years: 20 },
  { tag: "BC_30YEAR", years: 30 },
];

function tag(xml: string, name: string): number | null {
  const m = xml.match(new RegExp(`<d:${name}[^>]*>([^<]+)</d:${name}>`));
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

async function fetchTreasuryXml(yyyymm: string): Promise<TreasuryCurve | null> {
  const url =
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml" +
    `?data=daily_treasury_yield_curve&field_tdr_date_value_month=${yyyymm}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; fintrack/1.0)" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const entries = xml.match(/<entry[\s\S]*?<\/entry>/g);
    if (!entries || entries.length === 0) return null;
    const last = entries[entries.length - 1]; // most recent date in the month
    const date = last.match(/<d:NEW_DATE[^>]*>([^<]+)</)?.[1]?.slice(0, 10) ?? yyyymm;
    const points: CurvePoint[] = [];
    for (const t of TENORS) {
      const y = tag(last, t.tag);
      if (y !== null) points.push({ years: t.years, yield: y });
    }
    if (points.length < 3) return null;
    points.sort((a, b) => a.years - b.years);
    return { points, asOf: date, source: "treasury" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchYahooFallback(): Promise<TreasuryCurve | null> {
  // ^IRX = 13wk bill, ^FVX = 5yr, ^TNX = 10yr, ^TYX = 30yr — Yahoo quotes these
  // directly in percent (the macro route relies on the same for ^TNX).
  const map: Array<{ sym: string; years: number }> = [
    { sym: "^IRX", years: 0.25 },
    { sym: "^FVX", years: 5 },
    { sym: "^TNX", years: 10 },
    { sym: "^TYX", years: 30 },
  ];
  const points: CurvePoint[] = [];
  for (const m of map) {
    const q = await fetchQuote(m.sym);
    if (q?.price && Number.isFinite(q.price)) points.push({ years: m.years, yield: q.price });
  }
  if (points.length < 2) return null;
  points.sort((a, b) => a.years - b.years);
  return { points, asOf: new Date().toISOString().slice(0, 10), source: "yahoo" };
}

/** Cached daily Treasury curve, or null if every source is unreachable. */
export async function getTreasuryCurve(): Promise<TreasuryCurve | null> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data;

  const now = new Date();
  const thisMonth = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevMonth = `${prev.getUTCFullYear()}${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;

  let curve = await fetchTreasuryXml(thisMonth);
  if (!curve) curve = await fetchTreasuryXml(prevMonth); // early in the month there may be no rows yet
  if (!curve) curve = await fetchYahooFallback();
  if (!curve) return cache?.data ?? null; // serve stale on total failure

  cache = { data: curve, ts: Date.now() };
  return curve;
}

/** Linear-interpolate the par yield (%) at a maturity, clamped to the curve ends. */
export function interpolateYield(curve: TreasuryCurve, years: number): number {
  const pts = curve.points;
  if (pts.length === 0) return 0;
  if (years <= pts[0].years) return pts[0].yield;
  if (years >= pts[pts.length - 1].years) return pts[pts.length - 1].yield;
  for (let i = 1; i < pts.length; i++) {
    if (years <= pts[i].years) {
      const a = pts[i - 1];
      const b = pts[i];
      const w = (years - a.years) / (b.years - a.years);
      return a.yield + w * (b.yield - a.yield);
    }
  }
  return pts[pts.length - 1].yield;
}
