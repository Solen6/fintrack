import { fetchMacroEvents } from "@/lib/calendar-events";

export interface Catalyst {
  date: string; // ISO date "YYYY-MM-DD"
  label: string;
}

/* Keyword substrings (matched case-insensitively against the live macro
   calendar's event titles) that are relevant to each commodity. There's no
   dedicated "OPEC+ meeting" indicator on the economic calendar, so oil's
   catalysts skew Fed/inventory-driven rather than OPEC-meeting-driven — still
   a live, current signal, just not exhaustive. */
const RELEVANCE: Record<string, string[]> = {
  gold: ["fomc", "fed interest rate", "interest rate decision", "cpi", "pce", "nonfarm payrolls", "retail sales"],
  silver: ["fomc", "fed interest rate", "interest rate decision", "cpi", "industrial production", "ism manufacturing"],
  oil: ["crude oil inventories", "opec", "fomc", "fed interest rate", "interest rate decision", "retail sales"],
  copper: ["china", "pmi", "fomc", "fed interest rate", "interest rate decision", "industrial production"],
  // No dedicated indicator exists for uranium — fall back to broad US macro so
  // it isn't left with zero catalysts like the old hardcoded list left it.
  uranium: ["fomc", "fed interest rate", "interest rate decision", "cpi"],
};

const COUNTRIES: Record<string, string[]> = {
  copper: ["US", "CN"], // China demand is a primary copper driver
};

const MAX_CATALYSTS = 20;

// TradingView's economic-calendar endpoint silently caps at ~2000 rows per
// request and (empirically) returns them oldest-first — a 14-month US window
// blows past that at ~330 events/month, truncating around month 6 and never
// reaching "now". Chunk the window so no single request gets near the cap.
const CHUNK_MONTHS = 2;

async function fetchMacroEventsChunked(from: string, to: string, countries: string[]) {
  const chunks: Array<[string, string]> = [];
  let start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (start < end) {
    const chunkEnd = new Date(start);
    chunkEnd.setMonth(chunkEnd.getMonth() + CHUNK_MONTHS);
    const bounded = chunkEnd < end ? chunkEnd : end;
    chunks.push([start.toISOString().split("T")[0], bounded.toISOString().split("T")[0]]);
    start = bounded;
  }
  const results = await Promise.all(chunks.map(([f, t]) => fetchMacroEvents(f, t, countries)));
  return results.flat();
}

export async function fetchCommodityCatalysts(id: string, from: string, to: string): Promise<Catalyst[]> {
  const keywords = RELEVANCE[id];
  if (!keywords) return [];
  const countries = COUNTRIES[id] ?? ["US"];
  const events = await fetchMacroEventsChunked(from, to, countries);

  const matches = events
    .filter((e) => e.impact === "high" && keywords.some((kw) => e.title.toLowerCase().includes(kw)))
    .sort((a, b) => a.date.localeCompare(b.date));

  // The client filters catalysts down to whatever window it's actually
  // charting, so cap on the MOST RECENT events (tail of the ascending sort) —
  // capping the head would strand every commodity on stale, months-old dates.
  return matches.slice(-MAX_CATALYSTS).map((e) => ({ date: e.date, label: e.title }));
}
