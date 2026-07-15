import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildCalendarEvents } from "@/lib/calendar-events";

export type { CalendarEvent, EventCategory } from "@/lib/calendar-events";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 90;
const MAX_DAYS = 400; // covers paging a year ahead; keeps upstream fetch windows sane

/* GET /api/calendar?to=YYYY-MM-DD
   Events are forward-only (today → `to`). Past days on the calendar grid are
   painted from snapshots (day P/L), not from this route. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: holdings } = await supabase
    .from("holdings")
    .select("ticker, name, shares")
    .eq("user_id", user.id);

  const today = new Date().toISOString().split("T")[0];
  const maxTo = new Date(Date.now() + MAX_DAYS * DAY_MS).toISOString().split("T")[0];
  const defTo = new Date(Date.now() + DEFAULT_DAYS * DAY_MS).toISOString().split("T")[0];

  const requested = req.nextUrl.searchParams.get("to");
  const to =
    requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)
      ? requested < today ? defTo : requested > maxTo ? maxTo : requested
      : defTo;

  const events = await buildCalendarEvents(
    user.id,
    (holdings ?? []).map((h) => ({
      ticker: h.ticker as string,
      name: (h.name as string) ?? h.ticker,
      shares: Number(h.shares ?? 0),
    })),
    today,
    to,
  );

  return NextResponse.json({ events, from: today, to });
}
