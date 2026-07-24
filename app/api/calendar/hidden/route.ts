import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* Server-side hidden-event state. Hiding an event in Fintrack persists here so
   the iCal feed can exclude it — that's how a hide in-app propagates to a
   subscribed Apple Calendar (the event's UID simply stops appearing in the feed
   and Apple drops it on the next ~hourly refresh).

   `key` is the stable identity `${date}|${category}|${title}` — computed the
   same way in components/calendar/calendar-shared.ts (eventKey) and in the ICS
   route, so all three agree on what a given event's key is. */

const SETUP_HINT = "Hidden-events table missing — run supabase/calendar-feed.sql";
const isSetup = (m: string) => /schema cache|does not exist|PGRST205/i.test(m);

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("calendar_hidden_events")
    .select("event_key")
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json(
      { error: isSetup(error.message) ? SETUP_HINT : error.message },
      { status: isSetup(error.message) ? 503 : 500 },
    );
  }

  return NextResponse.json({ keys: (data ?? []).map((r) => r.event_key as string) });
}

/* POST { key, hidden } — hidden:true inserts, hidden:false removes. Idempotent
   both ways (unique(user_id, event_key); delete of a missing row is a no-op). */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const key = typeof body?.key === "string" ? body.key : null;
  const hidden = body?.hidden === true;
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  const q = hidden
    ? supabase
        .from("calendar_hidden_events")
        .upsert({ user_id: user.id, event_key: key }, { onConflict: "user_id,event_key" })
    : supabase
        .from("calendar_hidden_events")
        .delete()
        .eq("user_id", user.id)
        .eq("event_key", key);

  const { error } = await q;
  if (error) {
    return NextResponse.json(
      { error: isSetup(error.message) ? SETUP_HINT : error.message },
      { status: isSetup(error.message) ? 503 : 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
