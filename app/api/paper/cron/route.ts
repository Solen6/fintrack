import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { captureSnapshot, evaluateFills } from "@/lib/paper-engine";

/**
 * Scheduled trigger: fills pending limit/stop orders and snapshots equity for
 * every user, even when the app is closed. Secured by CRON_SECRET (Vercel Cron
 * sends it as `Authorization: Bearer <secret>`; also accepts `x-cron-secret`).
 */
function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return request.headers.get("x-cron-secret") === secret;
}

async function run() {
  const db = createAdminClient();

  // Every user that owns a paper account.
  const { data: accts, error } = await db.from("paper_accounts").select("user_id");
  if (error) throw new Error(error.message);
  const userIds = [...new Set((accts ?? []).map((a) => a.user_id as string))];

  let filled = 0;
  for (const uid of userIds) {
    try {
      filled += await evaluateFills(db, uid);
      await captureSnapshot(db, uid);
    } catch {
      // Skip a failing user rather than abort the whole run.
    }
  }
  return { users: userIds.length, filled };
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, ...(await run()) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

// Vercel Cron uses GET; POST kept for manual/local triggering.
export const POST = GET;
