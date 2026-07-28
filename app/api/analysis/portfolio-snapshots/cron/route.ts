import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchQuotes } from "@/lib/finnhub";
import { isPriceable } from "@/lib/portfolio-positions";
import { captureDueFrontierSnapshots, type SnapshotHolding } from "@/lib/frontier-snapshots";

/**
 * Standalone trigger for the yearly portfolio-composition snapshot used by the
 * frontier chart's "past years" points.
 *
 * The scheduled run normally RIDES /api/snapshots/cron (Vercel Hobby caps the
 * number of cron jobs, and that one already has every user's holdings and
 * quotes in hand). This endpoint exists so the capture can be triggered on its
 * own — to backfill after running the migration, or to give it a dedicated
 * vercel.json slot on a plan with room. Secured by CRON_SECRET.
 */
export const maxDuration = 120;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return request.headers.get("x-cron-secret") === secret;
}

async function run() {
  // Calendar day in Eastern, matching the daily cron's notion of "today".
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const db = createAdminClient();

  const { data, error } = await db.from("holdings").select("*");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SnapshotHolding[];
  if (rows.length === 0) return { date: today, users: 0, captured: 0 };

  const tickers = [...new Set(rows.filter(isPriceable).map((h) => h.ticker.toUpperCase()))];
  const quotes = tickers.length ? await fetchQuotes(tickers) : {};

  return { date: today, ...(await captureDueFrontierSnapshots(db, today, rows, quotes)) };
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, ...(await run()) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// Vercel Cron uses GET; POST kept for manual triggering.
export const POST = GET;
