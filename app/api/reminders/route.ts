import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* Dashboard reminders — a plain checklist. GET list · POST {text} ·
   PATCH {id, done?|text?} · DELETE {id}. */

const setupError = (msg: string) => /schema cache|does not exist|PGRST205/i.test(msg);

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("reminders")
    .select("id,text,done,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: setupError(error.message) ? "Reminders table missing — run supabase/watchlist-reminders.sql" : error.message },
      { status: setupError(error.message) ? 503 : 500 },
    );
  }
  return NextResponse.json({ reminders: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").trim().slice(0, 500);
  if (!text) return NextResponse.json({ error: "Reminder text is empty" }, { status: 400 });

  const { data, error } = await supabase
    .from("reminders")
    .insert({ user_id: user.id, text })
    .select("id,text,done,created_at")
    .single();
  if (error) {
    return NextResponse.json(
      { error: setupError(error.message) ? "Reminders table missing — run supabase/watchlist-reminders.sql" : error.message },
      { status: setupError(error.message) ? 503 : 500 },
    );
  }
  return NextResponse.json({ reminder: data });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const updates: { done?: boolean; text?: string } = {};
  if (typeof body.done === "boolean") updates.done = body.done;
  if (typeof body.text === "string" && body.text.trim()) updates.text = body.text.trim().slice(0, 500);
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("reminders")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { error } = await supabase.from("reminders").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
