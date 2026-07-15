import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildCalendarEvents, type CalendarEvent } from "@/lib/calendar-events";
import { icsToken } from "@/lib/ics-feed";

/* iCal subscribe feed — GET /api/calendar/ics?u=<userId>&t=<token>

   Apple Calendar (and any other subscriber) fetches this URL unauthenticated
   on its own schedule, so the route is in proxy publicRoutes and gates access
   with a per-user token instead of a session: HMAC-SHA256(CRON_SECRET, user id).
   The token grants read access to event TITLES only — dividend $ estimates are
   deliberately left out of the feed (they'd sync through iCloud in plaintext).

   Subscribe URL comes from /api/calendar/feed-url (session-authed), so the
   secret never reaches the client — only the derived token does. */

/** RFC 5545 TEXT escaping. */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold content lines to ≤74 octets (continuation lines start with a space). */
function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    parts.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  parts.push(rest);
  return parts.join("\r\n");
}

/** Stable per-event UID: date + djb2 hash of the identity key. */
function eventUid(e: CalendarEvent): string {
  const key = `${e.date}|${e.category}|${e.title}`;
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return `${e.date.replace(/-/g, "")}-${h.toString(16)}@fintrack`;
}

function toIcs(events: CalendarEvent[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fintrack//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Fintrack",
    "X-WR-CALDESC:Macro releases and events for your holdings",
    "X-WR-TIMEZONE:America/New_York",
  ];
  for (const e of events) {
    const day = e.date.replace(/-/g, "");
    // All-day event: DTEND is the following day (exclusive) per RFC 5545.
    const next = new Date(Date.parse(e.date + "T00:00:00Z") + 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10).replace(/-/g, "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${eventUid(e)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${next}`,
      fold(`SUMMARY:${esc(e.impact === "high" ? `⚠ ${e.title}` : e.title)}`),
      fold(`DESCRIPTION:${esc(e.detail)}`),
      `CATEGORIES:${e.category.toUpperCase()}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  const t = req.nextUrl.searchParams.get("t");
  if (!u || !t) return new NextResponse("Missing token", { status: 401 });

  const expected = icsToken(u);
  if (!expected) return new NextResponse("Feed not configured", { status: 503 });

  const a = Buffer.from(t);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new NextResponse("Invalid token", { status: 401 });
  }

  const admin = createAdminClient();
  const { data: holdings } = await admin
    .from("holdings")
    .select("ticker, name, shares")
    .eq("user_id", u);

  const today = new Date().toISOString().split("T")[0];
  const to = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const events = await buildCalendarEvents(
    u,
    (holdings ?? []).map((h) => ({
      ticker: h.ticker as string,
      name: (h.name as string) ?? h.ticker,
      shares: Number(h.shares ?? 0),
    })),
    today,
    to,
  );

  // Strip $ estimates before serializing (defense in depth — toIcs doesn't
  // emit them either, but the feed should never even hold them).
  const publicEvents = events.map(({ amount: _amount, ...rest }) => rest);

  return new NextResponse(toIcs(publicEvents), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="fintrack.ics"',
      "Cache-Control": "private, max-age=1800",
    },
  });
}
