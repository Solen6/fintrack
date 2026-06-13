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

// ── Macro calendar ─────────────────────────────────────────────────────────
// Dates published in advance by the Fed / BLS / BEA. Based on 2026 schedule.
// Update annually or when agencies revise release dates.
const MACRO_EVENTS: CalendarEvent[] = [
  // FOMC
  { date: "2026-06-18", category: "Macro", title: "FOMC Rate Decision",           detail: "2:00 PM ET + press conference",    impact: "high" },
  { date: "2026-07-29", category: "Macro", title: "FOMC Rate Decision",           detail: "2:00 PM ET + press conference",    impact: "high" },
  { date: "2026-09-16", category: "Macro", title: "FOMC Rate Decision",           detail: "2:00 PM ET + press conference",    impact: "high" },
  { date: "2026-10-28", category: "Macro", title: "FOMC Rate Decision",           detail: "2:00 PM ET + press conference",    impact: "high" },
  { date: "2026-12-09", category: "Macro", title: "FOMC Rate Decision",           detail: "2:00 PM ET + press conference",    impact: "high" },
  // CPI
  { date: "2026-07-15", category: "Macro", title: "CPI — June",                  detail: "Consumer Price Index, 8:30 AM ET", impact: "high" },
  { date: "2026-08-12", category: "Macro", title: "CPI — July",                  detail: "Consumer Price Index, 8:30 AM ET", impact: "high" },
  { date: "2026-09-11", category: "Macro", title: "CPI — August",                detail: "Consumer Price Index, 8:30 AM ET", impact: "high" },
  { date: "2026-10-14", category: "Macro", title: "CPI — September",             detail: "Consumer Price Index, 8:30 AM ET", impact: "high" },
  { date: "2026-11-13", category: "Macro", title: "CPI — October",               detail: "Consumer Price Index, 8:30 AM ET", impact: "high" },
  { date: "2026-12-11", category: "Macro", title: "CPI — November",              detail: "Consumer Price Index, 8:30 AM ET", impact: "high" },
  // Jobs
  { date: "2026-07-02", category: "Macro", title: "Jobs Report — June",          detail: "Nonfarm payrolls, 8:30 AM ET",    impact: "high" },
  { date: "2026-08-07", category: "Macro", title: "Jobs Report — July",          detail: "Nonfarm payrolls, 8:30 AM ET",    impact: "high" },
  { date: "2026-09-04", category: "Macro", title: "Jobs Report — August",        detail: "Nonfarm payrolls, 8:30 AM ET",    impact: "high" },
  { date: "2026-10-02", category: "Macro", title: "Jobs Report — September",     detail: "Nonfarm payrolls, 8:30 AM ET",    impact: "high" },
  { date: "2026-11-06", category: "Macro", title: "Jobs Report — October",       detail: "Nonfarm payrolls, 8:30 AM ET",    impact: "high" },
  { date: "2026-12-04", category: "Macro", title: "Jobs Report — November",      detail: "Nonfarm payrolls, 8:30 AM ET",    impact: "high" },
  // PCE
  { date: "2026-06-26", category: "Macro", title: "PCE Price Index — May",       detail: "Fed's preferred gauge, 8:30 AM ET", impact: "high" },
  { date: "2026-07-31", category: "Macro", title: "PCE Price Index — June",      detail: "Fed's preferred gauge, 8:30 AM ET", impact: "high" },
  { date: "2026-08-28", category: "Macro", title: "PCE Price Index — July",      detail: "Fed's preferred gauge, 8:30 AM ET", impact: "high" },
  { date: "2026-09-25", category: "Macro", title: "PCE Price Index — August",    detail: "Fed's preferred gauge, 8:30 AM ET", impact: "high" },
  { date: "2026-10-30", category: "Macro", title: "PCE Price Index — September", detail: "Fed's preferred gauge, 8:30 AM ET", impact: "high" },
  { date: "2026-11-25", category: "Macro", title: "PCE Price Index — October",   detail: "Fed's preferred gauge, 8:30 AM ET", impact: "high" },
  // GDP
  { date: "2026-06-25", category: "Macro", title: "GDP — Q1 (final)",            detail: "8:30 AM ET", impact: "med" },
  { date: "2026-07-30", category: "Macro", title: "GDP — Q2 (advance)",          detail: "8:30 AM ET", impact: "med" },
  { date: "2026-08-27", category: "Macro", title: "GDP — Q2 (second)",           detail: "8:30 AM ET", impact: "med" },
  { date: "2026-09-25", category: "Macro", title: "GDP — Q2 (final)",            detail: "8:30 AM ET", impact: "med" },
  { date: "2026-10-29", category: "Macro", title: "GDP — Q3 (advance)",          detail: "8:30 AM ET", impact: "med" },
  // Retail Sales
  { date: "2026-06-16", category: "Macro", title: "Retail Sales — May",          detail: "8:30 AM ET", impact: "med" },
  { date: "2026-07-16", category: "Macro", title: "Retail Sales — June",         detail: "8:30 AM ET", impact: "med" },
  { date: "2026-08-14", category: "Macro", title: "Retail Sales — July",         detail: "8:30 AM ET", impact: "med" },
  { date: "2026-09-15", category: "Macro", title: "Retail Sales — August",       detail: "8:30 AM ET", impact: "med" },
  // Michigan Sentiment
  { date: "2026-06-26", category: "Macro", title: "U. Michigan Sentiment (final)", detail: "10:00 AM ET", impact: "low" },
  { date: "2026-07-17", category: "Macro", title: "U. Michigan Sentiment (prelim)", detail: "10:00 AM ET", impact: "low" },
  { date: "2026-08-14", category: "Macro", title: "U. Michigan Sentiment (prelim)", detail: "10:00 AM ET", impact: "low" },
  { date: "2026-09-11", category: "Macro", title: "U. Michigan Sentiment (prelim)", detail: "10:00 AM ET", impact: "low" },
];

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

  const macroEvents = MACRO_EVENTS.filter((e) => e.date >= today && e.date <= endDate);

  const all = [...macroEvents, ...earningsEvents, ...dividendEvents].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  return NextResponse.json({ events: all });
}
