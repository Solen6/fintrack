import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* Per-user saved rebalance target weights (Analysis tab → Rebalancer). One
   row per user, jsonb map of ticker -> target percent. Degrades to a clear
   setup hint until supabase/rebalance-targets.sql is run (mirrors
   /api/calendar/prefs). */

const SETUP_HINT = "Rebalance targets table missing — run supabase/rebalance-targets.sql";
const isSetup = (m: string) => /schema cache|does not exist|PGRST205/i.test(m);

/** Coerce the jsonb column to a clean Record<ticker, number>. */
function toTargets(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (typeof k === "string" && k && Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("rebalance_targets")
    .select("targets")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: isSetup(error.message) ? SETUP_HINT : error.message },
      { status: isSetup(error.message) ? 503 : 500 },
    );
  }

  return NextResponse.json({ targets: toTargets(data?.targets) });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!body?.targets || typeof body.targets !== "object") {
    return NextResponse.json({ error: "targets object required" }, { status: 400 });
  }
  const targets = toTargets(body.targets);

  const { error } = await supabase
    .from("rebalance_targets")
    .upsert({ user_id: user.id, targets, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    return NextResponse.json(
      { error: isSetup(error.message) ? SETUP_HINT : error.message },
      { status: isSetup(error.message) ? 503 : 500 },
    );
  }

  return NextResponse.json({ targets });
}
