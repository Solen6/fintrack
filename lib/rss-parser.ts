import type { NewsArticle } from "@/app/api/news/route";

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c: string) => c)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Numeric references, decimal and hex — OilPrice sends &#039;, the Dow Jones
    // feeds send &#x2019;, and both used to reach the feed as literal text.
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => codePoint(Number(d)))
    // Feeds that entity-escape their markup (BEA does) only turn into tags after
    // the decode above, so strip once more.
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Old feeds reference Windows-1252 punctuation by its C1 slot (&#146; for ’).
const CP1252: Record<number, string> = {
  0x80: "€", 0x85: "…", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x96: "–", 0x97: "—",
};

function codePoint(n: number): string {
  if (CP1252[n]) return CP1252[n];
  // Never emit what would render blank or as tofu: NUL, C0/C1 control characters
  // (tab, LF and CR are fine), lone surrogates, or out-of-range values.
  if (
    n === 0 ||
    (n < 0x20 && n !== 9 && n !== 10 && n !== 13) ||
    (n >= 0x7f && n <= 0x9f) ||
    (n >= 0xd800 && n <= 0xdfff) ||
    n > 0x10ffff
  ) {
    return "";
  }
  return String.fromCodePoint(n);
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
        url = linkMatch?.[1]?.trim() || firstTag(seg, "link") || firstTag(seg, "guid");
      }
      // BEA sometimes drops the scheme: <link>www.bea.gov/news/…</link>.
      if (/^(?:www\.|\/\/)/i.test(url)) url = `https://${url.replace(/^\/\//, "")}`;

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
