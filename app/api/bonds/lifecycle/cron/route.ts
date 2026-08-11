import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyBondLifecycle } from "@/lib/bond-lifecycle";

/**
 * Pay every coupon that has come due and redeem every matured bond, across all
 * users. This also runs automatically as a pre-step of the daily snapshot cron
 * — this standalone endpoint exists for manual triggering / testing and is NOT
 * scheduled separately (keeps us under Hobby-tier cron limits), mirroring
 * /api/corporate-actions/cron.
 *
 * Secured by CRON_SECRET. Optional ?date=YYYY-MM-DD overrides "today", which is
 * the whole knob you need for back-testing: the sweep is a catch-up, so running
 * it at a past date pays exactly what was owed by then and nothing after.
 *
 * There is no market-closed guard, unlike the corporate-action cron. Coupon and
 * maturity dates are contractual, not exchange events — they land on weekends
 * and holidays, and refusing to run on those days would just defer the credit.
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

  const url = new URL(request.url);
  const today =
    url.searchParams.get("date") ??
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

  try {
    const db = createAdminClient();
    const summary = await applyBondLifecycle(db, today);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
