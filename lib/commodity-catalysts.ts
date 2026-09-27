import { fetchMacroEvents } from "@/lib/calendar-events";
import { mapLimit } from "@/lib/async";
import { decode } from "@/lib/rss-parser";
import { yahooCandles } from "@/lib/yahoo-candles";
import { detectMoves, type Catalyst, type Move } from "@/lib/commodity-moves";

// Catalyst markers for the News-tab commodities chart: the year's biggest moves,
// each explained by the headline that reported it.
//
// This replaces a keyword filter over the macro calendar, which marked every
// FOMC / CPI / payrolls / crude-inventories date whether or not the price did
// anything — up to 20 dashed lines a year, most on quiet days, which is why the
// chart read as mock data.
//
// Headlines come from Google News' RSS search with after:/before: operators — the
// only free source found that can answer "what was said about oil on 27 Jul".
// Checked 2026-09-14: GDELT's DOC API allows one request per 5s and took ~10s
// each; the topic desks behind /api/news/topics only reach back a month or two.
// ⚠️ Google silently IGNORES the date operators once a query gets long (a
// 14-inflection OR list came back with that morning's news), so queries stay
// short — the subject plus four direction verbs — and every hit is re-checked
// against the move's dates here rather than trusted.

interface Subject {
  /** Search phrase; multi-word phrases are quoted. */
  query: string;
  /** A headline must name the asset. */
  keyword: RegExp;
  /** Phrases that contain the keyword but aren't the asset ("palm oil"). */
  exclude?: RegExp;
  /** A commodity or fund, not a company — so another company's *stock* moving
   *  is not this asset moving. Defaults to true. */
  commodity?: boolean;
  /** A fund of companies in one sector (XLE, COPX). Its headline has to be about
   *  the sector, not about one company that happens to share the word. */
  sector?: boolean;
  /** Macro-calendar titles that plausibly move it — the fallback explanation. */
  macro: string[];
  countries: string[];
}

const BROAD_MACRO = ["fomc", "fed interest rate", "interest rate decision", "cpi"];

const CURATED: Record<string, Subject> = {
  GLD: {
    query: `"gold price"`,
    keyword: /\bgold\b/i,
    macro: ["fomc", "fed interest rate", "interest rate decision", "cpi", "pce", "nonfarm payrolls", "retail sales"],
    countries: ["US"],
  },
  SLV: {
    query: `"silver price"`,
    keyword: /\bsilver\b/i,
    macro: ["fomc", "fed interest rate", "interest rate decision", "cpi", "industrial production", "ism manufacturing"],
    countries: ["US"],
  },
  USO: {
    query: `"oil prices"`,
    keyword: /\b(oil|crude|brent|wti|opec)\b/i,
    exclude: /\b(palm|olive|vegetable|cooking|soybean|soy|edible|essential|motor|fish)\s+oil\b/gi,
    macro: ["crude oil inventories", "opec", "fomc", "fed interest rate", "interest rate decision"],
    countries: ["US"],
  },
  CPER: {
    query: `"copper price"`,
    keyword: /\bcopper\b/i,
    macro: ["china", "pmi", "fomc", "fed interest rate", "interest rate decision", "industrial production"],
    countries: ["US", "CN"], // China demand is a primary copper driver
  },
  SRUUF: {
    query: `uranium`,
    keyword: /\buranium\b/i,
    macro: BROAD_MACRO,
    countries: ["US"],
  },
};

/* Issuer brands and fund/company boilerplate. Dropping these from Yahoo's name
   leaves what the asset actually IS: "Energy Select Sector SPDR Fund" → "Energy",
   "United States Natural Gas Fund, LP" → "Natural Gas", "Platinum Dec 26" →
   "Platinum". Taking only the first surviving WORD used to give "State" for XLE
   and "Natural" for UNG — searches that returned unrelated news. */
const NAME_NOISE = new Set([
  // issuers and fund families
  "spdr", "ishares", "invesco", "vanguard", "vaneck", "abrdn", "sprott", "proshares",
  "schwab", "direxion", "wisdomtree", "global", "x", "first", "trust", "state", "street",
  "select", "sector", "united", "states", "msci", "ftse",
  // fund and company boilerplate
  "the", "fund", "funds", "etf", "etn", "shares", "share", "index", "physical", "ultra",
  "daily", "inc", "inc.", "corp", "corp.", "corporation", "co", "co.", "company",
  "holdings", "group", "ltd", "ltd.", "plc", "class", "lp", "l.p.", "incorporated",
  "limited", "series", "continuous", "contract", "futures", "front", "month",
]);

const MONTHS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\.?$/i;

// A fund of companies ("Energy Select Sector", "Copper Miners") moves with its
// holdings, so it's a stocks story; a fund holding the material itself is a price
// story. Sector wins when a name says both, which is what XLE and COPX are.
const EQUITY_SECTOR_NAME = /\b(miners|mining|energy|metals|materials|agriculture|equity|equities)\b/i;
const COMMODITY_NAME =
  /\b(gold|silver|platinum|palladium|copper|aluminum|aluminium|nickel|zinc|uranium|oil|crude|petroleum|gas|gasoline|metal|commodity|commodities|wheat|corn|soybean|coffee|sugar|cocoa|cotton|lithium|carbon)\b/i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** How to search news for a chart symbol: curated wording for the five
 *  commodities, otherwise phrased from Yahoo's name for the instrument. */
export function subjectFor(symbol: string, name: string | null, instrumentType: string | null): Subject {
  const curated = CURATED[symbol];
  if (curated) return curated;

  const words = (name ?? "")
    .split(/[\s,()]+/)
    .map((w) => w.replace(/[.,]+$/, ""))
    .filter(
      (w) =>
        w.length > 0 &&
        // Letters, or an index number that is part of the name ("S&P 500") —
        // never a futures contract year ("Platinum Dec 26").
        (/[a-z]/i.test(w) || /^\d{3,4}$/.test(w)) &&
        !MONTHS.test(w) &&
        !NAME_NOISE.has(w.toLowerCase()),
    )
    // Two words name the thing ("Natural Gas", "Texas Instruments"); more starts
    // describing the wrapper ("Bloomberg Natural Gas Subindex Total Return").
    .slice(0, 2);

  const phrase = words.join(" ") || symbol;
  const sector = EQUITY_SECTOR_NAME.test(phrase);
  const commodity = !sector && COMMODITY_NAME.test(phrase);
  const noun = commodity
    ? " price"
    : sector
    ? " stocks" // "Energy stocks", not "Energy price"
    : instrumentType === "EQUITY"
    ? " stock"
    : instrumentType === "FUTURE"
    ? " price"
    : " stocks";

  const phraseRe = escapeRe(phrase);
  const keyword =
    phrase.toUpperCase() === symbol
      ? new RegExp(`\\b${escapeRe(symbol)}\\b`, "i")
      : new RegExp(`\\b(${phraseRe}|${escapeRe(symbol)})\\b`, "i");

  return {
    query: words.length > 1 ? `"${phrase}"${noun}` : `${phrase}${noun}`,
    keyword,
    commodity,
    sector,
    macro: BROAD_MACRO,
    countries: ["US"],
  };
}

/* ─── Headline scoring ─── */

// What the search asks for — few words, because long queries lose the date filter.
const UP_QUERY = ["surge", "jump", "rally", "rise"];
const DOWN_QUERY = ["fall", "drop", "plunge", "tumble"];

// What a headline must say — every inflection, since titles aren't search terms.
// "gains" only counts as a price move when a number, a reason or punctuation
// follows ("Gold gains 2%", "Uranium gains as…") — not "company gains approval".
const UP_RE =
  /\b(ris(?:e|es|ing)|rose|jump(?:s|ed|ing)?|surg(?:e|es|ed|ing)|soar(?:s|ed|ing)?|rall(?:y|ies|ied|ying)|climb(?:s|ed|ing)?|gain(?:s|ed)?(?=\s+(?:\d|as\b|on\b|after\b|amid\b|while\b|for\b)|\s*[,:;.!?-]|\s*$)|spik(?:e|es|ed)|higher|rebound(?:s|ed)?|leap(?:s|t|ed)?|record high|skyrocket(?:s|ed)?)\b/i;
const DOWN_RE =
  /\b(fall(?:s|ing)?|fell|drop(?:s|ped)?|plung(?:e|es|ed|ing)|tumbl(?:e|es|ed|ing)|slid(?:e|es|ing)?|sink(?:s|ing)?|sank|slump(?:s|ed)?|lower|retreat(?:s|ed)?|crash(?:es|ed)?|sell-?off|dip(?:s|ped)?|declin(?:e|es|ed)|plummet(?:s|ed)?|slip(?:s|ped)?|tank(?:s|ed)?)\b/i;

const REPUTABLE =
  /reuters|bloomberg|associated press|ap news|cnbc|wsj|wall street journal|financial times|marketwatch|barron|new york times|kitco|mining\.com|oilprice|s&p global|axios|cnn|nbc|cbs|bbc|the guardian|fortune|forbes|investopedia|investor's business daily|yahoo|nikkei|northern miner|world oil/i;

// Price pages, forecasts and explainers name the asset and a direction verb
// without reporting what happened that day.
const PENALTY =
  /\b(forecast|outlook|predictions?|should you|how to|what to know|opinion|commentary|explainer|obituary|stocks? to buy|price on \d|prices? today|transcript|earnings call)\b/i;

// "…as", "…after", "…on" — the headline carries a reason, not just a number.
const CAUSE = /\b(as|after|on|amid|following|despite|over)\b/i;

// Talk about what might happen, not a report of what did.
const SPECULATIVE =
  /\b(expects?|expected to|could|may|might|would|will|further to|heading for|claims?|predicts?|should investors|buy in now|what'?s next|where does)\b/i;

// "Lotus Resources (ASX:LOT) Shares Jump" — one listed company's own move.
const EXCHANGE_TICKER = /\((?:ASX|TSXV?|NYSE|NASDAQ|NSE|BSE|LSE|OTC|AMEX|CSE|NYSEARCA)\s*:/i;

// "…after its 100% surge", "…this year" — a trend, not the day.
const LONG_HORIZON =
  /\b(this year|in 20\d\d|year-to-date|ytd|past year|since (?:january|the start)|all year|by 20\d\d)\b|\b\d{3}%/i;

/* For a sector fund, the headline must be about the sector's shares as a group,
   and the word before the sector name must not be a company's ("Bloom Energy
   shares" is one holding; "US energy shares" is the sector). */
const SECTOR_PLURAL = "(?:stocks|shares|equities|sector|index|etf)";
const SECTOR_QUALIFIER =
  /^(?:us|u\.s\.|uk|eu|global|world|asia|asian|europe|european|canadian|chinese|clean|renewable|green|big|major|oil|gas|energy|nuclear|solar|the|and|in|of|on|for|as|after|amid)$/i;

// Stock/share words are fine when they're sector-wide ("uranium stocks", "miners").
const STOCK_WORD = /\b(stock|stocks|shares|share price)\b/i;
const SECTOR_STOCKS =
  /\b(uranium|copper|gold|silver|oil|mining|energy)\s+(?:mining\s+)?(stocks|shares)\b|\bminers\b/i;

// A pick must clear this. Below it the move keeps an honest "no headline found"
// rather than a weak one — see the measurement note on pickHeadline.
const MIN_SCORE = 3;
// An unfamiliar publisher has to do more than land on the right day with the right
// word order: out of sample, 10 of 12 bad picks were unknown-source rows scoring
// 3.0–4.3 on exactly that. Raising their bar dropped all 10 and cost no good pick.
const MIN_SCORE_UNKNOWN_SOURCE = 4.5;

export interface NewsHit {
  title: string;
  source: string;
  url: string;
  day: string; // publication day in New York, "YYYY-MM-DD"
  rank: number; // Google's own ordering
}

const NY_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function parseGoogleNews(xml: string): NewsHit[] {
  return xml
    .split(/<item>/i)
    .slice(1)
    .map((seg, rank) => {
      const pick = (tag: string) => {
        const m = seg.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
        return m ? decode(m[1]) : "";
      };
      const source = pick("source");
      let title = pick("title");
      // Google appends " - Publisher" to every title.
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      const published = new Date(pick("pubDate"));
      return {
        title,
        source,
        url: pick("link"),
        day: Number.isNaN(published.getTime()) ? "" : NY_DAY.format(published),
        rank,
      };
    })
    .filter((h) => h.title && h.day && h.url.startsWith("http"));
}

/** The headline that best explains a move: it must name the asset, move the same
 *  way, and be published between the previous close and the day after (next-day
 *  wraps like "oil fell 5% on Monday" count). Ranked on publisher, timing, whether
 *  the asset is what moved, whether it gives a reason, and Google's order.
 *
 *  Measured 2026-09-14 against 60 real big moves (oil, gold, silver, copper,
 *  uranium, NVDA; 824 candidate headlines) double-labeled by independent judges
 *  (97% agreement): this scoring picks a good headline 41 times, a bad one 5,
 *  misses 1, and correctly declines the 12 moves with no good candidate. The
 *  first cut (no subject/stock/speculation rules, no minimum) was 36 good / 16
 *  bad. Those numbers are in-sample — the rules are generic, but re-measure
 *  before loosening them. */
export function pickHeadline(hits: NewsHit[], subject: Subject, move: Move): NewsHit | null {
  const up = move.pct > 0;
  const dir = up ? UP_RE : DOWN_RE;
  const opposite = up ? DOWN_RE : UP_RE;
  const lo = move.prev;
  const hi = shiftDay(move.date, 1);

  let best: NewsHit | null = null;
  let bestScore = -Infinity;
  for (const h of hits) {
    if (h.day < lo || h.day > hi) continue;
    // Blank out look-alikes so "palm oil prices rise" doesn't count as oil.
    const title = subject.exclude ? h.title.replace(subject.exclude, "—") : h.title;
    const named = subject.keyword.exec(title);
    const moved = dir.exec(title);
    if (!named || !moved) continue;

    if (subject.sector) {
      const sectorPhrase = new RegExp(`${subject.keyword.source}\\s+${SECTOR_PLURAL}`, "i");
      if (!sectorPhrase.test(title)) continue; // one company, or not about shares
      const before = title.slice(0, named.index).trim().split(/\s+/).pop() ?? "";
      if (/^[A-Z][a-z]+$/.test(before) && !SECTOR_QUALIFIER.test(before)) continue; // "Bloom Energy"
    }

    const reputable = REPUTABLE.test(h.source);
    let score = 0;
    if (reputable) score += 3;
    if (h.day === move.date) score += 2;
    else if (h.day === hi) score += 1;
    else if (h.day === lo) score -= 1; // before the move it's meant to explain
    if (CAUSE.test(title)) score += 1;
    if (PENALTY.test(title)) score -= 3;
    if (opposite.test(title)) score -= 2;
    if (SPECULATIVE.test(title)) score -= 3;
    if (EXCHANGE_TICKER.test(title)) score -= 4;
    if (LONG_HORIZON.test(title)) score -= 3;
    // The asset should be what moved: "Gold price slides…" yes; "Arm, IBM and
    // HPE soar as Nvidia…" and "Corning stock surges… Nvidia deal" no.
    score += named.index < moved.index ? 2 : -2;
    if (subject.commodity !== false && STOCK_WORD.test(title) && !SECTOR_STOCKS.test(title)) {
      score -= 3; // one company's shares moving, not the commodity
    }
    score -= h.rank * 0.05;

    if (score < (reputable ? MIN_SCORE : MIN_SCORE_UNKNOWN_SOURCE)) continue;
    if (score > bestScore) {
      best = h;
      bestScore = score;
    }
  }
  return best;
}

/* ─── Lookups ─── */

const SEARCH_TIMEOUT = 6_000;
const DAY_S = 24 * 3600;
const SEARCH_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; fintrack/1.0)" };

/** null = the search itself failed (blocked, timed out), as opposed to no hits. */
async function searchNews(query: string, recent: boolean): Promise<NewsHit[] | null> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);
  try {
    const res = await fetch(
      url,
      recent
        ? // A window still open picks up next-day coverage. Next's fetch cache is
          // stale-while-revalidate (it serves an expired copy once), so skip it
          // here; the in-memory catalyst cache is the rate limit.
          { signal: controller.signal, headers: SEARCH_HEADERS, cache: "no-store" }
        : // A window that closed days ago never changes — let the shared fetch
          // cache keep it for a week, across instances.
          { signal: controller.signal, headers: SEARCH_HEADERS, next: { revalidate: 7 * DAY_S } },
    );
    if (!res.ok) return null;
    return parseGoogleNews(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function explainByNews(
  subject: Subject,
  move: Move,
  today: string,
): Promise<{ hit: NewsHit | null; failed: boolean }> {
  const window = `after:${shiftDay(move.prev, -1)} before:${shiftDay(move.date, 2)}`;
  const verbs = (move.pct > 0 ? UP_QUERY : DOWN_QUERY).join(" OR ");
  const recent = shiftDay(move.date, 3) >= today;
  // Directional first; the bare subject catches headlines that use a verb the
  // query didn't ("…slides", "…sheds").
  for (const query of [`${subject.query} ${verbs} ${window}`, `${subject.query} ${window}`]) {
    const hits = await searchNews(query, recent);
    if (hits === null) return { hit: null, failed: true };
    const hit = pickHeadline(hits, subject, move);
    if (hit) return { hit, failed: false };
  }
  return { hit: null, failed: false };
}

async function explainByMacro(subject: Subject, move: Move): Promise<string | null> {
  // TradingView's `to` is exclusive at midnight UTC.
  const events = await fetchMacroEvents(move.prev, shiftDay(move.date, 1), subject.countries);
  const hit = events.find(
    (e) =>
      e.impact === "high" &&
      e.date > move.prev &&
      e.date <= move.date &&
      subject.macro.some((kw) => e.title.toLowerCase().includes(kw)),
  );
  return hit?.title ?? null;
}

/* A continuous futures symbol (CL=F, PL=F) splices one contract onto the next, so
   on a roll day the price jumps overnight by the spread between the two contracts.
   That is bookkeeping, not news — and searching for a headline only invents one.
   The tell is that the whole day's change happened in the gap before it opened. */
const ROLL_GAP_SHARE = 0.7;

function dropContractRolls(
  moves: Move[],
  bars: Array<{ date: string; price: number; open?: number }>,
): Move[] {
  const indexOf = new Map(bars.map((b, i) => [b.date, i]));
  return moves.filter((m) => {
    const i = indexOf.get(m.date);
    if (i === undefined || i === 0) return true;
    const open = bars[i].open;
    const prevClose = bars[i - 1].price;
    if (!open || !(open > 0) || !(prevClose > 0)) return true;
    const total = Math.abs(Math.log(bars[i].price / prevClose));
    const gap = Math.abs(Math.log(open / prevClose));
    return !(total > 0 && gap >= ROLL_GAP_SHARE * total);
  });
}

const cache = new Map<string, { catalysts: Catalyst[]; ts: number; ttl: number }>();
const TTL = 6 * 60 * 60_000;
// When searches were failing (blocked or down), retry sooner than a clean result.
const DEGRADED_TTL = 15 * 60_000;
const MAX_MOVES = 12;

/** The past year's biggest moves for one chart symbol, each with its catalyst. */
export async function fetchCommodityCatalysts(symbol: string): Promise<Catalyst[]> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.ts < hit.ttl) return hit.catalysts;

  const series = await yahooCandles(symbol, "1Y");
  const subject = subjectFor(symbol, series.name, series.instrumentType);
  // Today's session is still trading: its "close" is the live price, so a marker
  // built on it would show a % that keeps changing (and would be cached for hours).
  const bars = series.partialLast ? series.data.slice(0, -1) : series.data;
  const detected = detectMoves(bars, { minZ: 2, max: MAX_MOVES, suppress: 3 });
  const moves = series.instrumentType === "FUTURE" ? dropContractRolls(detected, bars) : detected;
  const today = NY_DAY.format(new Date());

  let degraded = false;
  const catalysts = await mapLimit(moves, 3, async (move): Promise<Catalyst> => {
    const news = await explainByNews(subject, move, today);
    if (news.failed) degraded = true;
    if (news.hit) {
      return { ...move, kind: "news", label: news.hit.title, source: news.hit.source, url: news.hit.url };
    }
    const macro = await explainByMacro(subject, move).catch(() => null);
    if (macro) return { ...move, kind: "macro", label: macro };
    return { ...move, kind: "move", label: "" };
  });

  cache.set(symbol, { catalysts, ts: Date.now(), ttl: degraded ? DEGRADED_TTL : TTL });
  return catalysts;
}
