import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { competitionStatus, type CompetitionRow } from "@/lib/competitions";

type Ctx = { params: Promise<{ id: string }> };

/* ─── POST: leave a competition (only before it starts — prevents reset-and-rejoin) ─── */
export async function POST(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase.from("competitions").select("*").eq("id", id).maybeSingle();
  const comp = data as CompetitionRow | null;
  if (!comp) return NextResponse.json({ error: "Competition not found." }, { status: 404 });
  if (competitionStatus(comp) !== "upcoming") {
    return NextResponse.json({ error: "You can only leave before the competition starts." }, { status: 422 });
  }

  const { data: entry } = await supabase
    .from("competition_entries")
    .select("id, account_id")
    .eq("competition_id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!entry) return NextResponse.json({ error: "You're not in this competition." }, { status: 422 });

  // Delete the sandbox account (cascades positions/orders and the entry row).
  await supabase.from("paper_accounts").delete().eq("id", entry.account_id).eq("user_id", user.id);
  await supabase.from("competition_entries").delete().eq("id", entry.id);

  return NextResponse.json({ ok: true });
}
