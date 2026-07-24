import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* User-added one-off calendar events (e.g. "Fed speaks 8/1"). They render in
   the in-app calendar and sync to the iCal feed under the 'Custom' category —
   which is its own toggle, so a custom event still syncs even when the user has
   turned its natural category (Macro/etc.) off in the feed. Session-authed. */

const SETUP_HINT = "Custom-events table missing — run supabase/calendar-feed.sql";
const isSetup = (m: string) => /schema cache|does not exist|PGRST205/i.test(m);

export interface CustomEventRow {
  id: string;
  date: string;   // YYYY-MM-DD
  title: string;
  detail: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("calendar_custom_events")
    .select("id, event_date, title, detail")
    .eq("user_id", user.id)
    .order("event_date", { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: isSetup(error.message) ? SETUP_HINT : error.message },
      { status: isSetup(error.message) ? 503 : 500 },
    );
  }

  const events: CustomEventRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    date: r.event_date as string,
    title: r.title as string,
    detail: (r.detail as string) ?? "",
  }));
  return NextResponse.json({ events });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const date = typeof body?.date === "string" ? body.date : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const detail = typeof body?.detail === "string" ? body.detail.trim() : "";
  if (!DATE_RE.test(date)) return NextResponse.json({ error: "valid date (YYYY-MM-DD) required" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const { data, error } = await supabase
    .from("calendar_custom_events")
    .insert({ user_id: user.id, event_date: date, title: title.slice(0, 120), detail: detail.slice(0, 300) })
    .select("id, event_date, title, detail")
    .single();
  if (error) {
    return NextResponse.json(
      { error: isSetup(error.message) ? SETUP_HINT : error.message },
      { status: isSetup(error.message) ? 503 : 500 },
    );
  }

  const event: CustomEventRow = {
    id: data.id as string,
    date: data.event_date as string,
    title: data.title as string,
    detail: (data.detail as string) ?? "",
  };
  return NextResponse.json({ event });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase
    .from("calendar_custom_events")
    .delete()
    .eq("user_id", user.id)
    .eq("id", id);
  if (error) {
    return NextResponse.json(
      { error: isSetup(error.message) ? SETUP_HINT : error.message },
      { status: isSetup(error.message) ? 503 : 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
