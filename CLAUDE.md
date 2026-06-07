# Fintrack — Project Context

## What this is
Personal finance dashboard for a small group (family/friends). Built with Next.js 16, Tailwind v4, shadcn/ui. Lives at `/Users/carowe/Claude Code/fintrack/`.

## Running it
```bash
cd "/Users/carowe/Claude Code/fintrack" && npm run dev
```
If port 3000 is blocked: `lsof -ti:3000 | xargs kill` then retry.

## Stack
- **Framework:** Next.js 16 (App Router, Turbopack)
- **Styles:** Tailwind v4 + shadcn/ui, OKLCH tokens in `app/globals.css`
- **Charts:** Recharts (SSR-disabled via `nextDynamic` — required to avoid prerender errors)
- **Auth:** Supabase (`@supabase/supabase-js` + `@supabase/ssr`)
- **Fonts:** Geist Sans + Geist Mono
- **Package manager:** npm (cache issues with default cache; use `npm_config_cache=/tmp/npm-cache` if installs fail)

## Design system
Dark-only. Tokens in `app/globals.css` `:root`:
- `--background`: oklch(0.08 0 0) — near-black
- `--card`: oklch(0.12 0 0) — panel surface
- `--primary`: oklch(0.72 0.14 74) — amber/gold brand color
- `--positive`: same as primary — for gains
- `--negative`: oklch(0.64 0.16 28) — warm red for losses
- `--steel`: oklch(0.62 0.07 240) — steel blue for links/secondary
- `--muted-foreground`: oklch(0.64 0.008 74) — secondary text, passes WCAG AA

Palette seed: oklch(0.691 0.146 74.6) — amber/honey. Restrained color strategy.

## Tabs (all 4 complete)
- **Portfolio** (`app/portfolio/page.tsx`): Account sidebar, summary strip, holdings table with sort + row expand for notes. Brokerage/Roth show holdings; HYSA/Checking show balance only.
- **News** (`app/news/page.tsx`): Ticker toggle sidebar, news feed (lead story + list), macro rates panel, commodity chart (Recharts, 365-day % change, catalyst markers, add/remove tickers).
- **Budget** (`app/budget/page.tsx`): Month nav, summary strip (income/expenses/saved/rate), category breakdown with expand-to-transactions, 3D perspective pie chart with hover cross-linking. Categories: Subscriptions, Groceries/Gas, Entertainment, Eating Out, Medical, Gifts, Miscellaneous, Dates.
- **Accounts** (`app/accounts/page.tsx`): OneDrive connection status + file paths, account list with toggles + inline edit + add/remove, profile panel (name/email/real sign out).

## Auth (complete)
- Supabase project: `iztwodsdrtllbmylxsuq.supabase.co`
- Env vars in `.env.local` (never commit this file)
- `middleware.ts` — protects all routes, redirects unauthenticated → `/login`
- `app/login/page.tsx` — sign in + sign up, on-brand dark form
- `app/auth/callback/route.ts` — handles email confirmation redirects
- `lib/supabase/client.ts` — browser Supabase client
- `lib/supabase/server.ts` — server Supabase client (uses cookies)
- Sign out in Accounts tab calls `supabase.auth.signOut()` → redirects to `/login`
- **Before first login:** add `http://localhost:3000` to Supabase Dashboard → Authentication → URL Configuration → Redirect URLs

## Mock data
- Holdings: `lib/mock-data.ts` — 8 brokerage + 5 Roth positions, HYSA $28.4K, Checking $12.3K
- News: `lib/news-data.ts` — seeded PRNG (mulberry32), EPOCH = 2025-06-04 fixed date (avoids hydration mismatch)
- Budget: `lib/budget-data.ts` — 3 months (Apr/May/Jun 2025), 8 categories
- Commodities: Copper (HG), Gold (GC), WTI (CL), Silver (SI) with catalyst events

## Architecture decisions
- Always-dark theme (no light mode toggle)
- Server component wrappers for pages that use Recharts (news, budget) with `nextDynamic` + `ssr: false`
- `export const dynamic = "force-dynamic"` on news page (Recharts prerender issue)
- Recharts: `isAnimationActive={false}` on all Line/Pie components (animation gets stuck in preview)
- EPOCH fixed date in news-data.ts — Math.random() + new Date() at module level causes hydration mismatch

## What's next (backend phase)
1. **OneDrive / Microsoft Graph API** — register an Azure app, get client ID + secret, read real Excel portfolio + budget files
2. **Market data APIs** — Alpha Vantage (stock quotes + news), FRED API (rates/CPI), Yahoo Finance (options/futures)
3. **Deploy** — push to GitHub → connect to Vercel, add env vars in Vercel dashboard

## Product context
See `PRODUCT.md` in the project root for full brand personality, design principles, and anti-references.
