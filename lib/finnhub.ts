/**
 * Server-side equity quote fetching for /api/quotes, /api/paper (order fills),
 * and /api/snapshots (daily value capture).
 *
 * Previously used Finnhub `d.c` (last trade on one exchange), which diverged
 * by a few cents from what Fidelity shows. Now uses Yahoo Finance
 * `v8/finance/chart → meta.regularMarketPrice`, which matches the NBBO-derived
 * price displayed by Fidelity and most retail brokerages.
 *
 * The request asks for 5-minute bars with `includePrePost=true` so the same
 * round trip also carries the pre/post-market session. That response is a
 * strict superset of the old `interval=1d&includePrePost=false` one — every
 * `meta` field the regular-session values below are built from comes back
 * byte-identical — and it costs no extra REQUESTS, only bytes (~13KB vs ~1KB).
 * Request count is what Yahoo throttles on, and that is unchanged.
 *
 * `v7/finance/quote` would hand us `marketState`/`postMarketPrice` directly but
 * now returns 401 without a crumb+cookie, so the session is derived from the
 * chart's own `meta.currentTradingPeriod` instead. That is deliberately better
 * than a hand-rolled clock: Yahoo reports the real windows for the day, so 1pm
 * early closes are handled for free.
 *
 * ⚠️ `price`/`change`/`changePct` are ALWAYS the regular session. Extended
 * hours lives only in the separate `ext*` fields and must never be substituted
 * in: /api/snapshots/cron runs at 22:00 UTC (6pm ET) — INSIDE the post-market
 * window — so an after-hours mark leaking into `price` would silently record
 * after-hours values as official closes across the whole historical series that
 * daily P/L, the monthly/annual reports and Sharpe/alpha are computed from.
 */

import { mapLimit } from "./async";

const UA = "Mozilla/5.0 (compatible; fintrack/1.0)";

/** Which session the market is in, derived from `meta.currentTradingPeriod`. */
export type MarketState = "pre" | "regular" | "post" | "closed";

export interface FinnhubQuote {
  ticker:    string;
  price:     number;
  change:    number;
  changePct: number;
  open:      number;
  high:      number;
  low:       number;
  prevClose: number;

  /* ---- Extended hours. All optional: every existing caller ignores these and
     keeps the exact behaviour it had before they were added. ---- */

  /** Session at the time of the fetch. Absent only if Yahoo omitted the periods. */
  marketState?: MarketState;
  /** Last pre/post-market print. NOT a substitute for `price`. */
  extPrice?: number;
  /** `extPrice` − regular-session close (the convention Fidelity/Yahoo show). */
  extChange?: number;
  extChangePct?: number;
  /** Epoch seconds of that last extended-hours print. */
  extTime?: number;
  /** Which extended session `extPrice` came from. */
  extSession?: "pre" | "post";
  /** Extended-session closes, oldest → newest, for the row sparkline. */
  extSeries?: number[];
}

// In-memory cache — 60 second TTL
const cache = new Map<string, { data: FinnhubQuote; ts: number }>();
const CACHE_TTL = 60_000;

interface TradingWindow { start: number; end: number }
interface TradingWindows { pre?: TradingWindow; regular?: TradingWindow; post?: TradingWindow }

/** Pull the day's session windows out of `meta.currentTradingPeriod`.
 *  `end > start` rejects the degenerate windows Yahoo reports for instruments
 *  with no real extended session (crypto quotes a zero-length `post`). */
function tradingWindows(cp: unknown): TradingWindows {
  const raw = cp as Record<string, { start?: number; end?: number }> | null | undefined;
  if (!raw) return {};
  const w = (x: { start?: number; end?: number } | undefined): TradingWindow | undefined =>
    x && Number.isFinite(x.start) && Number.isFinite(x.end) && (x.end as number) > (x.start as number)
      ? { start: x.start as number, end: x.end as number }
      : undefined;
  return { pre: w(raw.pre), regular: w(raw.regular), post: w(raw.post) };
}

function marketStateOf(win: TradingWindows, nowSec: number): MarketState {
  const { pre, regular, post } = win;
  if (regular && nowSec >= regular.start && nowSec < regular.end) return "regular";
  if (pre     && nowSec >= pre.start     && nowSec < pre.end)     return "pre";
  if (post    && nowSec >= post.start    && nowSec < post.end)    return "post";
  return "closed";
}

/** Cap on sparkline points. A 4h post session at 5m bars is 48; pre is 66. */
const MAX_EXT_POINTS = 90;

/** How far past the regular close a bar can still count as that day's post
 *  session. The window itself is 4h; 8h leaves slack for an early close while
 *  never reaching the next day's pre-market. */
const POST_SPAN_SEC = 8 * 3600;

/** Build the extended-hours view from the intraday bars, or null if there is
 *  none worth showing. Returns nothing during the regular session — once the
 *  opening bell rings the pre-market move is already inside the day change, so
 *  showing it alongside would double-count it.
 *
 *  ⚠️ The post session is sliced relative to `regularClose`
 *  (`meta.regularMarketTime`) and NOT to `currentTradingPeriod.post`. After
 *  midnight ET Yahoo advances `currentTradingPeriod` to the NEXT session while
 *  the returned bars still belong to the last one — matching on that window
 *  silently yields zero bars all night. Anchoring on the close timestamp also
 *  keeps `extChange` self-consistent with `price` by construction: both are
 *  measured from the same close. */
function extendedHours(
  hasPrePost: boolean,
  state: MarketState,
  win: TradingWindows,
  timestamps: number[],
  closes: (number | null)[],
  regularPrice: number,
  regularClose: number | undefined,
): Pick<FinnhubQuote, "extPrice" | "extChange" | "extChangePct" | "extTime" | "extSession" | "extSeries"> | null {
  if (!hasPrePost || state === "regular" || !(regularPrice > 0)) return null;

  // "closed" after the post window still reports that post session — it is the
  // most recent extended print, and it is what you want to see in the evening.
  const session: "pre" | "post" = state === "pre" ? "pre" : "post";

  // Pre-market is bounded by its own window, which is the correct day while we
  // are actually in it. Post is anchored to the close it trades away from.
  const inSession = (t: number): boolean => {
    if (session === "pre") return win.pre ? t >= win.pre.start && t < win.pre.end : false;
    if (regularClose !== undefined) return t > regularClose && t <= regularClose + POST_SPAN_SEC;
    return win.post ? t >= win.post.start : false;
  };

  const pts: { t: number; c: number }[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i];
    const c = closes[i];
    if (!Number.isFinite(t) || c === null || !Number.isFinite(c)) continue;
    if (inSession(t)) pts.push({ t, c: c as number });
  }
  if (pts.length === 0) return null;

  const last = pts[pts.length - 1];
  return {
    extPrice:     last.c,
    extChange:    last.c - regularPrice,
    extChangePct: ((last.c - regularPrice) / regularPrice) * 100,
    extTime:      last.t,
    extSession:   session,
    extSeries:    pts.slice(-MAX_EXT_POINTS).map((p) => Math.round(p.c * 10000) / 10000),
  };
}

export async function fetchQuote(ticker: string): Promise<FinnhubQuote | null> {
  const key = ticker.trim().toUpperCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}` +
      `?interval=5m&range=1d&includePrePost=true`;

    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta?.regularMarketPrice) return null;

    const price:     number = meta.regularMarketPrice;
    const prevClose: number = meta.chartPreviousClose ?? meta.previousClose ?? price;
    const open:      number = meta.regularMarketOpen      ?? prevClose;
    const high:      number = meta.regularMarketDayHigh   ?? price;
    const low:       number = meta.regularMarketDayLow    ?? price;
    const change:    number = meta.regularMarketChange    ?? (price - prevClose);
    const changePct: number = meta.regularMarketChangePercent
      ?? (prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0);

    const win = tradingWindows(meta.currentTradingPeriod);
    const state = marketStateOf(win, Math.floor(Date.now() / 1000));
    const ext = extendedHours(
      meta.hasPrePostMarketData === true,
      state,
      win,
      (result?.timestamp ?? []) as number[],
      (result?.indicators?.quote?.[0]?.close ?? []) as (number | null)[],
      price,
      typeof meta.regularMarketTime === "number" ? meta.regularMarketTime : undefined,
    );

    const quote: FinnhubQuote = {
      ticker: key,
      price,
      change,
      changePct,
      open,
      high,
      low,
      prevClose,
      marketState: state,
      ...(ext ?? {}),
    };
    cache.set(key, { data: quote, ts: Date.now() });
    return quote;
  } catch {
    return null;
  }
}

// Sanity ceiling on a single fetch. The old value (30) silently dropped every
// ticker past the 30th — in /api/snapshots (and its cron, which aggregates
// tickers across ALL users) that meant those holdings fell back to cost basis,
// storing a flat value every day so the affected account never showed a daily
// P/L. Raised well above any real portfolio; concurrency is still bounded at 8
// and the 60s cache absorbs repeats, and callers on the serverless path set
// maxDuration so a larger fetch can't be guillotined mid-flight.
const MAX_QUOTES = 300;

/** Fetch many quotes in parallel (bounded concurrency; 60s cache absorbs repeats). */
export async function fetchQuotes(tickers: string[]): Promise<Record<string, FinnhubQuote>> {
  const quotes: Record<string, FinnhubQuote> = {};
  const results = await mapLimit(tickers.slice(0, MAX_QUOTES), 8, (t) => fetchQuote(t));
  for (const q of results) if (q) quotes[q.ticker] = q;
  return quotes;
}
