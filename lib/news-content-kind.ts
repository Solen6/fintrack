// What KIND of thing an article is — not who published it.
//
// Seeking Alpha's feeds mix five very different products under one <item> shape:
// a two-line news brief, a contributor analysis piece, a raw earnings-call
// transcript, an earnings slide deck, and a podcast episode. The RSS carries no
// field that says which; the only signals are the headline and the URL shape.
//
// Both SA paths land here, which is why this classifies off (headline, url)
// rather than off the richer per-route metadata:
//   • /api/news/sa   — per-ticker combined feed; url is derived from the guid,
//                      so /news/{id} = brief and /article/{slug} = everything else.
//   • /api/news/feeds — the site-wide seekingalpha.com/feed.xml added as a custom
//                      RSS source; generic parse, only ever has title + link.
// A classifier that needed the guid would silently pass everything in the second
// path — and that feed is the noisy one (roughly half transcripts and decks).

/** Ordered most-specific first; `news` is the safe fallback (never filtered). */
export type NewsKind = "news" | "analysis" | "transcript" | "presentation" | "podcast";

export const KIND_LABELS: Record<NewsKind, string> = {
  news: "News",
  analysis: "Analysis",
  transcript: "Transcript",
  presentation: "Earnings deck",
  podcast: "Podcast",
};

/* ─── Headline patterns ───
   Anchored to the phrases SA actually ships rather than bare words: a bare
   /transcript/ would eat an analysis piece called "What The Transcript Reveals",
   and a bare /presentation/ would eat "A Presentation Of The Bull Case". */

// "Firefly Aerospace Inc. (FLY) Q2 2026 Earnings Call Transcript"
const TRANSCRIPT_RE = /\b(?:earnings|conference|investor)\s+call\s+transcript\b|\btranscript\s*$/i;

// "Wacoal Holdings Corp. 2027 Q1 - Results - Earnings Call Presentation"
// "RXO, Inc. (RXO) Presents at Deutsche Bank's Chicago Industrials Summit"
const PRESENTATION_RE =
  /\b(?:earnings|conference|investor)\s+call\s+presentation\b|\bpresents\s+at\b|\bpresentation\s*$/i;

// "Wall Street Breakfast Podcast: Dimon Sounds Leverage Siren".
// The slug for that one reads "...-wall-street-breakfast-podcst-..." — SA's own
// typo — so the headline is the authoritative signal and the slug is a backstop.
const PODCAST_RE = /\bpodcasts?\b/i;
const PODCAST_SLUG_RE = /-podc(?:a)?st(?:-|$)/i;

/** Classify an article by what it is. Unknown shapes fall through to `news`. */
export function classifyKind(headline: string, url: string): NewsKind {
  const title = headline ?? "";
  const link = url ?? "";

  if (PODCAST_RE.test(title) || PODCAST_SLUG_RE.test(link)) return "podcast";
  if (TRANSCRIPT_RE.test(title)) return "transcript";
  if (PRESENTATION_RE.test(title)) return "presentation";

  // Nothing special in the headline — fall back to the URL shape. SA news briefs
  // live at /news/{id}; contributor pieces at /article/{id}-slug.
  if (/\/article\//i.test(link)) return "analysis";
  return "news";
}

/* ─── Publisher identity ───
   `source` is free text (a Finnhub/AV publisher name OR a user-chosen RSS feed
   name), so a renamed feed still has to resolve. The URL host is the backstop —
   parsed as a host, not substring-matched, so a query string can't spoof it. */
function hostOf(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url ?? "");
  return (m?.[1] ?? "").toLowerCase();
}

export function isSeekingAlpha(a: { source?: string; url?: string }): boolean {
  const s = (a.source ?? "").toLowerCase();
  if (s.includes("seeking alpha") || s.includes("seekingalpha")) return true;
  const host = hostOf(a.url ?? "");
  return host === "seekingalpha.com" || host.endsWith(".seekingalpha.com");
}
