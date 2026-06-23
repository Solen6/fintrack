import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { yahooNextDividend } from "@/lib/yahoo";
import { mapLimit } from "@/lib/async";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;

export type EventCategory = "Macro" | "Earnings" | "Dividend" | "Split";

export interface CalendarEvent {
  date: string; // YYYY-MM-DD
  category: EventCategory;
  title: string;
  detail: string;
  ticker?: string;
  impact?: "high" | "med" | "low";
}

// Per-user in-memory cache
const earningsCache = new Map<string, { events: CalendarEvent[]; ts: number }>();
const dividendCache = new Map<string, { events: CalendarEvent[]; ts: number }>();
const splitCache = new Map<string, { events: CalendarEvent[]; ts: number }>();
const EARNINGS_TTL = 30 * 60 * 1000;
const DIVIDEND_TTL = 60 * 60 * 1000;
const SPLIT_TTL = 6 * 60 * 60 * 1000; // splits rarely change; was uncached → re-fetched every load

// ── Macro calendar (live from TradingView) ─────────────────────────────────
// importance: 1 = high, 0 = medium, -1 = low
const macroCache: { events: CalendarEvent[]; ts: number } = { events: [], ts: 0 };
const MACRO_TTL = 6 * 60 * 60 * 1000; // 6h

async function fetchMacroEvents(from: string, to: string): Promise<CalendarEvent[]> {
  if (macroCache.ts && Date.now() - macroCache.ts < MACRO_TTL) return macroCache.events;
  try {
    const url = `https://economic-calendar.tradingview.com/events?from=${from}T00:00:00.000Z&to=${to}T00:00:00.000Z&countries=US`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Origin": "https://www.tradingview.com" },
    });
    if (!res.ok) return macroCache.events;
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
    macroCache.events = events;
    macroCache.ts = Date.now();
    return events;
  } catch {
    return macroCache.events;
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

async function fetchDividends(ticker: string, from: string, to: string): Promise<CalendarEvent[]> {
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
  return [
    {
      date: anchor,
      category: "Dividend" as const,
      title: `${ticker} dividend`,
      detail,
      ticker,
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

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: holdings } = await supabase
    .from("holdings")
    .select("ticker, name")
    .eq("user_id", user.id);

  const tickers = [...new Set((holdings ?? []).map((h) => h.ticker.toUpperCase()))];
  const nameMap = Object.fromEntries((holdings ?? []).map((h) => [h.ticker.toUpperCase(), h.name]));

  const today = new Date().toISOString().split("T")[0];
  const endDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  // Reads a per-user cache, else fans the per-ticker fetch out in parallel
  // (was three sequential loops with a 50ms sleep each — the main slowness).
  const cachedOrFetch = async (
    cache: Map<string, { events: CalendarEvent[]; ts: number }>,
    ttl: number,
    fetchOne: (ticker: string) => Promise<CalendarEvent[]>,
  ): Promise<CalendarEvent[]> => {
    const hit = cache.get(user.id);
    if (hit && Date.now() - hit.ts < ttl) return hit.events;
    const lists = await mapLimit(tickers, 8, fetchOne);
    const events = lists.flat();
    cache.set(user.id, { events, ts: Date.now() });
    return events;
  };

  // Run all four groups concurrently (they were sequential).
  // Dividends: Yahoo quoteSummary forward ex/pay date. ETF distributions (SPDR
  // sector funds) aren't in any free feed, so they only appear once Yahoo posts
  // the ex-date around ex-day — accepted free-data lag.
  // Splits: the daily cron applies them to holdings on the day they hit.
  const [earningsEvents, dividendEvents, macroEvents, splitEvents] = await Promise.all([
    cachedOrFetch(earningsCache, EARNINGS_TTL, (t) => fetchEarnings(t, today, endDate, nameMap[t] ?? t)),
    cachedOrFetch(dividendCache, DIVIDEND_TTL, (t) => fetchDividends(t, today, endDate)),
    fetchMacroEvents(today, endDate),
    cachedOrFetch(splitCache, SPLIT_TTL, (t) => fetchSplits(t, today, endDate)),
  ]);

  const all = [...macroEvents, ...earningsEvents, ...dividendEvents, ...splitEvents].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  return NextResponse.json({ events: all });
}
