import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { careerStandings, joinCompetition, serializeCompetition, type CompetitionRow } from "@/lib/competitions";
import type { AssetClass } from "@/lib/paper-types";

const ASSET_CLASSES: AssetClass[] = ["STOCK", "OPTION", "FUTURE", "FOREX"];
// 8 hex chars (~4.3B space) — wide enough that guessing an invite code is
// impractical even without per-endpoint rate limiting.
const genCode = () => randomBytes(4).toString("hex").toUpperCase();

/* ─── GET: list global competitions + the ones I created/joined, or ?code=lookup ─── */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Invite-code preview (join-by-code flow). Resolved with the service-role
  // client because private competitions are not readable by a not-yet-member
  // under RLS; possession of the correct code is the authorization here.
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("competitions")
      .select("*")
      .eq("invite_code", code.trim().toUpperCase())
      .maybeSingle();
    const comp = data as CompetitionRow | null;
    if (!comp) return NextResponse.json({ competition: null }, { status: 404 });
    const [{ count }, { data: mine }] = await Promise.all([
      supabase.from("competition_entries").select("id", { count: "exact", head: true }).eq("competition_id", comp.id),
      supabase.from("competition_entries").select("id").eq("competition_id", comp.id).eq("user_id", user.id).maybeSingle(),
    ]);
    return NextResponse.json({
      competition: serializeCompetition(comp, { entrants: count ?? 0, joined: !!mine, meId: user.id }),
    });
  }

  const [{ data: globalData }, { data: createdData }, { data: myEntries }] = await Promise.all([
    supabase.from("competitions").select("*").eq("scope", "global").order("created_at", { ascending: false }),
    supabase.from("competitions").select("*").eq("creator_id", user.id),
    supabase.from("competition_entries").select("competition_id").eq("user_id", user.id),
  ]);

  const joinedIds = new Set((myEntries ?? []).map((e) => e.competition_id as string));
  const known = new Map<string, CompetitionRow>();
  for (const c of [...(globalData ?? []), ...(createdData ?? [])] as CompetitionRow[]) known.set(c.id, c);

  // Pull in joined competitions (e.g. private ones) not already loaded.
  const missing = [...joinedIds].filter((id) => !known.has(id));
  if (missing.length) {
    const { data: joinedComps } = await supabase.from("competitions").select("*").in("id", missing);
    for (const c of (joinedComps ?? []) as CompetitionRow[]) known.set(c.id, c);
  }

  // Entrant counts across all known competitions.
  const ids = [...known.keys()];
  const counts = new Map<string, number>();
  if (ids.length) {
    const { data: entries } = await supabase.from("competition_entries").select("competition_id").in("competition_id", ids);
    for (const e of (entries ?? []) as { competition_id: string }[]) {
      counts.set(e.competition_id, (counts.get(e.competition_id) ?? 0) + 1);
    }
  }

  const ser = (c: CompetitionRow) =>
    serializeCompetition(c, {
      entrants: counts.get(c.id) ?? 0,
      joined: joinedIds.has(c.id),
      meId: user.id,
    });

  const global = ((globalData ?? []) as CompetitionRow[]).map(ser);
  const mine = [...known.values()]
    .filter((c) => joinedIds.has(c.id) || c.creator_id === user.id)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map(ser);

  // All-time career standings (wins / podiums / played) for the podium.
  const career = (await careerStandings(supabase)).map((c) => ({ ...c, isMe: c.userId === user.id }));

  return NextResponse.json({ global, mine, career });
}

/* ─── POST: create a competition (creator auto-joins) ─── */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const name = String(body.name ?? "").trim().slice(0, 60);
  if (!name) return NextResponse.json({ error: "Competition name is required." }, { status: 400 });
  const description = body.description != null ? String(body.description).slice(0, 280) : null;
  const scope = body.scope === "global" ? "global" : "private";

  let startingCash = Number(body.startingCash);
  if (!Number.isFinite(startingCash) || startingCash <= 0) startingCash = 100_000;
  startingCash = Math.min(10_000_000, Math.max(1_000, Math.round(startingCash)));

  const nowMs = Date.now();
  const startsAt = body.startsAt ? new Date(body.startsAt) : new Date(nowMs);
  const endsAt = body.endsAt ? new Date(body.endsAt) : new Date(nowMs + 30 * 86_400_000);
  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
    return NextResponse.json({ error: "Invalid start/end date." }, { status: 400 });
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    return NextResponse.json({ error: "End must be after start." }, { status: 400 });
  }

  const rawClasses = Array.isArray(body.allowedAssetClasses) ? body.allowedAssetClasses : [];
  const allowed = rawClasses
    .map((s: unknown) => String(s).toUpperCase())
    .filter((s: string) => ASSET_CLASSES.includes(s as AssetClass)) as AssetClass[];
  // Only store a restriction if it's an actual subset; empty/all = no restriction.
  const rules = allowed.length > 0 && allowed.length < ASSET_CLASSES.length ? { allowedAssetClasses: allowed } : {};

  const inviteCode = scope === "private" ? genCode() : null;

  const { data, error } = await supabase
    .from("competitions")
    .insert({
      creator_id: user.id,
      name,
      description,
      scope,
      invite_code: inviteCode,
      starting_cash: startingCash,
      rules,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const comp = data as CompetitionRow;
  try { await joinCompetition(supabase, user.id, comp); } catch { /* non-fatal — creator can re-join */ }

  return NextResponse.json({
    competition: serializeCompetition(comp, { entrants: 1, joined: true, meId: user.id }),
  });
}
