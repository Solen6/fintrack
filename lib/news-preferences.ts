// Client-safe news personalization preferences for the News tab.
//
// Two layers of filtering live here, both applied on the client so toggles feel
// instant (no refetch needed to re-filter an already-loaded feed):
//   1. Sources — the 7 curated providers. An article is hidden only if its
//      free-text `source` maps to one of these providers AND the user has
//      unchecked it. Articles from anything NOT in the curated set (the user's
//      own RSS feeds, MarketWatch, Yahoo, …) are never touched by this layer —
//      those stay governed by the RSS source manager.
//   2. Types — macro / broad-market / stock-specific. Each article is tagged
//      with one or more types; it's visible if any of its tags is selected.
//
// Persistence is localStorage (no migration needed). Selecting a curated source
// that ships an RSS feed also seeds that feed via /api/news/sources on save.

import type { NewsArticle } from "@/app/api/news/route";

/* ─── News types ─── */
export type NewsType = "stock" | "macro" | "broad";

export const NEWS_TYPES: { id: NewsType; label: string; desc: string }[] = [
  { id: "stock", label: "Stock-specific", desc: "News tied to your portfolio holdings" },
  { id: "macro", label: "Macro", desc: "Fed, rates, treasuries, commodities, CPI" },
  { id: "broad", label: "Broad market", desc: "Index moves, sentiment, general finance" },
];

/* ─── Curated source catalog ───
   `aliases` are matched as case-insensitive substrings against the article's
   free-text `source` (Finnhub/AV publisher name OR an RSS feed name). `rss`, when
   present, is seeded as a custom feed when the source is enabled. */
export interface CuratedSource {
  id: string;
  label: string;
  aliases: string[];
  rss?: { name: string; url: string };
}

export const PREF_SOURCES: CuratedSource[] = [
  {
    id: "seeking-alpha",
    label: "Seeking Alpha",
    aliases: ["seeking alpha", "seekingalpha"],
    rss: { name: "Seeking Alpha", url: "https://seekingalpha.com/feed.xml" },
  },
  {
    id: "wsj",
    label: "WSJ",
    aliases: ["wsj", "wall street journal", "dow jones"],
    rss: { name: "WSJ Markets", url: "https://feeds.a.dj.com/rss/RSSMarketsMain.aspx" },
  },
  {
    id: "nyt",
    label: "NYT",
    aliases: ["nyt", "new york times", "nytimes"],
    rss: { name: "NYT Business", url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml" },
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
  { id: "bloomberg", label: "Bloomberg", aliases: ["bloomberg"] },
  { id: "financial-times", label: "Financial Times", aliases: ["financial times", "ft.com", "ft alphaville"] },
];

export const ALL_SOURCE_IDS = PREF_SOURCES.map((s) => s.id);

/* ─── Preferences shape & defaults ─── */
export interface NewsPrefs {
  types: NewsType[];
  sources: string[]; // curated source ids the user wants to see
}

// Start inclusive: everything visible. The user trims from here.
export const DEFAULT_PREFS: NewsPrefs = {
  types: NEWS_TYPES.map((t) => t.id),
  sources: ALL_SOURCE_IDS,
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
    return { types, sources };
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

/* ─── Combined visibility filter ─── */
export function articleVisible(a: NewsArticle, prefs: NewsPrefs): boolean {
  // Source layer: hide only if it maps to a curated provider the user unchecked.
  const curated = matchCuratedSource(a.source);
  if (curated && !prefs.sources.includes(curated)) return false;

  // Type layer: visible if any of the article's tags is selected.
  if (prefs.types.length === 0) return true; // no constraint
  return articleTypes(a).some((t) => prefs.types.includes(t));
}
