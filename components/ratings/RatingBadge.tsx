"use client";

import { useEffect, useMemo, useState } from "react";
import type { AnalystRating } from "@/app/api/ratings/route";

export type { AnalystRating };

/* Shared analyst-rating UI — one look everywhere a security shows a rating
   (watchlist, Accounts holding insights, paper stock detail). */

const LABEL_COLOR: Record<AnalystRating["label"], string> = {
  "Strong Buy":  "oklch(0.76 0.17 152)",
  "Buy":         "oklch(0.72 0.15 152)",
  "Hold":        "oklch(0.72 0.14 74)",
  "Sell":        "oklch(0.66 0.16 28)",
  "Strong Sell": "oklch(0.60 0.19 25)",
};

const SEGMENTS: { key: keyof Pick<AnalystRating, "strongBuy" | "buy" | "hold" | "sell" | "strongSell">; label: string; color: string }[] = [
  { key: "strongBuy",  label: "Strong buy",  color: LABEL_COLOR["Strong Buy"] },
  { key: "buy",        label: "Buy",         color: LABEL_COLOR["Buy"] },
  { key: "hold",       label: "Hold",        color: LABEL_COLOR["Hold"] },
  { key: "sell",       label: "Sell",        color: LABEL_COLOR["Sell"] },
  { key: "strongSell", label: "Strong sell", color: LABEL_COLOR["Strong Sell"] },
];

/** Fetch ratings for a set of symbols (server caches 12h per symbol). */
export function useRatings(symbols: string[]): {
  ratings: Record<string, AnalystRating | null>;
  loading: boolean;
} {
  const key = useMemo(() => [...new Set(symbols.map((s) => s.toUpperCase()))].sort().join(","), [symbols]);
  const [ratings, setRatings] = useState<Record<string, AnalystRating | null>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!key) {
      setRatings({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/ratings?symbols=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : { ratings: {} }))
      .then((d: { ratings?: Record<string, AnalystRating | null> }) => {
        if (!cancelled) setRatings(d.ratings ?? {});
      })
      .catch(() => {
        if (!cancelled) setRatings({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { ratings, loading };
}

/** Consensus pill: "Buy · 4.1" tinted by label, with analyst count. */
export function RatingBadge({
  rating,
  loading = false,
  showCount = true,
}: {
  rating: AnalystRating | null | undefined;
  loading?: boolean;
  showCount?: boolean;
}) {
  if (loading) return <span className="text-xs text-muted-foreground">…</span>;
  if (!rating) return <span className="text-xs text-muted-foreground">No coverage</span>;
  const color = LABEL_COLOR[rating.label];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className="text-[11px] rounded-sm px-1.5 py-0.5 leading-none"
        style={{ color, background: color.replace(")", " / 0.14)") }}
      >
        {rating.label} · {rating.score.toFixed(1)}
      </span>
      {showCount && (
        <span className="text-[10px] text-muted-foreground">{rating.total} analysts</span>
      )}
    </span>
  );
}

/** Stacked distribution bar (strong buy → strong sell), with a count legend. */
export function RatingBar({ rating, legend = true }: { rating: AnalystRating; legend?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <div
        className="flex h-2 w-full rounded-full overflow-hidden"
        role="img"
        aria-label={SEGMENTS.map((s) => `${s.label} ${rating[s.key]}`).join(", ")}
      >
        {SEGMENTS.filter((s) => rating[s.key] > 0).map((s) => (
          <span
            key={s.key}
            style={{ background: s.color, flexGrow: rating[s.key] }}
            title={`${s.label}: ${rating[s.key]}`}
          />
        ))}
      </div>
      {legend && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {SEGMENTS.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-[2px]" style={{ background: s.color }} aria-hidden />
              {s.label} {rating[s.key]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
