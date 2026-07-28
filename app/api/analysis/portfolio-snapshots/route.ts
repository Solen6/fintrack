import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadPriceablePositions } from "@/lib/portfolio-positions";

/* Yearly snapshots of the user's portfolio composition, plotted on the
   efficient frontier so this year's mix can be compared with previous years'.

   POST is "capture if due": it writes a new row only when the newest existing
   one is at least CAPTURE_EVERY_DAYS old, so the client can call it freely on
   page load without needing to know the schedule. Degrades to a clear setup
   hint until supabase/portfolio-frontier-snapshots.sql is run. */

export const dynamic = "force-dynamic";

const SETUP_HINT = "Snapshots table missing — run supabase/portfolio-frontier-snapshots.sql";
const isSetup = (m: string) => /schema cache|does not exist|PGRST205/i.test(m);
const CAPTURE_EVERY_DAYS = 365;
/** Keep the chart readable and the payload bounded. */
const MAX_ROWS = 12;
const MAX_LEGS = 60;

const setupResponse = (m: string) =>
  NextResponse.json(
    { error: isSetup(m) ? SETUP_HINT : m },
    { status: isSetup(m) ? 503 : 500 },
  );

export interface FrontierSnapshot {
  id: string;
  takenOn: string;
  weights: Record<string, number>;
  totalValue: number | null;
}

function toWeights(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (k && Number.isFinite(n) && n > 0) out[k] = n;
    if (Object.keys(out).length >= MAX_LEGS) break;
  }
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const shape = (r: any): FrontierSnapshot => ({
  id: r.id as string,
  takenOn: String(r.taken_on).slice(0, 10),
  weights: toWeights(r.weights),
  totalValue: r.total_value == null ? null : Number(r.total_value),
});
/* eslint-enable @typescript-eslint/no-explicit-any */

async function listSnapshots(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<FrontierSnapshot[]> {
  const { data, error } = await supabase
    .from("portfolio_frontier_snapshots")
    .select("id,taken_on,weights,total_value")
    .eq("user_id", userId)
    .order("taken_on", { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => shape(r));
}

const daysBetween = (a: string, b: string) =>
  Math.floor((Date.parse(b) - Date.parse(a)) / 86_400_000);

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json({ snapshots: await listSnapshots(supabase, user.id) });
  } catch (e) {
    return setupResponse(e instanceof Error ? e.message : String(e));
  }
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = new Date().toISOString().slice(0, 10);

  try {
    const existing = await listSnapshots(supabase, user.id);
    const newest = existing[0];
    if (newest && daysBetween(newest.takenOn, today) < CAPTURE_EVERY_DAYS) {
      return NextResponse.json({
        captured: false,
        nextDueOn: new Date(Date.parse(newest.takenOn) + CAPTURE_EVERY_DAYS * 86_400_000)
          .toISOString()
          .slice(0, 10),
        snapshots: existing,
      });
    }

    const { positions, riskyValue, totalValue } = await loadPriceablePositions(supabase, user.id);
    if (positions.length === 0) {
      return NextResponse.json({ captured: false, reason: "no priceable positions", snapshots: existing });
    }

    // Percent of the risky sleeve, matching how the tool's mix weights are read.
    const weights: Record<string, number> = {};
    for (const p of positions.slice(0, MAX_LEGS)) {
      if (p.weight > 0) weights[p.ticker] = p.weight * 100;
    }
    if (Object.keys(weights).length === 0 || riskyValue <= 0) {
      return NextResponse.json({ captured: false, reason: "no priceable positions", snapshots: existing });
    }

    const { data, error } = await supabase
      .from("portfolio_frontier_snapshots")
      .insert({ user_id: user.id, taken_on: today, weights, total_value: totalValue })
      .select("id,taken_on,weights,total_value")
      .single();
    if (error) throw error;

    return NextResponse.json({ captured: true, snapshots: [shape(data), ...existing].slice(0, MAX_ROWS) });
  } catch (e) {
    return setupResponse(e instanceof Error ? e.message : String(e));
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase
    .from("portfolio_frontier_snapshots")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return setupResponse(error.message);

  return NextResponse.json({ ok: true });
}
