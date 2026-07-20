import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* Saved custom heatmap layouts (Portfolio tab → heatmap). The "Auto" view is
   implicit and never stored — only the user's dragged arrangements live here.
   All routes degrade to a clear setup hint until supabase/heatmap-views.sql is
   run (mirrors /api/watchlist). */

export interface HeatmapView {
  id: string;
  name: string;
  ordering: string[]; // holding ids in display order
}

const MIGRATION_HINT = "Heatmap views table missing — run supabase/heatmap-views.sql";
const isMissing = (msg?: string) =>
  !!msg && /schema cache|does not exist|relation|PGRST205/i.test(msg);

/** Coerce the JSONB column to a clean string[] regardless of what Postgres hands back. */
function toOrdering(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("heatmap_views")
    .select("id,name,ordering")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissing(error.message)) return NextResponse.json({ views: [], needsMigration: true });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const views: HeatmapView[] = (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    ordering: toOrdering(r.ordering),
  }));
  return NextResponse.json({ views });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const ordering = toOrdering(body.ordering);
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (name.length > 60) return NextResponse.json({ error: "name too long (max 60)" }, { status: 400 });

  const { data, error } = await supabase
    .from("heatmap_views")
    .insert({ user_id: user.id, name, ordering })
    .select("id,name,ordering")
    .single();

  if (error) {
    if (isMissing(error.message)) return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    view: { id: data.id, name: data.name, ordering: toOrdering(data.ordering) } as HeatmapView,
  });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    if (name.length > 60) return NextResponse.json({ error: "name too long (max 60)" }, { status: 400 });
    updates.name = name;
  }
  if (body.ordering !== undefined) updates.ordering = toOrdering(body.ordering);

  const { error } = await supabase
    .from("heatmap_views")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    if (isMissing(error.message)) return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase
    .from("heatmap_views")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    if (isMissing(error.message)) return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
