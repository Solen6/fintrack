import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { competitionStatus, joinCompetition, type CompetitionRow } from "@/lib/competitions";

type Ctx = { params: Promise<{ id: string }> };

/* ─── POST: join a competition (private requires the invite code) ─── */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));

  // Load via service-role: a not-yet-member can't read a private competition
  // under RLS, but they may join it by presenting the correct invite code
  // (validated below). The entry/account inserts below run under the user's
  // own RLS, so this read can't be used to write anyone else's data.
  const admin = createAdminClient();
  const { data } = await admin.from("competitions").select("*").eq("id", id).maybeSingle();
  const comp = data as CompetitionRow | null;
  if (!comp) return NextResponse.json({ error: "Competition not found." }, { status: 404 });
  if (competitionStatus(comp) === "ended") {
    return NextResponse.json({ error: "This competition has ended." }, { status: 422 });
  }

  // Private contests require the invite code (the creator is exempt).
  if (comp.scope === "private" && comp.creator_id !== user.id) {
    const code = String(body.inviteCode ?? "").trim().toUpperCase();
    if (!comp.invite_code || code !== comp.invite_code) {
      return NextResponse.json({ error: "Invalid invite code." }, { status: 403 });
    }
  }

  try {
    const r = await joinCompetition(supabase, user.id, comp);
    return NextResponse.json({ ok: true, accountId: r.accountId, alreadyJoined: r.alreadyJoined });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not join." }, { status: 500 });
  }
}
