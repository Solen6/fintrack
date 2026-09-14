// Topic sections for the News tab — Rates & Inflation, Energy, Macro.
//
// Topics are NAVIGATION, not a preference. Picking one in the feed sidebar shows
// every loaded article about it, drawn from two pools:
//   • the regular feed (Finnhub, Alpha Vantage, Seeking Alpha, your RSS feeds),
//     tagged on the client by keyword; and
//   • /api/news/topics — a curated set of topic desks and agency release feeds
//     (CNBC Energy, EIA, the Fed, BLS, BEA, …) that keeps a section from being
//     three stale headlines on a quiet day. Those rows arrive pre-tagged and are
//     deliberately kept OUT of "All", so adding sections doesn't bury portfolio
//     news under oil and CPI stories.
// An article can sit in more than one section — "oil-fueled inflation" is both.
//
// Client-safe (no server imports): the route tags with this same classifier.

import type { NewsArticle } from "@/app/api/news/route";

export type NewsTopic = "rates" | "energy" | "macro";

export const NEWS_TOPICS: { id: NewsTopic; label: string }[] = [
  { id: "rates", label: "Rates & Inflation" },
  { id: "energy", label: "Energy" },
  { id: "macro", label: "Macro" },
];

export const TOPIC_LABEL = Object.fromEntries(
  NEWS_TOPICS.map((t) => [t.id, t.label]),
) as Record<NewsTopic, string>;

/* ─── Vocabulary ───
   Each entry is a regex fragment matched on word boundaries. A fragment with any
   capital letter matches CASE-SENSITIVELY — that's how "Fed" and "CPI" stay
   precise without catching "fed up"; all-lowercase fragments match any case.
   Bare words that mostly mean something else in company news are left out on
   purpose — "yield" (dividend yield), "pipeline" (drug/product pipeline), "rates"
   (tax, occupancy, churn), "gas" (greenhouse gas) — and their unambiguous
   phrasings are listed instead. Never use an uppercase regex escape (\S, \W, \B)
   here: it would flip the fragment to case-sensitive. */
const TERMS: Record<NewsTopic, string[]> = {
  rates: [
    // Central banks and the people who run them
    "Fed", "FOMC", "federal reserve", "central bank(?:s|ers?)?", "fed funds",
    "ECB", "BOJ", "BoJ", "BOE", "BoE", "PBOC", "SNB", "RBA",
    "bank of (?:england|japan|canada)", "powell", "warsh", "lagarde", "ueda",
    "federal open market committee", "discount rate",
    "monetary policy", "policy rate", "benchmark rate", "hawkish", "dovish",
    // Rate moves and the talk around them
    "interest[- ]rates?",
    "rate[- ](?:hikes?|cuts?|increases?|decisions?|path|outlook|bets|expectations)",
    "(?:hikes?|cuts?|raises?|lowers?|holds?|hiking|cutting|raising|lowering|holding) (?:interest )?rates",
    "basis points?", "borrowing costs?", "mortgage rates?",
    // Bonds
    "treasur(?:y|ies|ys) yields?", "treasuries", "treasurys", "yield curve",
    "bond (?:yields?|markets?|traders|investors|sell-?off|rally|vigilantes)",
    "(?:2|5|10|30)-year (?:yields?|treasur(?:y|ies|ys)|notes?|bonds?)",
    "gilts?", "bunds?", "JGBs?",
    // Inflation
    "inflation", "inflationary", "disinflation", "deflation", "stagflation",
    "CPI", "PCE", "PPI", "COLA", "consumer prices?", "producer prices?", "wholesale prices?",
    "price index", "cost of living",
  ],
  energy: [
    // Oil and gas
    "oil", "crude", "brent", "WTI", "OPEC", "petroleum", "barrels?",
    "natural gas", "LNG", "gasoline", "diesel", "jet fuel", "heating oil",
    "fuel prices?", "gas prices?", "pump prices?",
    "gas (?:storage|power|supply|supplies|plants?|fields?|exports?|imports?|demand|output|production|reserves)",
    "refiner(?:y|ies|s)?", "refining", "crack spreads?",
    "oil ?fields?", "drill(?:ing|ers?)", "rig count", "shale", "fracking",
    "offshore (?:drilling|wind|oil|gas|fields?|projects?)",
    "(?:oil|gas|saudi|east-west) pipelines?", "tankers?", "strait of hormuz", "hormuz",
    "bab el-mandeb", "henry hub",
    // Power
    "energy", "energies", "electricity", "power grids?", "power prices?",
    "power (?:plants?|outages?|demand|generation|capacity)", "peak load", "ERCOT", "PJM",
    "gigawatts?", "megawatts?", "battery storage", "grid(?:-scale)? batter(?:y|ies)",
    "heat pumps?", "geothermal",
    "nuclear (?:power|plants?|reactors?|energy)", "uranium", "coal", "solar",
    "wind (?:power|farms?|energy|turbines?)", "renewables?", "hydropower",
    // Agencies and the majors
    "EIA", "IEA", "exxon(?:mobil)?", "chevron", "conocophillips", "occidental",
    "aramco", "halliburton", "schlumberger", "SLB", "baker hughes", "totalenergies",
    "petrobras", "BP", "equinor",
  ],
  macro: [
    // Growth. No bare "slowdown" (an "AI slowdown" isn't macro) and no bare
    // "exports"/"imports" (Saudi oil exports are an energy story).
    "econom(?:y|ies|ic|ics)", "economists?", "GDP", "recessions?", "recessionary",
    "stagflation", "soft landing", "hard landing",
    "(?:growth|global|hiring|consumer) slowdown",
    "growth (?:forecasts?|outlook|slowdown|estimates?)",
    // Labor. No "job cuts" — that's one company's layoffs.
    "jobs? reports?", "jobs data", "jobs numbers", "payrolls", "nonfarm", "non-farm",
    "unemployment", "jobless", "labou?r market", "job (?:growth|gains|losses|openings|market)",
    "wage growth", "wages", "JOLTS",
    // Consumer and housing
    "consumer (?:spending|confidence|sentiment|outlook|debt|credit)", "retail sales",
    "personal income", "social security",
    "housing (?:markets?|starts)", "home (?:sales|prices|builders?)", "house prices",
    "existing-home sales", "new-home sales", "property (?:markets?|sector|crisis|slump)",
    // Production
    "PMI", "ISM", "manufacturing (?:activity|output|sector|index)",
    "factory (?:output|orders|activity)", "industrial production", "durable goods",
    "productivity",
    // Trade and fiscal
    "tariffs?", "trade (?:wars?|deals?|talks|data|gap|deficit|surplus|balance|policy|tensions)",
    "customs union",
    "(?:china|chinese|japan|japanese|germany|german|korea|korean|u\\.?s\\.?)(?:'s|’s)? (?:exports|imports)",
    "deficits?", "national debt", "federal debt", "debt ceiling", "wealth tax",
    "government shutdown", "fiscal", "stimulus", "federal budget",
    "treasury secretary", "bessent",
    // Currencies and capital flows
    "yen", "yuan", "renminbi", "rupee", "currency (?:intervention|markets?|wars?)",
    "dollar index", "DXY", "foreign reserves", "foreign direct investment",
    // Global
    "IMF", "OECD", "world bank", "G7", "G20", "eurozone", "euro area", "emerging markets?",
  ],
};

function compile(fragments: string[]): RegExp[] {
  const cs = fragments.filter((f) => /[A-Z]/.test(f));
  const ci = fragments.filter((f) => !/[A-Z]/.test(f));
  const out: RegExp[] = [];
  if (ci.length) out.push(new RegExp(`\\b(?:${ci.join("|")})\\b`, "gi"));
  if (cs.length) out.push(new RegExp(`\\b(?:${cs.join("|")})\\b`, "g"));
  return out;
}

const TOPIC_RES = Object.fromEntries(
  NEWS_TOPICS.map((t) => [t.id, compile(TERMS[t.id])]),
) as Record<NewsTopic, RegExp[]>;

/** Distinct vocabulary hits, lowercased so "Fed" and "fed" count once. */
function hits(text: string, res: RegExp[]): number {
  const found = new Set<string>();
  for (const re of res) for (const m of text.matchAll(re)) found.add(m[0].toLowerCase());
  return found.size;
}

/* ─── Classification ───
   One hit in the headline is enough — headlines are short and on-subject. A
   summary needs two DISTINCT hits, because company-news summaries run long and
   mention rates or the economy in passing ("…amid higher interest rates") without
   being about either. */
export function classifyTopics(headline: string, summary = ""): NewsTopic[] {
  return NEWS_TOPICS.map((t) => t.id).filter(
    (id) => hits(headline, TOPIC_RES[id]) > 0 || hits(summary, TOPIC_RES[id]) >= 2,
  );
}

/** Server-tagged topics when present, otherwise classify. */
export function articleTopics(a: NewsArticle): NewsTopic[] {
  return a.topics ?? classifyTopics(a.headline, a.summary);
}

export function isNewsTopic(v: unknown): v is NewsTopic {
  return v === "rates" || v === "energy" || v === "macro";
}
