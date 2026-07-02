import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateMonthlyReports, prevPeriod } from "@/lib/monthly-reports";

/**
 * Manual trigger for monthly report generation. The scheduled path rides the
 * daily snapshot cron (/api/snapshots/cron) — this endpoint exists for
 * back-testing and backfilling specific months without waiting for the
 * schedule (and keeps us under Hobby-tier cron limits by NOT being registered
 * in vercel.json). Secured by the same CRON_SECRET.
 *
 *   ?period=YYYY-MM  — generate for a specific month (default: last month)
 *   &force=1         — regenerate even if reports already exist
 */
function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return request.headers.get("x-cron-secret") === secret;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());

  const periodParam = request.nextUrl.searchParams.get("period");
  if (periodParam && !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodParam)) {
    return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  }
  const period = periodParam ?? prevPeriod(today);
  if (period >= today.slice(0, 7)) {
    return NextResponse.json({ error: "period must be a closed month" }, { status: 400 });
  }
  const force = request.nextUrl.searchParams.get("force") === "1";

  try {
    const db = createAdminClient();
    const result = await generateMonthlyReports(db, today, undefined, { period, force });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

// Kept for manual triggering parity with the other cron routes.
export const POST = GET;
