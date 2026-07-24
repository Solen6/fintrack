import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIES, type EventCategory } from "@/lib/calendar-events";

/* Per-user iCal feed category preferences — which event categories sync to a
   subscribed calendar. Session-authed (edited from the Subscribe popover). The
   ICS route reads the same row; an absent row means "all categories" so
   existing subscribers keep getting everything until they change something. */

const SETUP_HINT = "Feed prefs table missing — run supabase/calendar-feed.sql";
const isSetup = (m: string) => /schema cache|does not exist|PGRST205/i.test(m);

const VALID = new Set<EventCategory>(CATEGORIES);

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("calendar_feed_prefs")
    .select("categories")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: isSetup(error.message) ? SETUP_HINT : error.message },
      { status: isSetup(error.message) ? 503 : 500 },
    );
  }

  // No row → default to all categories syncing.
  const categories = data?.categories ?? [...CATEGORIES];
  return NextResponse.json({ categories });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw = Array.isArray(body?.categories) ? body.categories : null;
  if (!raw) return NextResponse.json({ error: "categories[] required" }, { status: 400 });

  // Keep only known categories, dedupe, preserve canonical order.
  const set = new Set(raw.filter((c: unknown): c is EventCategory => VALID.has(c as EventCategory)));
  const categories = CATEGORIES.filter((c) => set.has(c));

  const { error } = await supabase
    .from("calendar_feed_prefs")
    .upsert({ user_id: user.id, categories, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    return NextResponse.json(
      { error: isSetup(error.message) ? SETUP_HINT : error.message },
      { status: isSetup(error.message) ? 503 : 500 },
    );
  }

  return NextResponse.json({ categories });
}
