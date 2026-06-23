import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serializeCompetition, type CompetitionRow } from "@/lib/competitions";

type Ctx = { params: Promise<{ id: string }> };

/* ─── GET: competition detail + my entry's account id ─── */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase.from("competitions").select("*").eq("id", id).maybeSingle();
  const comp = data as CompetitionRow | null;
  if (!comp) return NextResponse.json({ error: "Competition not found." }, { status: 404 });

  const [{ count }, { data: mine }] = await Promise.all([
    supabase.from("competition_entries").select("id", { count: "exact", head: true }).eq("competition_id", id),
    supabase.from("competition_entries").select("id, account_id").eq("competition_id", id).eq("user_id", user.id).maybeSingle(),
  ]);

  return NextResponse.json({
    competition: serializeCompetition(comp, { entrants: count ?? 0, joined: !!mine, meId: user.id }),
    myAccountId: mine?.account_id ?? null,
  });
}

/* ─── DELETE: creator removes their competition (only while they're the sole entrant) ─── */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase.from("competitions").select("*").eq("id", id).maybeSingle();
  const comp = data as CompetitionRow | null;
  if (!comp) return NextResponse.json({ error: "Competition not found." }, { status: 404 });
  if (comp.creator_id !== user.id) {
    return NextResponse.json({ error: "Only the creator can delete this competition." }, { status: 403 });
  }

  const { count } = await supabase
    .from("competition_entries")
    .select("id", { count: "exact", head: true })
    .eq("competition_id", id);
  if ((count ?? 0) > 1) {
    return NextResponse.json({ error: "Can't delete — other players have joined." }, { status: 422 });
  }

  // Remove the creator's own sandbox account (cascades positions/orders + entry),
  // then the competition itself.
  await supabase.from("paper_accounts").delete().eq("competition_id", id).eq("user_id", user.id);
  const { error } = await supabase.from("competitions").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
