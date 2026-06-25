import type { NewsArticle } from "@/app/api/news/route";

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c: string) => c)
    .replace(/<[^>]+>/g, "")
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

function firstTag(xml: string, ...tags: string[]): string {
  for (const tag of tags) {
    const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
    if (m) return decode(m[1]);
  }
  return "";
}

function firstAttr(xml: string, tag: string, attr: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, "i"));
  return (m?.[1] ?? "").trim();
}

export function parseRss(xml: string, feedName: string): NewsArticle[] {
  const isAtom = /<feed[\s>]/.test(xml);
  const itemTag = isAtom ? "entry" : "item";

  // Split on item/entry open tags, discard the preamble
  const segments = xml.split(new RegExp(`<${itemTag}(?:\\s[^>]*)?>`, "i"));
  segments.shift();

  return segments
    .map((seg, i) => {
      const title = firstTag(seg, "title");
      if (!title) return null;

      let url = "";
      if (isAtom) {
        // Atom: <link rel="alternate" href="..."/> or <link href="..."/>
        const altMatch = seg.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
        url = altMatch?.[1] ?? firstAttr(seg, "link", "href") ?? firstTag(seg, "link");
      } else {
        // RSS: <link>url</link> or <link/> followed by text, or <guid> as fallback
        const linkMatch = seg.match(/<link>(https?:\/\/[^<\s]+)<\/link>/i);
        url = linkMatch?.[1]?.trim() ?? firstTag(seg, "guid");
      }

      if (!url || !url.startsWith("http")) return null;

      const dateStr = isAtom
        ? firstTag(seg, "published", "updated")
        : firstTag(seg, "pubDate", "dc:date", "updated");
      const timestamp = dateStr ? (new Date(dateStr).getTime() || Date.now()) : Date.now();

      const summary = firstTag(seg, "description", "summary", "content")
        .slice(0, 500);

      return {
        id: `rss-${i}-${url}`,
        ticker: null as string | null,
        headline: title,
        summary,
        source: feedName,
        timestamp,
        url,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null && !isNaN(item.timestamp));
}
