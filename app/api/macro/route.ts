import { NextResponse } from "next/server";

// 15-minute cache
const cache = new Map<string, { data: unknown; ts: number }>();
const TTL = 15 * 60_000;

function cached<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return Promise.resolve(hit.data as T);
  return fn()
    .then((data) => { cache.set(key, { data, ts: Date.now() }); return data; })
    .catch(() => null);
}

/* ─── Yahoo Finance quote ─── */
async function yahooQuote(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; fintrack/1.0)" },
    next: { revalidate: 900 },
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol} ${res.status}`);
  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) throw new Error(`No data for ${symbol}`);
  return {
    price:     meta.regularMarketPrice as number,
    prevClose: (meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice) as number,
  };
}

/* ─── NY Fed EFFR (Effective Fed Funds Rate) ─── */
async function fetchFedFunds() {
  const res = await fetch(
    "https://markets.newyorkfed.org/api/rates/all/latest.json",
    { next: { revalidate: 900 } }
  );
  if (!res.ok) throw new Error(`NY Fed ${res.status}`);
  const json = await res.json();
  type RefRate = { type: string; percentRate?: number; targetRateFrom?: number; targetRateTo?: number; effectiveDate: string };
  const rates: RefRate[] = json?.refRates ?? [];
  const effr = rates.find((r) => r.type === "EFFR");
  if (!effr?.percentRate) throw new Error("No EFFR data");
  // Target range midpoint for display alongside actual rate
  const midpoint =
    effr.targetRateFrom != null && effr.targetRateTo != null
      ? (effr.targetRateFrom + effr.targetRateTo) / 2
      : effr.percentRate;
  return { rate: effr.percentRate, target: midpoint };
}

/* ─── BLS CPI-U (no registration key — limited to 25 req/day) ─── */
async function fetchCPI() {
  const currentYear = new Date().getFullYear();
  const res = await fetch("https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      seriesid:  ["CUUR0000SA0"],
      startyear: String(currentYear - 2),
      endyear:   String(currentYear),
    }),
    next: { revalidate: 3600 * 6 }, // BLS data is monthly — cache 6h
  });
  if (!res.ok) throw new Error(`BLS ${res.status}`);
  const json = await res.json();
  if (json.status !== "REQUEST_SUCCEEDED") throw new Error("BLS request failed");

  type BLSPoint = { year: string; period: string; periodName: string; value: string };
  const data: BLSPoint[] = json?.Results?.series?.[0]?.data ?? [];
  if (data.length < 13) throw new Error("Not enough CPI data");

  // Sort newest first (year desc, period desc)
  data.sort((a, b) =>
    a.year !== b.year
      ? Number(b.year) - Number(a.year)
      : b.period.localeCompare(a.period)
  );

  const latest  = parseFloat(data[0].value);
  const yearAgo = parseFloat(data[12].value);
  const yoy     = ((latest - yearAgo) / yearAgo) * 100;

  // Change vs prior month (annualized simple diff in index pts → bps equivalent)
  const priorMonth = parseFloat(data[1].value);
  const momChange  = ((latest - priorMonth) / priorMonth) * 100;

  return { yoy, momChange, period: `${data[0].periodName} ${data[0].year}` };
}

/* ─── Response types ─── */
export interface MacroRateItem {
  label:    string;
  value:    string;
  change:   number;   // raw number: bps for rates, % for others
  unit:     "bps" | "%" | "";
  note?:    string;   // e.g. "as of Apr 2025"
}

export interface MacroResponse {
  rates: MacroRateItem[];
  updatedAt: number; // unix ms
}

function fmt(n: number, decimals = 2) {
  return n.toFixed(decimals);
}

export async function GET() {
  const [tenY, dxy, vix, fed, cpi] = await Promise.all([
    cached("10y",  () => yahooQuote("^TNX")),
    cached("dxy",  () => yahooQuote("DX-Y.NYB")),
    cached("vix",  () => yahooQuote("^VIX")),
    cached("effr", fetchFedFunds),
    cached("cpi",  fetchCPI),
  ]);

  const rates: MacroRateItem[] = [];

  // Fed Funds (EFFR) — target range shown as note, daily diff not available
  if (fed) {
    rates.push({
      label:  "Fed Funds",
      value:  `${fmt(fed.rate, 2)}%`,
      change: 0,
      unit:   "bps",
      note:   `target ${fmt(fed.target, 2)}%`,
    });
  } else {
    rates.push({ label: "Fed Funds", value: "—", change: 0, unit: "bps" });
  }

  // 10Y Treasury — value already in %, change in bps
  if (tenY) {
    const changeBps = Math.round((tenY.price - tenY.prevClose) * 100);
    rates.push({
      label:  "10Y Treasury",
      value:  `${fmt(tenY.price, 2)}%`,
      change: changeBps,
      unit:   "bps",
    });
  } else {
    rates.push({ label: "10Y Treasury", value: "—", change: 0, unit: "bps" });
  }

  // CPI YoY — monthly, no daily change
  if (cpi) {
    rates.push({
      label:  "CPI YoY",
      value:  `${fmt(cpi.yoy, 1)}%`,
      change: parseFloat(fmt(cpi.momChange, 2)),
      unit:   "%",
      note:   cpi.period,
    });
  } else {
    rates.push({ label: "CPI YoY", value: "—", change: 0, unit: "%" });
  }

  // DXY — index level, change in %
  if (dxy) {
    const changePct = ((dxy.price - dxy.prevClose) / dxy.prevClose) * 100;
    rates.push({
      label:  "DXY",
      value:  fmt(dxy.price, 1),
      change: parseFloat(fmt(changePct, 2)),
      unit:   "%",
    });
  } else {
    rates.push({ label: "DXY", value: "—", change: 0, unit: "%" });
  }

  // VIX — index level, change in %
  if (vix) {
    const changePct = ((vix.price - vix.prevClose) / vix.prevClose) * 100;
    rates.push({
      label:  "VIX",
      value:  fmt(vix.price, 1),
      change: parseFloat(fmt(changePct, 2)),
      unit:   "%",
    });
  } else {
    rates.push({ label: "VIX", value: "—", change: 0, unit: "%" });
  }

  return NextResponse.json({ rates, updatedAt: Date.now() } satisfies MacroResponse);
}
