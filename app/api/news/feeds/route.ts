import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseRss } from "@/lib/rss-parser";
import type { NewsArticle } from "@/app/api/news/route";

// Shared URL-keyed cache (30 min per feed) — multiple users on the same feed share a fetch
const feedCache = new Map<string, { articles: NewsArticle[]; ts: number }>();
const FEED_TTL = 30 * 60_000;

async function fetchFeed(url: string, name: string): Promise<NewsArticle[]> {
  const hit = feedCache.get(url);
  if (hit && Date.now() - hit.ts < FEED_TTL) return hit.articles;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Fintrack/1.0; RSS reader)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return feedCache.get(url)?.articles ?? [];

    const xml = await res.text();
    const articles = parseRss(xml, name);
    feedCache.set(url, { articles, ts: Date.now() });
    return articles;
  } catch {
    // On network error or timeout, return stale cache if available
    return feedCache.get(url)?.articles ?? [];
  }
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: sources } = await supabase
    .from("news_sources")
    .select("name, url")
    .eq("user_id", user.id)
    .eq("enabled", true);

  if (!sources?.length) return NextResponse.json({ articles: [] });

  const results = await Promise.allSettled(
    sources.map((s) => fetchFeed(s.url, s.name))
  );

  const all: NewsArticle[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const a of r.value) {
      if (!seen.has(a.url)) {
        seen.add(a.url);
        all.push(a);
      }
    }
  }

  all.sort((a, b) => b.timestamp - a.timestamp);
  return NextResponse.json({ articles: all.slice(0, 150) });
}
