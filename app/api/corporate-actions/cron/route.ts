import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMarketDay } from "@/lib/market-calendar";
import { applyCorporateActions, applyCorporateActionsWindow } from "@/lib/corporate-actions";

/**
 * Apply splits / consolidations / dividends effective today to all users'
 * holdings. This also runs automatically as a pre-step of the daily snapshot
 * cron — this standalone endpoint exists for manual triggering / testing and
 * is NOT scheduled separately (keeps us under Hobby-tier cron limits).
 *
 * Secured by CRON_SECRET. Optional ?date=YYYY-MM-DD overrides "today" (for
 * back-testing a known action); ?force=1 ignores the market-closed guard;
 * ?days=N re-scans the N trading days before the target date too (to recover a
 * dividend Yahoo posted late). Default is the single target date only.
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
  const override = url.searchParams.get("date");
  const force = url.searchParams.get("force") === "1";
  const days = Math.max(0, Math.trunc(Number(url.searchParams.get("days") ?? "0")) || 0);
  const today =
    override ??
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

  if (!force && !isMarketDay(today)) {
    return NextResponse.json({ skipped: true, reason: "Market closed", date: today });
  }

  try {
    const db = createAdminClient();
    const summary =
      days > 0
        ? await applyCorporateActionsWindow(db, today, days)
        : await applyCorporateActions(db, today);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export const POST = GET;
