"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ──────────────────────────────────────────────────────────────────────────
   Analysis Studio — a launcher for the portfolio-analysis tools. Each card is
   a link into a tool that computes against your live holdings; the launcher
   itself holds no figures, so there is nothing here to keep in sync or mask.

   Colors come from the app tokens (app/globals.css). The category dot uses a
   per-category literal oklch value.
   ────────────────────────────────────────────────────────────────────────── */

const AMBER_FILL = "oklch(0.72 0.14 74 / 0.13)";
const BORDER_HI = "oklch(0.28 0 0)";

type Cat =
  | "risk"
  | "allocation"
  | "performance"
  | "income"
  | "tax"
  | "projections";

const CAT_LABEL: Record<Cat, string> = {
  risk: "Risk",
  allocation: "Allocation",
  performance: "Performance",
  income: "Income",
  tax: "Tax",
  projections: "Projections",
};

const CAT_COLOR: Record<Cat, string> = {
  risk: "oklch(0.66 0.19 25)",
  allocation: "oklch(0.72 0.14 74)",
  performance: "oklch(0.64 0.07 240)",
  income: "oklch(0.72 0.15 152)",
  tax: "oklch(0.62 0.13 300)",
  projections: "oklch(0.72 0.09 190)",
};

interface Tool {
  id: string;
  title: string;
  cat: Cat;
  desc: string;
  search: string;
  icon: ReactNode;
}

function GoArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/* ─── Tool catalog ─── */

const TOOLS: Tool[] = [
  {
    id: "risk-metrics",
    title: "Risk Metrics",
    cat: "risk",
    search: "risk metrics beta volatility sharpe sortino drawdown",
    desc: "Beta, volatility, Sharpe & Sortino, and worst drawdown — the portfolio's ride quality at a glance.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12h3.5l2-6 4 12 2-7 1.5 4H21" />
      </svg>
    ),
  },
  {
    id: "correlation",
    title: "Correlation Matrix",
    cat: "risk",
    search: "correlation matrix diversification pairwise holdings",
    desc: "See which holdings really move together — spot false diversification hiding in the book.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" />
        <path d="M9 3.5v17M15 3.5v17M3.5 9h17M3.5 15h17" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "concentration",
    title: "Concentration",
    cat: "risk",
    search: "concentration hhi position sector weight single-name",
    desc: "Single-name and sector concentration via HHI — how much rides on your biggest bets.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: "stress-test",
    title: "Stress Test",
    cat: "risk",
    search: "stress test scenario shock market crash rates oil drawdown",
    desc: "Shock the book — a −20% market, a rate spike, a bad day — and see the damage before it happens.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3.5l9.2 15.5H2.8z" />
        <path d="M12 10v4.5M12 17.4h.01" />
      </svg>
    ),
  },
  {
    id: "rebalancer",
    title: "Rebalancer",
    cat: "allocation",
    search: "rebalance drift target allocation trades weights",
    desc: "Drift vs. your targets, with the smallest set of trades to get back in line.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
        <circle cx="15" cy="6" r="2" />
        <circle cx="9" cy="12" r="2" />
        <circle cx="17" cy="18" r="2" />
      </svg>
    ),
  },
  {
    id: "factor-exposure",
    title: "Factor Exposure",
    cat: "allocation",
    search: "factor exposure value growth momentum size quality tilt",
    desc: "Your tilts toward value, size, momentum and yield — the style bets under the tickers.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8.5 4.8L12 12.6 3.5 7.8z" />
        <path d="M3.5 12.2L12 17l8.5-4.8" />
      </svg>
    ),
  },
  {
    id: "optimization",
    title: "Portfolio Optimization",
    cat: "allocation",
    search: "optimization efficient frontier markowitz mean variance risk reward sharpe tangency mix cash",
    desc: "Plot your book on the efficient frontier and find the mix that earns the most return for the risk you take.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 20c3-1 5-5 8-9 2.6-4.2 6-6.5 10-7" />
        <circle cx="14.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    id: "attribution",
    title: "Attribution",
    cat: "performance",
    search: "attribution performance selection allocation contribution return brinson sector",
    desc: "Break returns into what you picked vs. how you weighted it — where the alpha actually came from.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 20.5h18" />
        <path d="M6 20.5v-7M12 20.5V5M18 20.5v-10" />
      </svg>
    ),
  },
  {
    id: "benchmark-lab",
    title: "Benchmark Lab",
    cat: "performance",
    search: "benchmark compare spy index blend custom relative alpha beta capture",
    desc: "Race the portfolio against SPY over a window you choose, with alpha, beta, and capture ratios.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17l5.5-5.5 3.5 3.5 7-7.5" />
        <path d="M16 7.5h4v4" />
      </svg>
    ),
  },
  {
    id: "dividend-forecaster",
    title: "Dividend Forecaster",
    cat: "income",
    search: "dividend income yield forecast ex-date calendar payout compounding reinvest drip",
    desc: "Forward income and yield today, plus how reinvested dividends compound over a horizon you set.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="6" rx="7" ry="3" />
        <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
        <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
      </svg>
    ),
  },
  {
    id: "tax-loss-harvester",
    title: "Tax-Loss Harvester",
    cat: "tax",
    search: "tax loss harvest wash sale lots underwater savings",
    desc: "Positions below cost worth realizing, wash-sale windows flagged, and the estimated tax saved.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="2.4" />
        <circle cx="6" cy="18" r="2.4" />
        <path d="M8 7.5l12 9M20 7.5l-8 6M8 16.5l4-3" />
      </svg>
    ),
  },
  {
    id: "monte-carlo",
    title: "Monte Carlo",
    cat: "projections",
    search: "monte carlo projection simulation retirement funding probability outcomes",
    desc: "Thousands of simulated paths for the years ahead, with the odds of hitting your number.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4v16" />
        <path d="M4 9c8.5 0 7.5 5 16 5" />
        <path d="M4 14c6 0 6 4 12 4" />
        <path d="M4 6c9 0 9-1 16-1" />
      </svg>
    ),
  },
];

const CATEGORIES: { key: "all" | Cat; label: string }[] = [
  { key: "all", label: "All" },
  { key: "risk", label: "Risk" },
  { key: "allocation", label: "Allocation" },
  { key: "performance", label: "Performance" },
  { key: "income", label: "Income" },
  { key: "tax", label: "Tax" },
  { key: "projections", label: "Projections" },
];

/* ─── Component ─── */

export function AnalysisClient() {
  const [cat, setCat] = useState<"all" | Cat>("all");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      TOOLS.filter((t) => {
        const catOk = cat === "all" || t.cat === cat;
        const termOk =
          !q || (t.search + " " + t.title + " " + t.desc).toLowerCase().includes(q);
        return catOk && termOk;
      }),
    [cat, q],
  );

  const catCount = (key: "all" | Cat) =>
    key === "all" ? filtered.length : TOOLS.filter((t) => t.cat === key).length;

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-6 pt-7 pb-16">
        {/* Header */}
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
            Portfolio Analysis
          </div>
          <h1 className="mt-1.5 mb-1 text-[23px] font-semibold tracking-tight text-balance">
            Analysis Studio
          </h1>
          <p className="m-0 max-w-[52ch] text-[13.5px] text-muted-foreground">
            Focused tools to pressure-test risk, allocation, income, and long-run outcomes — each one
            runs live against your holdings.
          </p>
        </div>

        {/* Toolbar */}
        <div className="my-5 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
            {CATEGORIES.map((c) => {
              const active = cat === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCat(c.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors duration-150",
                    active
                      ? "border-[oklch(0.72_0.14_74_/_0.5)] bg-[oklch(0.72_0.14_74_/_0.13)] text-primary"
                      : "border-border bg-card text-muted-foreground hover:border-[oklch(0.28_0_0)] hover:text-foreground",
                  )}
                >
                  {c.label}
                  <span
                    className={cn(
                      "font-mono text-[10.5px] tabular-nums",
                      active ? "text-primary" : "text-[oklch(0.50_0.006_74)]",
                    )}
                  >
                    {catCount(c.key)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative ml-auto">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              className="pointer-events-none absolute left-2.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[oklch(0.50_0.006_74)]"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools…"
              aria-label="Search analysis tools"
              autoComplete="off"
              className="w-[220px] rounded-sm border border-border bg-card py-2 pl-8 pr-3 text-[13px] text-foreground outline-none transition-[border-color] duration-150 placeholder:text-[oklch(0.50_0.006_74)] focus:border-[oklch(0.72_0.14_74_/_0.5)]"
            />
          </div>
        </div>

        {/* Tool grid */}
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(272px,1fr))]">
          {filtered.map((t) => (
            <Link
              key={t.id}
              href={`/analysis/${t.id}`}
              className="group relative flex min-h-[148px] flex-col overflow-hidden rounded-md border border-border bg-card px-[15px] pt-[15px] pb-[13px] text-left transition-[transform,border-color,background] duration-150 hover:-translate-y-0.5 hover:border-[oklch(0.72_0.14_74_/_0.5)] hover:bg-[oklch(0.145_0_0)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              {/* top rule */}
              <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] origin-left scale-x-0 bg-primary opacity-0 transition-[transform,opacity] duration-200 group-hover:scale-x-100 group-hover:opacity-100 motion-reduce:transition-none" />

              <div className="flex items-start justify-between">
                <span
                  className="grid h-9 w-9 place-items-center rounded-lg text-primary transition-colors duration-150 group-hover:border-[oklch(0.72_0.14_74_/_0.5)] [&>svg]:h-[19px] [&>svg]:w-[19px]"
                  style={{ background: AMBER_FILL, border: `1px solid ${BORDER_HI}` }}
                >
                  {t.icon}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[oklch(0.50_0.006_74)]">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: CAT_COLOR[t.cat] }} />
                  {CAT_LABEL[t.cat]}
                </span>
              </div>

              <div className="mt-3 mb-1 text-[14.5px] font-semibold tracking-tight">{t.title}</div>
              <p className="m-0 line-clamp-2 text-[12.5px] leading-[1.45] text-muted-foreground">
                {t.desc}
              </p>

              <div className="mt-auto flex items-center justify-end border-t border-border pt-3">
                <span className="inline-flex items-center gap-1.5 text-[11.5px] text-[oklch(0.50_0.006_74)] transition-colors duration-150 group-hover:text-primary">
                  Open <GoArrow />
                </span>
              </div>
            </Link>
          ))}

          {filtered.length === 0 && (
            <div className="col-span-full py-10 text-center text-[13px] text-[oklch(0.50_0.006_74)]">
              No tools match that filter.
            </div>
          )}
        </div>

        {/* Footnote */}
        <div className="mt-[26px] flex items-center gap-2 text-[11.5px] text-[oklch(0.50_0.006_74)]">
          <span className="h-[5px] w-[5px] rounded-full bg-primary" />
          Every tool computes live against your holdings — nothing here is pre-filled.
        </div>
      </div>
    </main>
  );
}
