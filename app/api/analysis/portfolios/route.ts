import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* Per-user saved portfolios for the efficient-frontier chart (Analysis tab →
   Portfolio Optimization). Each row is a named ticker -> percent map. Degrades
   to a clear setup hint until supabase/optimizer-portfolios.sql is run (mirrors
   /api/analysis/rebalance-targets). */

const SETUP_HINT = "Saved portfolios table missing — run supabase/optimizer-portfolios.sql";
const isSetup = (m: string) => /schema cache|does not exist|PGRST205/i.test(m);

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const MAX_NAME = 60;
/** Guard rails so one row can't hold an unbounded blob. */
const MAX_LEGS = 60;
const MAX_ROWS = 40;

const setupResponse = (m: string) =>
  NextResponse.json(
    { error: isSetup(m) ? SETUP_HINT : m },
    { status: isSetup(m) ? 503 : 500 },
  );

/** Coerce the jsonb column to a clean Record<ticker, percent>. */
function toWeights(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const ticker = String(k).trim().toUpperCase();
    const n = Number(v);
    if (TICKER_RE.test(ticker) && Number.isFinite(n) && n > 0) out[ticker] = n;
    if (Object.keys(out).length >= MAX_LEGS) break;
  }
  return out;
}

function cleanName(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, MAX_NAME);
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("optimizer_portfolios")
    .select("id,name,weights,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) return setupResponse(error.message);

  const portfolios = (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    weights: toWeights(r.weights),
  }));
  return NextResponse.json({ portfolios });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = cleanName(body?.name);
  const weights = toWeights(body?.weights);
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (Object.keys(weights).length === 0) {
    return NextResponse.json({ error: "at least one positive weight required" }, { status: 400 });
  }

  const { count, error: countErr } = await supabase
    .from("optimizer_portfolios")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (countErr) return setupResponse(countErr.message);
  if ((count ?? 0) >= MAX_ROWS) {
    return NextResponse.json(
      { error: `Portfolio limit reached (${MAX_ROWS}). Delete one first.` },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("optimizer_portfolios")
    .insert({ user_id: user.id, name, weights })
    .select("id,name,weights")
    .single();
  if (error) return setupResponse(error.message);

  return NextResponse.json({ portfolio: { id: data.id, name: data.name, weights: toWeights(data.weights) } });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body?.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    patch.name = name;
  }
  if (body?.weights !== undefined) {
    const weights = toWeights(body.weights);
    if (Object.keys(weights).length === 0) {
      return NextResponse.json({ error: "at least one positive weight required" }, { status: 400 });
    }
    patch.weights = weights;
  }

  const { data, error } = await supabase
    .from("optimizer_portfolios")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id,name,weights")
    .maybeSingle();
  if (error) return setupResponse(error.message);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ portfolio: { id: data.id, name: data.name, weights: toWeights(data.weights) } });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase
    .from("optimizer_portfolios")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return setupResponse(error.message);

  return NextResponse.json({ ok: true });
}
