import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { icsToken } from "@/lib/ics-feed";

/* Returns the signed-in user's iCal subscribe URL. Session-authed — this is
   the only place the feed token is handed out. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = icsToken(user.id);
  if (!token) {
    return NextResponse.json({ error: "Feed not configured (CRON_SECRET unset)" }, { status: 503 });
  }

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const path = `/api/calendar/ics?u=${encodeURIComponent(user.id)}&t=${token}`;

  return NextResponse.json({
    // webcal:// makes Apple Calendar open the subscribe dialog directly.
    webcal: `webcal://${host}${path}`,
    https: `https://${host}${path}`,
  });
}
