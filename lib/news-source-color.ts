// Stable source → color mapping for the news tab.
// Client-safe (no deps) so both the feed and the source manager can import it
// and render matching colored dots for each publisher / RSS feed.

// A cohesive, on-brand palette: consistent lightness/chroma, varied hue, so
// distinct sources stay distinguishable without looking like neon confetti.
export const SOURCE_PALETTE = [
  "oklch(0.74 0.14 74)",  // amber
  "oklch(0.70 0.12 240)", // steel blue
  "oklch(0.72 0.14 150)", // green
  "oklch(0.70 0.15 28)",  // warm red
  "oklch(0.70 0.12 300)", // violet
  "oklch(0.74 0.12 195)", // teal
  "oklch(0.74 0.14 115)", // lime
  "oklch(0.72 0.14 350)", // magenta
  "oklch(0.74 0.13 50)",  // orange
  "oklch(0.70 0.11 265)", // indigo
];

// Pin common financial sources to specific palette slots for consistency.
const PINNED_SOURCES: Record<string, number> = {
  bloomberg: 1,
  reuters: 1,
  wsj: 8,
  "the wall street journal": 8,
  cnbc: 2,
  marketwatch: 6,
  yahoo: 4,
  "yahoo finance": 4,
  "seeking alpha": 3,
  barrons: 0,
  "barron's": 0,
  "financial times": 7,
  ft: 7,
  "the motley fool": 2,
  "motley fool": 2,
  nyt: 1,
  "the new york times": 1,
  finnhub: 5,
  "alpha vantage": 9,
};

const MUTED = "oklch(0.64 0.008 74)"; // muted-foreground fallback

export function sourceColor(source: string | undefined): string {
  if (!source) return MUTED;
  const key = source.trim().toLowerCase();
  const pinned = PINNED_SOURCES[key];
  if (pinned !== undefined) return SOURCE_PALETTE[pinned];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return SOURCE_PALETTE[Math.abs(h) % SOURCE_PALETTE.length];
}
