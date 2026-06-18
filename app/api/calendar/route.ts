import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;

export type EventCategory = "Macro" | "Earnings" | "Dividend";

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
const EARNINGS_TTL = 30 * 60 * 1000;
const DIVIDEND_TTL = 60 * 60 * 1000;

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
  try {
    const url = `https://finnhub.io/api/v1/stock/dividend2?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_KEY}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data ?? [])
      .filter((d: { date: string }) => d.date >= from && d.date <= to)
      .map((d: { date: string; amount: number; payDate: string }) => ({
        date: d.date,
        category: "Dividend" as const,
        title: `${ticker} ex-dividend`,
        detail: `$${d.amount?.toFixed(2) ?? "?"}/sh · pay date ${d.payDate ?? "TBD"}`,
        ticker,
      }));
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

  // Earnings — 30 min cache per user
  let earningsEvents: CalendarEvent[] = [];
  const earningsCached = earningsCache.get(user.id);
  if (earningsCached && Date.now() - earningsCached.ts < EARNINGS_TTL) {
    earningsEvents = earningsCached.events;
  } else {
    for (const ticker of tickers) {
      const events = await fetchEarnings(ticker, today, endDate, nameMap[ticker] ?? ticker);
      earningsEvents.push(...events);
      await new Promise((r) => setTimeout(r, 50));
    }
    earningsCache.set(user.id, { events: earningsEvents, ts: Date.now() });
  }

  // Dividends — 1 hr cache per user
  let dividendEvents: CalendarEvent[] = [];
  const dividendCached = dividendCache.get(user.id);
  if (dividendCached && Date.now() - dividendCached.ts < DIVIDEND_TTL) {
    dividendEvents = dividendCached.events;
  } else {
    for (const ticker of tickers) {
      const events = await fetchDividends(ticker, today, endDate);
      dividendEvents.push(...events);
      await new Promise((r) => setTimeout(r, 50));
    }
    dividendCache.set(user.id, { events: dividendEvents, ts: Date.now() });
  }

  const macroEvents = await fetchMacroEvents(today, endDate);

  const all = [...macroEvents, ...earningsEvents, ...dividendEvents].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  return NextResponse.json({ events: all });
}
