import { NextResponse } from "next/server";
import { parseRss } from "@/lib/rss-parser";
import { classifyTopics, NEWS_TOPICS, type NewsTopic } from "@/lib/news-topics";
import type { NewsArticle } from "@/app/api/news/route";

export const dynamic = "force-dynamic";

// Feeds behind the News tab's topic sections — Rates & Inflation, Energy, Macro.
// Nothing here is user-specific, so the route is public (it sits under the
// /api/news prefix in proxy.ts's allowlist) and one fetch per feed every 30
// minutes serves everyone, same as /api/news/feeds.
//
// Two kinds of feed, split by whether the feed's own subject can be trusted:
//   • DESKS (`topics` set) — an FOMC release, a CPI release or an EIA note is on
//     topic by construction, so every row gets the desk's topic, plus any other
//     section its headline earns.
//   • BROAD economics desks (`topics` empty) — they also run food-safety recalls
//     and relocation features, so each row has to earn a section from the
//     classifier, and rows that earn none are dropped.
//
// Every URL was checked live on 2026-09-13 through lib/rss-parser. Tried and left
// out: Reuters (no public RSS any more), Investing.com (zone-less pubDates parse
// hours into the future), Google News (opaque redirect links defeat url dedupe
// and the paywall matcher), CNBC Bonds (mostly FX, weeks stale), the Guardian
// (UK-centric).
//
// Source names are chosen to hit existing mappings: "CNBC", "Bloomberg" and "NYT"
// are pinned colors in lib/news-source-color AND curated publishers in
// lib/news-preferences — so Bloomberg and NYT rows get the paywall lock on a free
// plan, and unticking a publisher in Preferences hides it here too.

interface TopicFeed {
  name: string;
  url: string;
  topics: NewsTopic[];
  /** How long a row stays. Defaults to DEFAULT_MAX_AGE_DAYS. */
  maxAgeDays?: number;
}

// Agency release desks keep rows for two months. FOMC meetings sit 6–8 weeks
// apart and BLS release gaps run to 36 days, so a one-month window regularly
// dropped the latest policy statement or jobs/CPI report before the next arrived.
const AGENCY_DAYS = 60;

const TOPIC_FEEDS: TopicFeed[] = [
  // Rates & Inflation desks
  { name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_monetary.xml", topics: ["rates"], maxAgeDays: AGENCY_DAYS },
  { name: "BLS", url: "https://www.bls.gov/feed/cpi.rss", topics: ["rates"], maxAgeDays: AGENCY_DAYS },
  { name: "BLS", url: "https://www.bls.gov/feed/ppi.rss", topics: ["rates"], maxAgeDays: AGENCY_DAYS },
  // Energy desks
  { name: "CNBC", url: "https://www.cnbc.com/id/19836768/device/rss/rss.html", topics: ["energy"] },
  { name: "OilPrice.com", url: "https://oilprice.com/rss/main", topics: ["energy"] },
  { name: "EIA", url: "https://www.eia.gov/rss/todayinenergy.xml", topics: ["energy"] },
  { name: "Rigzone", url: "https://www.rigzone.com/news/rss/rigzone_latest.aspx", topics: ["energy"] },
  // Macro desks
  { name: "BEA", url: "https://apps.bea.gov/rss/rss.xml", topics: ["macro"], maxAgeDays: AGENCY_DAYS },
  { name: "BLS", url: "https://www.bls.gov/feed/empsit.rss", topics: ["macro"], maxAgeDays: AGENCY_DAYS },
  // Broad economics desks — every row is classified on its own
  { name: "CNBC", url: "https://www.cnbc.com/id/20910258/device/rss/rss.html", topics: [] },
  { name: "NPR", url: "https://feeds.npr.org/1017/rss.xml", topics: [] },
  { name: "Bloomberg", url: "https://feeds.bloomberg.com/economics/news.rss", topics: [] },
  { name: "Bloomberg", url: "https://feeds.bloomberg.com/markets/news.rss", topics: [] },
  { name: "NYT", url: "https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml", topics: [] },
];

const FEED_TTL = 30 * 60_000;
// A dead feed with nothing cached would otherwise be retried — and waited on for
// the full timeout — by every page load. Back off instead.
const RETRY_AFTER = 5 * 60_000;
const FETCH_TIMEOUT = 8_000;
// News desks move fast; a month is plenty. (BEA's feed still carries releases
// from 2011, so some limit is needed everywhere — see AGENCY_DAYS for agencies.)
const DEFAULT_MAX_AGE_DAYS = 30;
const DAY = 24 * 3600_000;
// Capped per section, not overall, so a busy oil tape can't starve Rates.
const PER_TOPIC = 60;

const cache = new Map<string, { articles: NewsArticle[]; ts: number }>();
const failedAt = new Map<string, number>();

async function fetchFeed(feed: TopicFeed): Promise<{ articles: NewsArticle[]; ok: boolean }> {
  const hit = cache.get(feed.url);
  if (hit && Date.now() - hit.ts < FEED_TTL) return { articles: hit.articles, ok: true };

  const stale = { articles: hit?.articles ?? [], ok: false };
  const failed = failedAt.get(feed.url);
  if (failed && Date.now() - failed < RETRY_AFTER) return stale;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Fintrack/1.0; RSS reader)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const articles = parseRss(await res.text(), feed.name);
    // A 200 that parses to nothing is a block page or a format change, not an
    // empty desk — keep the last good copy rather than caching the blank.
    if (!articles.length) throw new Error("no items");
    cache.set(feed.url, { articles, ts: Date.now() });
    failedAt.delete(feed.url);
    return { articles, ok: true };
  } catch {
    failedAt.set(feed.url, Date.now());
    return stale;
  } finally {
    clearTimeout(timeout);
  }
}

type TaggedArticle = NewsArticle & { topics: NewsTopic[] };

export async function GET() {
  const results = await Promise.all(TOPIC_FEEDS.map(fetchFeed));
  const now = Date.now();

  // Tag and de-dupe by url. The same CNBC story can sit on two desks; it keeps
  // the first copy and the union of both desks' sections.
  const byUrl = new Map<string, TaggedArticle>();
  results.forEach(({ articles }, i) => {
    const feed = TOPIC_FEEDS[i];
    const maxAge = (feed.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS) * DAY;
    for (const a of articles) {
      if (!a.url || now - a.timestamp > maxAge) continue;
      const prev = byUrl.get(a.url);
      const earned = new Set<NewsTopic>([
        ...feed.topics,
        ...classifyTopics(a.headline, a.summary),
        ...(prev?.topics ?? []),
      ]);
      if (!earned.size) continue;
      const topics = NEWS_TOPICS.map((t) => t.id).filter((id) => earned.has(id));
      if (prev) {
        prev.topics = topics;
      } else {
        byUrl.set(a.url, {
          ...a,
          id: `topic-${a.url}`,
          // Some feeds stamp items ahead of the clock; never show "in 3 hours".
          timestamp: Math.min(a.timestamp, now),
          topics,
        });
      }
    }
  });

  const counts: Record<NewsTopic, number> = { rates: 0, energy: 0, macro: 0 };
  const articles = [...byUrl.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .filter((a) => {
      if (!a.topics.some((t) => counts[t] < PER_TOPIC)) return false;
      for (const t of a.topics) counts[t]++;
      return true;
    });

  return NextResponse.json({
    articles,
    // Per-feed health, so a desk that silently dies (as Reuters and WSJ did in
    // Preferences) shows up here instead of as a quietly thinner section.
    feeds: TOPIC_FEEDS.map((f, i) => ({
      name: f.name,
      url: f.url,
      ok: results[i].ok,
      count: results[i].articles.length,
    })),
  });
}
