---
target: the dashboard
total_score: 26
p0_count: 0
p1_count: 2
timestamp: 2026-06-12T23-22-12Z
slug: components-dashboard-dashboardclient-tsx
---
# Dashboard Critique — components/dashboard/DashboardClient.tsx

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No data-freshness/"as of" indicator; precise mock numbers read as authoritative |
| 2 | Match System / Real World | 3 | Finance terms correct; "Annualized 7.32%" is a static constant, not derived |
| 3 | User Control and Freedom | 2 | Fully static; Performance chart lost the reference's timeframe toggle |
| 4 | Consistency and Standards | 3 | On-brand panel system, but allocation donut breaks the semantic color rule |
| 5 | Error Prevention | 3 | Read-only surface, little to err (n/a-ish) |
| 6 | Recognition Rather Than Recall | 3 | Clear labels + donut legend |
| 7 | Flexibility and Efficiency | 2 | No timeframe toggles, no drill-down, no personalization |
| 8 | Aesthetic and Minimalist Design | 3 | Clean and restrained; card monotony + flat hierarchy hold it back |
| 9 | Error Recovery | 3 | Charts have skeleton loading fallback |
| 10 | Help and Documentation | 2 | No metric tooltips; no empty/first-run guidance |
| **Total** | | **26/40** | **Competent, solid, clear room to lead** |

## Anti-Patterns Verdict

**LLM assessment:** Not screaming "AI made this" — it's dark, amber, mono-numeric, and genuinely on-brand. The two slop risks are compositional: (1) a row of 4 identical KPI stat cards (the hero-metric-template family), and (2) every section wrapped in the same `rounded-md border bg-card p-4` panel, so the page reads as a uniform grid of equal containers with no focal anchor.

**Deterministic scan:** detect.mjs over components/dashboard/ returned `[]` (exit 0) — no gradient text, eyebrows, side-stripes, or glass. Clean.

**Visual overlays:** Unavailable. `/dashboard` is auth-gated and port 3000 is held by the user's own dev server, so no reliable in-browser overlay. Review is source-based.

## Overall Impression
A competent, on-brand dashboard that's playing it safe. It reads cleanly but everything weighs the same — four equal KPIs, six equal panels. Biggest opportunity: establish one clear focal point and stop letting the brand/semantic colors leak into decorative roles.

## What's Working
- **Mono-for-numbers discipline** — every figure is tabular Geist Mono; KPI values and the holdings table scan like a real ledger.
- **Restraint** — no gradients, no glass, no gamification; the dark/amber treatment is consistent with the rest of the app.
- **Internally consistent data** — KPIs, allocation, and the holdings table reconcile from one source, so nothing contradicts.

## Priority Issues

- **[P1] Semantic color leak in the allocation donut.** Stocks = amber (the brand/active color), Bonds = emerald (which means "gain" everywhere else), Crypto = copper. This violates both the Single Lamp Rule (amber ≤10%, brand/active only) and the Earned Color Rule (emerald = gain only) just codified in DESIGN.md. **Why it matters:** it dilutes the one-meaning-per-color system that makes the instrument trustworthy. **Fix:** recolor the donut with a neutral graphite-to-steel ramp; keep amber/emerald/ruby out of category roles. **Command:** /impeccable colorize

- **[P1] No "this is sample data" signal.** Precise figures ($22,755.90, +0.85%) look authoritative but are mock, and the Honest-Data principle says placeholders must read as provisional. **Why it matters:** undermines trust the moment real numbers don't match, and risks the user mistaking demo data for their own. **Fix:** add a small "Sample data" badge or "as of" line in the header. **Command:** /impeccable harden

- **[P2] Flat hierarchy / uniform-panel composition.** Every section is the same card; the four KPIs are an identical-stat-card grid. There's no visual anchor. **Why it matters:** the eye has nowhere to land first; "where do I stand?" takes longer than it should. **Fix:** promote Performance Over Time (or the single most important KPI) to hero weight; demote secondary panels (borderless, grouped, or smaller). **Command:** /impeccable layout

- **[P2] Performance chart lost its timeframe control.** The reference had a YTD/1Y toggle; the build renders a single static window. **Why it matters:** the headline chart can't be interrogated, cutting the dashboard's analytical value. **Fix:** add a 1M/6M/YTD/1Y toggle (mirror the Futures/Commodity pattern already in the app). **Command:** /impeccable craft

- **[P3] "Gain / Loss" KPI is ambiguous.** It shows *today's* change but the label reads like an all-time figure, next to a separate "Overall Return" card. **Fix:** relabel "Today's Gain / Loss". **Command:** /impeccable clarify

## Persona Red Flags

**Alex (Power User / Carter, self-directed investor):** Wants to interrogate and act. The Performance chart has no timeframe toggle; no holding row links to detail; no manual refresh. Hits a wall the moment he wants depth — bounces to the Accounts tab.

**Jordan (First-Timer / invited friend, less market-savvy):** Sees "Annualized 7.32%" and "Overall Return" with no tooltip or definition; the four KPI cards blur into one block. No first-run or empty state to orient them. Reads the numbers, doesn't understand what to do next.

## Minor Observations
- Donut "Stocks" in amber competes with the brand wordmark and active nav for the eye.
- Yearly Returns 2026 is a partial year shown like a full one — mark "YTD".
- Best Months is a clean ranking, but no secondary context (no year-over-year standout call-out).
- "Annualized" figure is a hardcoded constant; will read as fake once real data lands.

## Questions to Consider
- What's the ONE number on this page? Right now four KPIs weigh equally — which one is the answer to "where do I stand?"
- Is the dashboard a place to *act* (drill into a holding) or purely a glance? The answer changes whether interactivity is missing or correctly absent.
- How do you signal "sample data" once, clearly, without nagging on every panel?
