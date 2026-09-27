// Yahoo chart closes for the News-tab commodities chart. Shared by the price
// route and the catalysts route so both read the same series from one cache —
// the catalyst markers are placed on dates that must exist in the drawn line.

/* Timeframe → Yahoo range/interval. `intraday` keeps the time component in the date string. */
export const RANGE_MAP: Record<string, { range: string; interval: string; intraday: boolean }> = {
  "1D":  { range: "1d",  interval: "5m",  intraday: true  },
  "5D":  { range: "5d",  interval: "30m", intraday: true  },
  "1M":  { range: "1mo", interval: "1d",  intraday: false },
  "6M":  { range: "6mo", interval: "1d",  intraday: false },
  "YTD": { range: "ytd", interval: "1d",  intraday: false },
  "1Y":  { range: "1y",  interval: "1d",  intraday: false },
  "5Y":  { range: "5y",  interval: "1wk", intraday: false },
};

export interface CandleSeries {
  /** `open` is present on daily bars; catalyst detection uses it to spot the
   *  overnight gaps that continuous futures series show on contract-roll days. */
  data: Array<{ date: string; price: number; open?: number }>;
  /** True when the last bar is TODAY'S STILL-OPEN session, whose close is really
   *  the live price. Anything measuring finished days must drop it. */
  partialLast: boolean;
  currentPrice: number;
  changePct: number;
  basePrice: number;
  /** Yahoo's short name ("NVIDIA Corporation") — used to phrase news searches. */
  name: string | null;
  /** "EQUITY" | "ETF" | "FUTURE" | … */
  instrumentType: string | null;
}

// 1-hour cache
const cache = new Map<string, { data: CandleSeries; ts: number }>();
const TTL = 60 * 60_000;

export async function yahooCandles(symbol: string, tf: string): Promise<CandleSeries> {
  const conf = RANGE_MAP[tf] ?? RANGE_MAP["1Y"];
  const key = `${symbol}:${tf}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${conf.interval}&range=${conf.range}&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; fintrack/1.0)" },
    // ⚠️ Not `next: { revalidate }`: Next's fetch cache is stale-while-revalidate,
    // so an expired entry is still SERVED once — and the in-memory cache above
    // then pins it for an hour. That's how the 1M chart ended a month early
    // (a copy cached Aug 19, still served Sep 14). The in-memory TTL is the
    // rate limit; skip Next's layer.
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol} ${res.status}`);
  const json = await res.json();

  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${symbol}`);

  const timestamps: number[] = result.timestamp ?? [];
  const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
  const opens: number[] = result.indicators?.quote?.[0]?.open ?? [];
  const meta = result.meta ?? {};

  if (timestamps.length === 0 || closes.length === 0) throw new Error(`Empty data for ${symbol}`);

  const data = timestamps
    .map((t, i) => ({
      date:  conf.intraday
        ? new Date(t * 1000).toISOString()
        : new Date(t * 1000).toISOString().split("T")[0],
      price: closes[i] != null ? parseFloat(closes[i].toFixed(2)) : null,
      open:  opens[i] != null ? parseFloat(opens[i].toFixed(2)) : undefined,
    }))
    .filter((d): d is { date: string; price: number; open: number | undefined } => d.price != null);

  const lastClose    = data.length > 0 ? data[data.length - 1].price : 0;
  const currentPrice = meta.regularMarketPrice ?? lastClose;
  const basePrice    = meta.chartPreviousClose ?? (data.length > 0 ? data[0].price : 1);
  const changePct    = basePrice > 0
    ? parseFloat((((currentPrice - basePrice) / basePrice) * 100).toFixed(2))
    : 0;

  const out: CandleSeries = {
    data,
    partialLast: !conf.intraday && isTodayStillOpen(meta, data[data.length - 1]?.date),
    currentPrice,
    changePct,
    basePrice,
    // longName first: shortName is cut at 30 characters, which leaves a stump of
    // a word ("State Street Energy Select Sect") that news searches can't match.
    name: pickName(meta.longName, meta.shortName),
    instrumentType: typeof meta.instrumentType === "string" ? meta.instrumentType : null,
  };
  cache.set(key, { data: out, ts: Date.now() });
  return out;
}

function pickName(longName: unknown, shortName: unknown): string | null {
  if (typeof longName === "string" && longName.trim()) return longName.trim();
  if (typeof shortName !== "string" || !shortName.trim()) return null;
  const short = shortName.trim();
  // No long name (futures): a shortName at the 30-character limit probably ends
  // mid-word, so drop that last token rather than search for half a word.
  return short.length >= 30 ? short.replace(/\s+\S+$/, "") : short;
}

/* Yahoo's last daily bar is today's session while it is still trading, and its
   "close" is the live price. Compare the bar's date with today ON THE EXCHANGE
   (Sydney is already tomorrow when New York is trading), then check the session
   end Yahoo reports. */
function isTodayStillOpen(
  meta: { exchangeTimezoneName?: string; currentTradingPeriod?: { regular?: { end?: number } } },
  lastDate: string | undefined,
): boolean {
  if (!lastDate) return false;
  const timeZone = meta.exchangeTimezoneName || "America/New_York";
  let today: string;
  try {
    today = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return false; // unknown timezone — don't guess the bar is unfinished
  }
  if (lastDate !== today) return false;
  const end = meta.currentTradingPeriod?.regular?.end;
  // No session end published: a bar dated today is assumed still open.
  return typeof end === "number" ? Date.now() < end * 1000 : true;
}
