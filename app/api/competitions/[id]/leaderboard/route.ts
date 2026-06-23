import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { serializeCompetition, type CompetitionRow } from "@/lib/competitions";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Standings for one competition. Returns every entry with all board metrics
 * (total return, Sharpe, max drawdown); the client sorts/ranks per the selected
 * board. Scores are the cron-computed snapshot values (as of score_updated_at);
 * entries with no snapshot yet default to start (0% / starting cash).
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase.from("competitions").select("*").eq("id", id).maybeSingle();
  const comp = data as CompetitionRow | null;
  if (!comp) return NextResponse.json({ error: "Competition not found." }, { status: 404 });
  const startingCash = Number(comp.starting_cash);

  const { data: entries } = await supabase
    .from("competition_entries")
    .select("user_id, last_equity, last_return_pct, sharpe, max_drawdown, score_updated_at")
    .eq("competition_id", id);
  const list = (entries ?? []) as {
    user_id: string;
    last_equity: number | null;
    last_return_pct: number | null;
    sharpe: number | null;
    max_drawdown: number | null;
    score_updated_at: string | null;
  }[];

  const profMap = new Map<string, { handle: string; avatar: string | null }>();
  if (list.length) {
    const { data: profiles } = await supabase
      .from("public_profiles")
      .select("user_id, handle, avatar")
      .in("user_id", list.map((e) => e.user_id));
    for (const p of (profiles ?? []) as { user_id: string; handle: string; avatar: string | null }[]) {
      profMap.set(p.user_id, { handle: p.handle, avatar: p.avatar });
    }
  }

  const rows = list.map((e) => {
    const prof = profMap.get(e.user_id);
    return {
      userId: e.user_id,
      handle: prof?.handle ?? "Anonymous",
      avatar: prof?.avatar ?? null,
      returnPct: e.last_return_pct != null ? Number(e.last_return_pct) : 0,
      equity: e.last_equity != null ? Number(e.last_equity) : startingCash,
      sharpe: e.sharpe != null ? Number(e.sharpe) : null,
      maxDrawdown: e.max_drawdown != null ? Number(e.max_drawdown) : 0,
      scoreUpdatedAt: e.score_updated_at ?? null,
      isMe: e.user_id === user.id,
    };
  });

  return NextResponse.json({
    competition: serializeCompetition(comp, { entrants: list.length, joined: rows.some((r) => r.isMe), meId: user.id }),
    rows,
  });
}
