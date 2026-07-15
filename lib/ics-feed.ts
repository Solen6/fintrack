import { createHmac } from "node:crypto";

/* Per-user token for the public iCal feed (/api/calendar/ics).

   Apple Calendar fetches the feed unauthenticated, so access is gated by
   HMAC-SHA256(CRON_SECRET, user id) instead of a session. Derived — no table,
   no rotation surface beyond CRON_SECRET itself. Grants read access to event
   titles only; dividend $ estimates never enter the feed. */
export function icsToken(userId: string): string | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(`ics-feed:${userId}`).digest("hex");
}
