import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Force a re-login 12h after sign-in, regardless of activity. Supabase sessions
// auto-refresh indefinitely by default, so we anchor login time in a tamper-
// resistant httpOnly cookie and enforce the cap here on every request.
const LOGIN_ANCHOR = "ft_login_at";
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — do not remove this
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Public routes — no auth needed
  const publicRoutes = ["/login", "/auth/callback", "/api/macro", "/api/commodities", "/api/news", "/api/sentiment", "/api/yieldcurve", "/api/paper/cron", "/api/snapshots/cron", "/api/corporate-actions/cron"];
  const isPublic = publicRoutes.some((r) => pathname.startsWith(r));

  // 12-hour forced logout. The anchor is stamped at sign-in and cleared whenever
  // there is no user, so a fresh login always starts a clean window.
  if (!user) {
    // Drop any stale anchor left over from a prior (signed-out) session.
    if (request.cookies.has(LOGIN_ANCHOR)) {
      supabaseResponse.cookies.set(LOGIN_ANCHOR, "", { maxAge: 0, path: "/" });
    }
  } else {
    const anchorRaw = request.cookies.get(LOGIN_ANCHOR)?.value;
    const anchor = anchorRaw ? Number.parseInt(anchorRaw, 10) : NaN;

    if (Number.isFinite(anchor) && Date.now() - anchor > MAX_SESSION_MS) {
      // Session has outlived the 12h cap — force a re-login.
      await supabase.auth.signOut();
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      loginUrl.searchParams.set("expired", "1");
      const res = NextResponse.redirect(loginUrl);
      // Carry over the cleared Supabase auth cookies, then drop the anchor.
      supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
      res.cookies.set(LOGIN_ANCHOR, "", { maxAge: 0, path: "/" });
      return res;
    }

    if (!Number.isFinite(anchor)) {
      // First authenticated request of a new session — stamp login time.
      supabaseResponse.cookies.set(LOGIN_ANCHOR, String(Date.now()), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: MAX_SESSION_MS / 1000,
      });
    }
  }

  // Redirect unauthenticated users to login
  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    const res = NextResponse.redirect(loginUrl);
    if (request.cookies.has(LOGIN_ANCHOR)) {
      res.cookies.set(LOGIN_ANCHOR, "", { maxAge: 0, path: "/" });
    }
    return res;
  }

  // Redirect authenticated users away from login
  if (user && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/dashboard";
    return NextResponse.redirect(homeUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
