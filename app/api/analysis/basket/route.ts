import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { yahooDailyHistory, type DailyClose } from "@/lib/yahoo";
import { dailyReturns } from "@/lib/analytics/stats";
import type { AnalysisBasketResponse } from "@/lib/analytics/api-types";

export const dynamic = "force-dynamic";

const BENCHMARK = "SPY";
/** Minimum aligned trading days a ticker needs to be included. Low, because a
    ticker's own history is long even for a position held only a few days. */
const MIN_POINTS = 30;
/** Ceiling on basket size. Sized to cover a whole brokerage book rather than a
    hand-picked shortlist; the fetch fan-out below is concurrency-limited so a
    full basket is a few extra seconds, not a thundering herd. */
const MAX_TICKERS = 60;
/** Extra reference tickers (`extra=`) priced alongside the basket so saved and
    model portfolios can be plotted. They do NOT count against MAX_TICKERS and
    do NOT take part in the window intersection — see below. */
const MAX_EXTRA = 30;
/** Parallel Yahoo history fetches in flight at once. */
const FETCH_CONCURRENCY = 8;

/** Parse + dedupe a comma-separated ticker param. */
function parseTickers(raw: string | null): string[] {
  return [
    ...new Set(
      (raw ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)),
    ),
  ];
}

async function pMap<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

function emptyResponse(): AnalysisBasketResponse {
  return {
    asOf: "", dates: [], tickers: [], closes: {}, returns: {},
    benchmark: { ticker: BENCHMARK, closes: [], returns: [] },
    windowDays: 0, windowStart: "", starts: {}, excluded: [], empty: true,
  };
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const days = Math.min(2000, Math.max(60, Number(request.nextUrl.searchParams.get("days")) || 730));
  const requested = parseTickers(request.nextUrl.searchParams.get("tickers")).slice(0, MAX_TICKERS);
  // Reference-only tickers (proxy ETFs behind model portfolios, names held by a
  // saved portfolio but not in the basket). Anything already in the basket is
  // dropped here so it isn't fetched twice.
  const requestedSet = new Set(requested);
  const extra = parseTickers(request.nextUrl.searchParams.get("extra"))
    .filter((s) => !requestedSet.has(s) && s !== BENCHMARK)
    .slice(0, MAX_EXTRA);

  if (requested.length === 0) return NextResponse.json(emptyResponse());

  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 86400;
  const fetchSyms = [...requested, ...extra, BENCHMARK];
  // Adjusted = total return. Mean-variance on price return alone would badly
  // understate income instruments (a T-bill ETF's entire return is distributions).
  const histories = await pMap(fetchSyms, FETCH_CONCURRENCY, (s) =>
    yahooDailyHistory(s, from, to, { adjusted: true }),
  );
  const histBySym = new Map<string, DailyClose[]>();
  fetchSyms.forEach((s, idx) => histBySym.set(s, histories[idx]));

  const excluded: { ticker: string; reason: string }[] = [];
  const maps = new Map<string, Map<string, number>>();
  const starts: Record<string, string> = {};
  for (const s of fetchSyms) {
    const h = histBySym.get(s) ?? [];
    if (s !== BENCHMARK && h.length < MIN_POINTS) {
      excluded.push({ ticker: s, reason: h.length === 0 ? "no price history" : "insufficient history" });
      continue;
    }
    const m = new Map<string, number>();
    for (const d of h) m.set(d.date, d.close);
    maps.set(s, m);
    if (s !== BENCHMARK) starts[s] = h[0]?.date ?? "";
  }

  const benchMap = maps.get(BENCHMARK);
  const included = requested.filter((s) => maps.has(s));
  if (!benchMap || included.length === 0) {
    return NextResponse.json({ ...emptyResponse(), excluded });
  }

  // Intersection of dates across all included tickers + benchmark. Deliberately
  // EXCLUDES `extra`: reference tickers are aligned onto the basket's window
  // below, so a short-history name inside a saved portfolio can never shrink
  // the window the frontier itself is computed over.
  let common: string[] | null = null;
  for (const s of [...included, BENCHMARK]) {
    const m = maps.get(s)!;
    if (common === null) common = [...m.keys()];
    else {
      const set = new Set(m.keys());
      common = common.filter((d) => set.has(d));
    }
  }
  const dates = (common ?? []).sort();
  if (dates.length < MIN_POINTS) {
    return NextResponse.json({ ...emptyResponse(), excluded, windowDays: dates.length, windowStart: dates[0] ?? "" });
  }

  const closes: Record<string, number[]> = {};
  const returns: Record<string, number[]> = {};
  const tickers: { ticker: string; lastClose: number }[] = [];
  for (const s of included) {
    const m = maps.get(s)!;
    const series = dates.map((d) => m.get(d)!);
    closes[s] = series;
    returns[s] = dailyReturns(series);
    tickers.push({ ticker: s, lastClose: series[series.length - 1] });
  }
  // Reference tickers: keep only those covering every date in the settled
  // window, so their returns line up exactly with the basket's.
  const referenced: string[] = [];
  for (const s of extra) {
    const m = maps.get(s);
    if (!m) continue; // already in `excluded` from the short-history pass
    if (!dates.every((d) => m.has(d))) {
      excluded.push({ ticker: s, reason: "history doesn't cover the window" });
      continue;
    }
    const series = dates.map((d) => m.get(d)!);
    closes[s] = series;
    returns[s] = dailyReturns(series);
    referenced.push(s);
  }

  const benchCloses = dates.map((d) => benchMap.get(d)!);

  const payload: AnalysisBasketResponse = {
    asOf: dates[dates.length - 1],
    dates,
    tickers,
    closes,
    returns,
    benchmark: { ticker: BENCHMARK, closes: benchCloses, returns: dailyReturns(benchCloses) },
    windowDays: dates.length,
    windowStart: dates[0],
    starts,
    excluded,
    referenced,
  };
  return NextResponse.json(payload);
}
