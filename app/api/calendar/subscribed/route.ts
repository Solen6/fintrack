import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* Server-side singular event feed subscription state.
   Subscribing to a specific event (e.g., "Fed Rate Decision") ensures it is included
   in the user's iCal feed even if the overall category (e.g., "Macro") is turned off.

   `key` is the stable identity `${date}|${category}|${title}` matching calendar-shared.ts. */

const SETUP_HINT = "Subscribed-events table missing — run supabase/calendar-subscribed.sql";
const isSetup = (m: string) => /schema cache|does not exist|PGRST205/i.test(m);

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("calendar_subscribed_events")
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

/* POST { key, subscribed } — subscribed:true inserts, subscribed:false removes. */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const key = typeof body?.key === "string" ? body.key : null;
  const subscribed = body?.subscribed === true;
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  const q = subscribed
    ? supabase
        .from("calendar_subscribed_events")
        .upsert({ user_id: user.id, event_key: key }, { onConflict: "user_id,event_key" })
    : supabase
        .from("calendar_subscribed_events")
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
