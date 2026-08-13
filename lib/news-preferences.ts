// Client-safe news personalization preferences for the News tab.
//
// Four layers of filtering live here, all applied on the client so toggles feel
// instant (no refetch needed to re-filter an already-loaded feed):
//   1. Sources — the 7 curated providers. An article is hidden only if its
//      free-text `source` maps to one of these providers AND the user has
//      unchecked it. Articles from anything NOT in the curated set (the user's
//      own RSS feeds, MarketWatch, Yahoo, …) are never touched by this layer —
//      those stay governed by the RSS source manager.
//   2. Types — macro / broad-market / stock-specific. Each article is tagged
//      with one or more types; it's visible if any of its tags is selected.
//   3. Plan — what the user's account at that publisher can actually open. A
//      Basic Seeking Alpha account can read news briefs but not contributor
//      analysis, so telling us the plan lets us stop showing rows that dead-end
//      at a paywall. See SOURCE_ACCESS below for what each publisher exposes.
//   4. Kind — what a row *is* (brief / analysis / transcript / deck / podcast).
//      Seeking Alpha ships all five through one feed; only news and analysis are
//      wanted. Unlike the others this is a product rule, not a user toggle, so it
//      is enforced at merge time in NewsPageClient rather than here.
//
// Persistence is localStorage. Fields added after v1 are read tolerantly — a
// stored blob missing `plans`/`hideLocked` keeps its saved types and sources and
// picks up defaults for the rest, so nobody's existing setup resets.

import type { NewsArticle } from "@/app/api/news/route";
import { classifyKind, isSeekingAlpha, type NewsKind } from "@/lib/news-content-kind";

/* ─── News types ─── */
export type NewsType = "stock" | "macro" | "broad";

export const NEWS_TYPES: { id: NewsType; label: string; desc: string }[] = [
  { id: "stock", label: "Stock-specific", desc: "News tied to your portfolio holdings" },
  { id: "macro", label: "Macro", desc: "Fed, rates, treasuries, commodities, CPI" },
  { id: "broad", label: "Broad market", desc: "Index moves, sentiment, general finance" },
];

/* ─── Plans ───
   Which tier the user holds at a publisher. Two tiers is all any of these
   support in a way we can act on, so "paid" covers Premium / subscriber alike. */
export type PlanTier = "free" | "paid";

/* How a publisher's paywall behaves, and therefore what a plan setting can DO.
   Only two shapes are real, and the difference matters:

   • `openKinds` — the publisher gates by content kind, and the kind is visible in
     the feed. Seeking Alpha is the only one: news briefs are open to everyone,
     contributor analysis needs Premium. So a Basic user's feed can be trimmed to
     exactly what they can read, with no false positives.

   • `paywalled` — effectively everything the publisher sends is subscriber-only,
     and the feed carries NO per-article signal (checked: WSJ, NYT and CNBC RSS
     have no paywall field, and SA article pages 403 to any server-side fetch, so
     detection is not an option). Hiding these would just be the existing on/off
     switch, so a free plan MARKS them with a lock instead — you can still scan
     the headline and know before clicking. `hideLocked` turns marking into
     hiding for anyone who prefers that.

   Publishers that are simply free (Reuters, CNBC) declare nothing and get no
   plan control — a toggle that changes nothing is worse than no toggle. */
export interface SourceAccess {
  openKinds?: Record<PlanTier, NewsKind[]>;
  paywalled?: boolean;
  /** Publisher's own words for its tiers, e.g. Basic / Premium. */
  labels: Record<PlanTier, string>;
  /** One line under the control explaining what picking "free" does. */
  note: string;
}

/* ─── Curated source catalog ───
   `aliases` are matched as case-insensitive substrings against the article's
   free-text `source` (Finnhub/AV publisher name OR an RSS feed name). `rss`, when
   present, is seeded as a custom feed when the source is enabled. `access`, when
   present, gives the source a plan control. */
export interface CuratedSource {
  id: string;
  label: string;
  aliases: string[];
  rss?: { name: string; url: string };
  access?: SourceAccess;
}

const SUBSCRIBER_ACCESS: SourceAccess = {
  paywalled: true,
  labels: { free: "Free", paid: "Subscriber" },
  note: "On Free, articles are marked with a lock — the headline is all you get without a subscription.",
};

export const PREF_SOURCES: CuratedSource[] = [
  {
    id: "seeking-alpha",
    label: "Seeking Alpha",
    aliases: ["seeking alpha", "seekingalpha"],
    rss: { name: "Seeking Alpha", url: "https://seekingalpha.com/feed.xml" },
    access: {
      // Briefs (/news/{id}) are open to everyone; contributor analysis
      // (/article/{slug}) needs Premium. Transcripts and decks are Premium too,
      // but they never reach this gate — SA_ALLOWED_KINDS drops them first.
      openKinds: { free: ["news"], paid: ["news", "analysis"] },
      labels: { free: "Basic", paid: "Premium" },
      note: "Basic shows news briefs only. Contributor analysis needs Premium, so on Basic those rows are hidden rather than dead-ending at a paywall.",
    },
  },
  {
    id: "wsj",
    label: "WSJ",
    aliases: ["wsj", "wall street journal", "dow jones"],
    rss: { name: "WSJ Markets", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.aspx" },
    access: SUBSCRIBER_ACCESS,
  },
  {
    id: "nyt",
    label: "NYT",
    aliases: ["nyt", "new york times", "nytimes"],
    rss: { name: "NYT Business", url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml" },
    access: SUBSCRIBER_ACCESS,
  },
  {
    id: "reuters",
    label: "Reuters",
    aliases: ["reuters"],
    rss: { name: "Reuters Business", url: "https://feeds.reuters.com/reuters/businessNews" },
  },
  {
    id: "cnbc",
    label: "CNBC",
    aliases: ["cnbc"],
    rss: { name: "CNBC Finance", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html" },
  },
  // Bloomberg & FT have no reliable free RSS feed; selecting them only affects
  // visibility of their articles arriving via Finnhub / Alpha Vantage.
  { id: "bloomberg", label: "Bloomberg", aliases: ["bloomberg"], access: SUBSCRIBER_ACCESS },
  {
    id: "financial-times",
    label: "Financial Times",
    aliases: ["financial times", "ft.com", "ft alphaville"],
    access: SUBSCRIBER_ACCESS,
  },
];

export const ALL_SOURCE_IDS = PREF_SOURCES.map((s) => s.id);

export const SOURCE_BY_ID = new Map(PREF_SOURCES.map((s) => [s.id, s]));

/* ─── Seeking Alpha content rule ───
   "Only analysis and news — no transcripts or podcasts." Earnings-call decks and
   conference presentations fall under the same rule: they're neither. This is a
   hard product rule with no toggle, so it's enforced once at merge time (see
   saAllows) instead of in articleVisible — that keeps transcripts from eating
   slots under the 150-article cap before the feed is even rendered. */
export const SA_ALLOWED_KINDS: NewsKind[] = ["news", "analysis"];

/** False for a Seeking Alpha transcript, earnings deck or podcast. */
export function saAllows(a: NewsArticle): boolean {
  if (!isSeekingAlpha(a)) return true;
  return SA_ALLOWED_KINDS.includes(classifyKind(a.headline, a.url));
}

/* ─── Preferences shape & defaults ─── */
export interface NewsPrefs {
  types: NewsType[];
  sources: string[]; // curated source ids the user wants to see
  plans: Record<string, PlanTier>; // curated source id → the tier you hold there
  hideLocked: boolean; // drop locked rows entirely instead of marking them
}

// Plans default to "free" — that's the account almost everyone actually has, and
// it's the honest default: showing a Premium-only row to a Basic user is showing
// them something they can't read. Anyone on Premium flips it once.
export const DEFAULT_PLANS: Record<string, PlanTier> = Object.fromEntries(
  ALL_SOURCE_IDS.map((id) => [id, "free" as PlanTier]),
);

// Otherwise start inclusive: everything visible. The user trims from here.
export const DEFAULT_PREFS: NewsPrefs = {
  types: NEWS_TYPES.map((t) => t.id),
  sources: ALL_SOURCE_IDS,
  plans: DEFAULT_PLANS,
  hideLocked: false,
};

/* ─── Persistence (localStorage) ─── */
export const PREFS_KEY = "fintrack:news:prefs:v1";
export const ONBOARDED_KEY = "fintrack:news:onboarded:v1";

const VALID_TYPES = new Set(NEWS_TYPES.map((t) => t.id));
const VALID_SOURCES = new Set(ALL_SOURCE_IDS);

export function loadPrefs(): NewsPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<NewsPrefs>;
    const types = Array.isArray(parsed.types)
      ? parsed.types.filter((t): t is NewsType => VALID_TYPES.has(t as NewsType))
      : DEFAULT_PREFS.types;
    const sources = Array.isArray(parsed.sources)
      ? parsed.sources.filter((s) => VALID_SOURCES.has(s))
      : DEFAULT_PREFS.sources;
    // Added after v1: a blob saved before plans existed keeps its types and
    // sources and picks up the defaults here rather than resetting.
    const plans = { ...DEFAULT_PLANS };
    if (parsed.plans && typeof parsed.plans === "object") {
      for (const [id, tier] of Object.entries(parsed.plans)) {
        if (VALID_SOURCES.has(id) && (tier === "free" || tier === "paid")) plans[id] = tier;
      }
    }
    const hideLocked =
      typeof parsed.hideLocked === "boolean" ? parsed.hideLocked : DEFAULT_PREFS.hideLocked;
    return { types, sources, plans, hideLocked };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: NewsPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}

export function isOnboarded(): boolean {
  if (typeof window === "undefined") return true; // never show the modal during SSR
  try {
    return window.localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return true;
  }
}

export function markOnboarded(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    /* non-fatal */
  }
}

/* ─── Source matching ─── */
export function matchCuratedSource(source: string | undefined): string | null {
  if (!source) return null;
  const s = source.trim().toLowerCase();
  for (const c of PREF_SOURCES) {
    if (c.aliases.some((a) => s.includes(a))) return c.id;
  }
  return null;
}

/* ─── Type classification ───
   Word-boundary keyword match so "fed"/"oil"/"gold" don't false-match inside
   longer words. Multi-word phrases match as written. */
const MACRO_TERMS = [
  "fed", "federal reserve", "fomc", "powell", "rate hike", "rate cut",
  "interest rate", "interest rates", "cpi", "inflation", "deflation",
  "ppi", "pce", "treasury", "treasuries", "yield", "yields",
  "10-year", "2-year", "gdp", "jobs report", "payrolls", "nonfarm",
  "unemployment", "jobless", "commodity", "commodities", "gold", "silver",
  "oil", "crude", "wti", "brent", "opec", "copper", "natural gas",
  "recession", "tariff", "tariffs", "ecb", "boj", "central bank",
  "dollar index", "dxy",
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MACRO_RE = new RegExp(`\\b(${MACRO_TERMS.map(escapeRe).join("|")})\\b`, "i");

export function articleTypes(a: NewsArticle): NewsType[] {
  const out: NewsType[] = [];
  if (a.ticker) out.push("stock");
  if (MACRO_RE.test(`${a.headline} ${a.summary} ${a.source}`)) out.push("macro");
  if (out.length === 0) out.push("broad");
  return out;
}

/* ─── Plan layer ─── */
export function sourcePlan(prefs: NewsPrefs, id: string): PlanTier {
  return prefs.plans?.[id] ?? "free";
}

/** True when the article's publisher gates by kind and your tier can't open it. */
function planBlocks(a: NewsArticle, prefs: NewsPrefs, curated: string | null): boolean {
  if (!curated) return false;
  const open = SOURCE_BY_ID.get(curated)?.access?.openKinds;
  if (!open) return false;
  return !open[sourcePlan(prefs, curated)].includes(classifyKind(a.headline, a.url));
}

/** True for a whole-publisher paywall you don't hold a subscription to. Drives
 *  the lock badge in the feed — these stay visible unless `hideLocked` is on. */
export function articleLocked(a: NewsArticle, prefs: NewsPrefs): boolean {
  const curated = matchCuratedSource(a.source);
  if (!curated) return false;
  if (!SOURCE_BY_ID.get(curated)?.access?.paywalled) return false;
  return sourcePlan(prefs, curated) === "free";
}

/* ─── Combined visibility filter ─── */
export function articleVisible(a: NewsArticle, prefs: NewsPrefs): boolean {
  // Source layer: hide only if it maps to a curated provider the user unchecked.
  const curated = matchCuratedSource(a.source);
  if (curated && !prefs.sources.includes(curated)) return false;

  // Plan layer: hide what your tier at that publisher can't open.
  if (planBlocks(a, prefs, curated)) return false;
  if (prefs.hideLocked && articleLocked(a, prefs)) return false;

  // Type layer: visible if any of the article's tags is selected.
  if (prefs.types.length === 0) return true; // no constraint
  return articleTypes(a).some((t) => prefs.types.includes(t));
}
