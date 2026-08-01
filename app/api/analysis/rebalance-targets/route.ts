import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* Per-(user, account) saved rebalance target weights (Analysis tab →
   Rebalancer, one section per account). jsonb map of ticker -> target
   percent. Degrades to a clear setup hint until supabase/rebalance-targets.sql
   is run (mirrors /api/calendar/prefs). `account` defaults to the '__all__'
   sentinel only for robustness against a caller that omits it — every real
   caller today (RebalancerTool) always passes the specific account. */

const SETUP_HINT = "Rebalance targets table missing — run supabase/rebalance-targets.sql";
const isSetup = (m: string) => /schema cache|does not exist|PGRST205/i.test(m);
const DEFAULT_ACCOUNT = "__all__";

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

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = req.nextUrl.searchParams.get("account")?.trim() || DEFAULT_ACCOUNT;

  const { data, error } = await supabase
    .from("rebalance_targets")
    .select("targets")
    .eq("user_id", user.id)
    .eq("account", account)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: isSetup(error.message) ? SETUP_HINT : error.message },
      { status: isSetup(error.message) ? 503 : 500 },
    );
  }

  return NextResponse.json({ account, targets: toTargets(data?.targets) });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!body?.targets || typeof body.targets !== "object") {
    return NextResponse.json({ error: "targets object required" }, { status: 400 });
  }
  const account = (typeof body.account === "string" && body.account.trim()) || DEFAULT_ACCOUNT;
  const targets = toTargets(body.targets);

  const { error } = await supabase
    .from("rebalance_targets")
    .upsert(
      { user_id: user.id, account, targets, updated_at: new Date().toISOString() },
      { onConflict: "user_id,account" },
    );
  if (error) {
    return NextResponse.json(
      { error: isSetup(error.message) ? SETUP_HINT : error.message },
      { status: isSetup(error.message) ? 503 : 500 },
    );
  }

  return NextResponse.json({ account, targets });
}
