import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Upstash-backed rate limiting for API routes.
 *
 * NOT for login/signup — those go straight from the browser to Supabase Auth,
 * which rate-limits them natively. This guards our own API endpoints, chiefly
 * the invite-code surface (resolve + join) and competition creation (spam).
 *
 * Degrades gracefully on purpose:
 *  - No Upstash env vars (local dev, or before the integration is wired up):
 *    every check is a no-op that ALLOWS the request, logged once in production.
 *  - Upstash configured but unreachable/erroring: we fail OPEN (allow), so a
 *    transient store outage can never lock real users out of the app.
 */

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = url && token ? new Redis({ url, token }) : null;
if (!redis && process.env.NODE_ENV === "production") {
  console.warn(
    "[rate-limit] UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN not set — API rate limiting is DISABLED."
  );
}

function build(window: Parameters<typeof Ratelimit.slidingWindow>, prefix: string) {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(...window),
    prefix,
    analytics: false,
    // Short-circuit obvious over-limit bursts without a round-trip.
    ephemeralCache: new Map(),
  });
}

// Tune windows here. Sliding-window: (max requests, window string).
const limiters = {
  // Invite-code resolve (?code=) + join attempts — the brute-force surface.
  // 20 / minute / IP is plenty for real use and makes guessing an 8-hex-char
  // (~4.3B) code hopeless.
  invite: build([20, "60 s"], "rl:invite"),
  // Competition creation — anti-spam, especially global-scope contests.
  createCompetition: build([5, "3600 s"], "rl:comp-create"),
};

export type LimiterName = keyof typeof limiters;

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
}

/** Check a named limiter for an identifier (an IP or user id). Allows on any error. */
export async function checkRateLimit(
  name: LimiterName,
  identifier: string
): Promise<RateLimitResult> {
  const limiter = limiters[name];
  if (!limiter) return { ok: true, retryAfterSec: 0 }; // not configured → allow
  try {
    const { success, reset } = await limiter.limit(identifier);
    return {
      ok: success,
      retryAfterSec: success ? 0 : Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
    };
  } catch (e) {
    console.error("[rate-limit] check failed, allowing request:", e);
    return { ok: true, retryAfterSec: 0 }; // fail open
  }
}

/** Best-effort client IP from the proxy chain (Vercel sets x-forwarded-for). */
export function clientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Standard 429 response with a Retry-After header. */
export function tooManyRequests(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests. Please slow down and try again in a moment." },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
  );
}
