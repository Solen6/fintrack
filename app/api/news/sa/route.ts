import { NextResponse, type NextRequest } from "next/server";
import type { NewsArticle } from "@/app/api/news/route";

// Seeking Alpha still publishes free, per-ticker RSS at combined/{SYMBOL}.xml.
// It's headline-only (no article body/summary) but each item is tagged to the
// symbol, so we drive it straight off the user's portfolio tickers — no SA
// account or portfolio linking required.
//
// The feed mixes two item kinds:
//   • MarketCurrent news briefs — all share one <link> (/symbol/{T}/news);
//     their unique id lives only in <guid>MarketCurrent:{id}</guid>.
//   • Analysis articles — carry a real /article/{id}-slug <link>.
// So identity + the clickable URL are derived from the guid, not the link —
// otherwise every news brief for a ticker collapses to the same URL and gets
// deduped away (and read/saved state, keyed on URL, would bleed across items).
const SA_FEED = (symbol: string) =>
  `https://seekingalpha.com/api/sa/combined/${encodeURIComponent(symbol)}.xml`;

const UA = "Mozilla/5.0 (compatible; Fintrack/1.0; RSS reader)";

// Per-ticker cache (20 min). Multiple users on the same holding share a fetch.
const cache = new Map<string, { articles: NewsArticle[]; ts: number }>();
const TTL = 20 * 60_000;

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c: string) => c)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(seg: string, name: string): string {
  const m = seg.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decode(m[1]) : "";
}

function parseSaFeed(xml: string, ticker: string): NewsArticle[] {
  const items = xml.split(/<item(?:\s[^>]*)?>/i).slice(1);
  const out: NewsArticle[] = [];

  for (const seg of items) {
    const headline = tag(seg, "title");
    if (!headline) continue;

    const guid = tag(seg, "guid");
    const link = tag(seg, "link");
    const idMatch = guid.match(/(?:MarketCurrent|Article|News):(\d+)/i);

    // Derive a unique, stable, clickable URL for the item.
    let url = "";
    if (link.includes("/article/")) {
      url = link.split("?")[0]; // real analysis-article permalink
    } else if (idMatch) {
      url = `https://seekingalpha.com/news/${idMatch[1]}`; // news-brief permalink
    } else if (/^https?:\/\//.test(link)) {
      url = link.split("?")[0];
    } else {
      continue; // no usable URL → skip
    }

    const pub = tag(seg, "pubDate");
    const ts = pub ? new Date(pub).getTime() || Date.now() : Date.now();
    if (isNaN(ts)) continue;

    out.push({
      id: guid || url,
      ticker,
      headline,
      summary: "", // SA combined feed carries no body text
      source: "Seeking Alpha",
      timestamp: ts,
      url,
    });
  }
  return out;
}

async function fetchTicker(symbol: string): Promise<NewsArticle[]> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.ts < TTL) return hit.articles;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(SA_FEED(symbol), {
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    clearTimeout(timeout);
    // On block/error, serve stale cache if we have it, else empty.
    if (!res.ok) return hit?.articles ?? [];

    const xml = await res.text();
    // SA can return an HTML challenge page with a 200 — only parse real feeds.
    if (!/<rss[\s>]|<feed[\s>]/i.test(xml)) return hit?.articles ?? [];

    const articles = parseSaFeed(xml, symbol);
    cache.set(symbol, { articles, ts: Date.now() });
    return articles;
  } catch {
    return hit?.articles ?? [];
  }
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("tickers") ?? "";
  const tickers = raw
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 12);

  if (!tickers.length) return NextResponse.json({ articles: [] });

  const results = await Promise.allSettled(tickers.map(fetchTicker));

  const articles: NewsArticle[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const a of r.value) {
      // Same news item is tagged to many symbols — dedupe on its stable URL,
      // keeping the first ticker association encountered.
      if (seen.has(a.url)) continue;
      seen.add(a.url);
      articles.push(a);
    }
  }

  articles.sort((a, b) => b.timestamp - a.timestamp);
  return NextResponse.json({ articles: articles.slice(0, 100) });
}
