import { NextResponse, type NextRequest } from "next/server";

/**
 * Next earnings date for a single ticker (used by the Options P/L matrix to mark
 * the IV-crush window before expiry). Finnhub `/calendar/earnings?symbol=`.
 * Returns { date: "YYYY-MM-DD" | null }. Auth-gated via middleware like the rest
 * of the options tab.
 */
const KEY = process.env.FINNHUB_API_KEY;
const cache = new Map<string, { date: string | null; ts: number }>();
const TTL = 6 * 60 * 60_000; // 6h

function ymd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

export async function GET(request: NextRequest) {
  const ticker = (request.nextUrl.searchParams.get("ticker") ?? "").trim().toUpperCase();
  if (!ticker) return NextResponse.json({ error: "ticker is required." }, { status: 400 });
  if (!KEY) return NextResponse.json({ date: null });

  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.ts < TTL) return NextResponse.json({ date: hit.date });

  try {
    const now = new Date();
    const from = ymd(now);
    const to = ymd(new Date(now.getTime() + 150 * 86400_000));
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(ticker)}&token=${KEY}`;
    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ date: null });
    const json = await res.json();
    const rows = (json?.earningsCalendar ?? []) as Array<{ date: string }>;
    // Earliest dated entry on/after today.
    const dates = rows.map((r) => r.date).filter((d) => d && d >= from).sort();
    const date = dates[0] ?? null;
    cache.set(ticker, { date, ts: Date.now() });
    return NextResponse.json({ date });
  } catch {
    return NextResponse.json({ date: null });
  }
}
