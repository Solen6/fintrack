import { yahooNextDividend } from "@/lib/yahoo";
import { mapLimit } from "@/lib/async";

/* Shared event builder for the calendar page (/api/calendar) and the iCal
   subscribe feed (/api/calendar/ics). Extracted from the calendar route so the
   feed — which authenticates by token, not session — can reuse the fetchers
   and their caches. */

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;

export type EventCategory = "Macro" | "Earnings" | "Dividend" | "Split";

export interface CalendarEvent {
  date: string; // YYYY-MM-DD
  category: EventCategory;
  title: string;
  detail: string;
  ticker?: string;
  impact?: "high" | "med" | "low";
  /** Estimated total $ for dividend events (shares × last per-share payment).
      Sensitive — masked client-side in Private mode, omitted from the iCal feed. */
  amount?: number;
}

export interface HoldingRef {
  ticker: string;
  name: string;
  shares: number;
}

/* Caches are keyed by user AND window: month navigation asks for different
   `to` dates, and a cache hit for one window must not serve another. Small
   user base → a simple size cap beats an LRU. */
type CacheMap = Map<string, { events: CalendarEvent[]; ts: number }>;
const earningsCache: CacheMap = new Map();
const dividendCache: CacheMap = new Map();
const splitCache: CacheMap = new Map();
const macroCache: CacheMap = new Map();
const EARNINGS_TTL = 30 * 60 * 1000;
const DIVIDEND_TTL = 60 * 60 * 1000;
const SPLIT_TTL = 6 * 60 * 60 * 1000; // splits rarely change
const MACRO_TTL = 6 * 60 * 60 * 1000;
const CACHE_CAP = 200;

function cachePut(cache: CacheMap, key: string, events: CalendarEvent[]) {
  if (cache.size >= CACHE_CAP) cache.clear();
  cache.set(key, { events, ts: Date.now() });
}

// ── Macro calendar (live from TradingView) ─────────────────────────────────
// importance: 1 = high, 0 = medium, -1 = low
async function fetchMacroEvents(from: string, to: string): Promise<CalendarEvent[]> {
  const key = `${from}|${to}`;
  const hit = macroCache.get(key);
  if (hit && Date.now() - hit.ts < MACRO_TTL) return hit.events;
  try {
    const url = `https://economic-calendar.tradingview.com/events?from=${from}T00:00:00.000Z&to=${to}T00:00:00.000Z&countries=US`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Origin": "https://www.tradingview.com" },
    });
    if (!res.ok) return hit?.events ?? [];
    const data = await res.json();
    const raw: Array<{ date: string; title: string; importance: number; source: string; actual: number | null; forecast: number | null; previous: number | null; unit: string }> = data.result ?? [];
    const events: CalendarEvent[] = raw
      .filter((e) => e.importance >= 0)
      .map((e) => {
        const d = new Date(e.date);
        const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
        const parts = [time + " ET"];
        if (e.actual != null) parts.push(`actual: ${e.actual}${e.unit ?? ""}`);
        else if (e.forecast != null) parts.push(`est: ${e.forecast}${e.unit ?? ""}`);
        if (e.previous != null) parts.push(`prev: ${e.previous}${e.unit ?? ""}`);
        return {
          date: d.toISOString().split("T")[0],
          category: "Macro" as const,
          title: e.title,
          detail: parts.join(" · "),
          impact: e.importance === 1 ? "high" as const : e.importance === 0 ? "med" as const : "low" as const,
        };
      });
    cachePut(macroCache, key, events);
    return events;
  } catch {
    return hit?.events ?? [];
  }
}

async function fetchEarnings(ticker: string, from: string, to: string, name: string): Promise<CalendarEvent[]> {
  try {
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`;
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.earningsCalendar ?? []).map((e: { date: string; quarter: number; year: number; hour: string }) => ({
      date: e.date,
      category: "Earnings" as const,
      title: `${name} (${ticker})`,
      detail: `Q${e.quarter} ${e.year} · ${e.hour === "amc" ? "after close" : e.hour === "bmo" ? "before open" : "time TBD"}`,
      ticker,
    }));
  } catch {
    return [];
  }
}

async function fetchDividends(ticker: string, from: string, to: string, shares: number): Promise<CalendarEvent[]> {
  // Finnhub /stock/dividend2 is premium (403 on our free tier). The next ex-date
  // comes from Yahoo quoteSummary instead. It's the next DECLARED ex-date, so it
  // only appears once a company has announced its next dividend (~2–4 weeks out);
  // undeclared future quarters won't show — that's the honest limit of free data.
  const next = await yahooNextDividend(ticker);
  if (!next) return [];
  // "Upcoming" the way a brokerage shows it = the PAYMENT is still ahead, even if
  // the ex-date just passed (e.g. LRCX went ex 6/17 but pays 7/8). Anchor the
  // agenda entry to whichever of pay/ex date is still in the forward window.
  const anchor = next.payDate && next.payDate >= from ? next.payDate : next.exDate;
  if (anchor < from || anchor > to) return [];
  const amt = next.amount != null ? `$${next.amount.toFixed(2)}/sh · ` : "";
  const detail = `${amt}ex ${next.exDate}${next.payDate ? ` · pays ${next.payDate}` : ""}`;
  const est = next.amount != null && shares > 0 ? Math.round(next.amount * shares * 100) / 100 : undefined;
  return [
    {
      date: anchor,
      category: "Dividend" as const,
      title: `${ticker} dividend`,
      detail,
      ticker,
      ...(est != null ? { amount: est } : {}),
    },
  ];
}

async function fetchSplits(ticker: string, from: string, to: string): Promise<CalendarEvent[]> {
  try {
    const p1 = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000);
    const p2 = Math.floor(new Date(`${to}T00:00:00Z`).getTime() / 1000);
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
      `?period1=${p1}&period2=${p2}&interval=1d&events=split`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const data = await res.json();
    const splits = data?.chart?.result?.[0]?.events?.splits as
      | Record<string, { date: number; numerator: number; denominator: number; splitRatio?: string }>
      | undefined;
    if (!splits) return [];
    return Object.values(splits).map((s) => {
      const label = s.splitRatio ?? `${s.numerator}:${s.denominator}`;
      const reverse = s.numerator < s.denominator;
      return {
        date: new Date(s.date * 1000).toISOString().slice(0, 10),
        category: "Split" as const,
        title: `${ticker} ${reverse ? "reverse split (consolidation)" : "stock split"}`,
        detail: `${label} · shares & cost basis auto-adjusted`,
        ticker,
      };
    });
  } catch {
    return [];
  }
}

/** All calendar events for a user's holdings in [from, to], date-sorted. */
export async function buildCalendarEvents(
  userId: string,
  holdings: HoldingRef[],
  from: string,
  to: string,
): Promise<CalendarEvent[]> {
  // Aggregate across accounts: one entry per ticker, shares summed so the
  // dividend $ estimate covers every lot the user holds.
  const byTicker = new Map<string, { name: string; shares: number }>();
  for (const h of holdings) {
    const t = h.ticker.toUpperCase();
    const cur = byTicker.get(t);
    if (cur) cur.shares += h.shares;
    else byTicker.set(t, { name: h.name, shares: h.shares });
  }
  const tickers = [...byTicker.keys()];

  // Reads a per-user+window cache, else fans the per-ticker fetch out in parallel.
  const cachedOrFetch = async (
    cache: CacheMap,
    ttl: number,
    fetchOne: (ticker: string) => Promise<CalendarEvent[]>,
  ): Promise<CalendarEvent[]> => {
    const key = `${userId}|${from}|${to}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < ttl) return hit.events;
    const lists = await mapLimit(tickers, 8, fetchOne);
    const events = lists.flat();
    cachePut(cache, key, events);
    return events;
  };

  // Run all four groups concurrently.
  // Dividends: Yahoo quoteSummary forward ex/pay date. ETF distributions (SPDR
  // sector funds) aren't in any free feed, so they only appear once Yahoo posts
  // the ex-date around ex-day — accepted free-data lag.
  // Splits: the daily cron applies them to holdings on the day they hit.
  const [earningsEvents, dividendEvents, macroEvents, splitEvents] = await Promise.all([
    cachedOrFetch(earningsCache, EARNINGS_TTL, (t) => fetchEarnings(t, from, to, byTicker.get(t)?.name ?? t)),
    cachedOrFetch(dividendCache, DIVIDEND_TTL, (t) => fetchDividends(t, from, to, byTicker.get(t)?.shares ?? 0)),
    fetchMacroEvents(from, to),
    cachedOrFetch(splitCache, SPLIT_TTL, (t) => fetchSplits(t, from, to)),
  ]);

  return [...macroEvents, ...earningsEvents, ...dividendEvents, ...splitEvents].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}
