import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Opt-in public handle — the only identity shown on leaderboards / trade feed. */
const HANDLE_RE = /^[A-Za-z0-9_]{3,20}$/;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("public_profiles")
    .select("handle, avatar")
    .eq("user_id", user.id)
    .maybeSingle();
  return NextResponse.json({ profile: data ?? null });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const handle = String(body.handle ?? "").trim();
  if (!HANDLE_RE.test(handle)) {
    return NextResponse.json({ error: "Handle must be 3–20 letters, numbers, or underscores." }, { status: 400 });
  }
  const avatar = body.avatar != null ? String(body.avatar).slice(0, 8) : null;

  const { error } = await supabase
    .from("public_profiles")
    .upsert({ user_id: user.id, handle, avatar, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "That handle is already taken." }, { status: 422 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, profile: { handle, avatar } });
}
