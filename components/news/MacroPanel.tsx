"use client";

import { useEffect, useState } from "react";
import type { SentimentData } from "@/app/api/sentiment/route";
import { YieldCurve } from "./YieldCurve";

export function MacroPanel() {
  const [sentiment, setSentiment] = useState<SentimentData | null>(null);
  const [sentimentLoading, setSentimentLoading] = useState(true);

  useEffect(() => {
    fetch("/api/sentiment")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSentiment(d && !d.error ? d : null))
      .catch(() => {})
      .finally(() => setSentimentLoading(false));
  }, []);

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-r border-border flex flex-col">
      {/* Treasury yield curve */}
      <YieldCurve />

      {/* Fear & Greed sentiment */}
      {(sentimentLoading || sentiment) && (
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-lg font-medium text-foreground leading-none mb-3">Fear &amp; Greed</h2>
          {sentimentLoading ? <SentimentSkeleton /> : sentiment && <FearGreed data={sentiment} />}
        </div>
      )}
    </aside>
  );
}

/* ─── Fear & Greed gauge ─── */
const RUBY = "0.66 0.19 25";
const EMERALD = "0.72 0.15 152";

function zoneColor(score: number): string {
  if (score < 45) return "var(--negative)";
  if (score > 55) return "var(--positive)";
  return "oklch(0.72 0.14 74)"; // amber — neutral zone
}

function FearGreed({ data }: { data: SentimentData }) {
  const color = zoneColor(data.score);
  return (
    <div className="flex flex-col gap-3">
      {/* score + rating */}
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-3xl leading-none" style={{ color }}>
          {data.score}
        </span>
        <span className="text-sm font-medium" style={{ color }}>
          {data.rating}
        </span>
      </div>

      {/* gradient gauge with marker */}
      <div className="relative">
        <div
          className="h-2 rounded-full"
          style={{
            background: `linear-gradient(to right,
              oklch(${RUBY}),
              oklch(0.72 0.14 74),
              oklch(${EMERALD}))`,
          }}
        />
        <div
          className="absolute top-1/2 h-3.5 w-3.5 rounded-full border-2 -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${Math.min(100, Math.max(0, data.score))}%`,
            background: "oklch(0.10 0 0)",
            borderColor: color,
          }}
          aria-hidden
        />
        <div className="flex justify-between mt-1.5">
          <span className="text-muted-foreground" style={{ fontSize: "0.6rem" }}>Extreme Fear</span>
          <span className="text-muted-foreground" style={{ fontSize: "0.6rem" }}>Extreme Greed</span>
        </div>
      </div>

      {/* historical comparison */}
      <div className="flex flex-col gap-1.5 pt-1">
        <CompareRow label="Prev. close" score={data.previousClose} />
        <CompareRow label="1 week ago" score={data.week} />
        <CompareRow label="1 month ago" score={data.month} />
      </div>
    </div>
  );
}

function CompareRow({ label, score }: { label: string; score: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-mono" style={{ color: zoneColor(score) }}>
        {score}
      </span>
    </div>
  );
}

function SentimentSkeleton() {
  return (
    <div className="flex flex-col gap-3 animate-pulse">
      <div className="flex items-baseline justify-between">
        <div className="h-7 w-10 rounded-sm" style={{ background: "oklch(0.16 0 0)" }} />
        <div className="h-4 w-16 rounded-sm" style={{ background: "oklch(0.16 0 0)" }} />
      </div>
      <div className="h-2 w-full rounded-full" style={{ background: "oklch(0.16 0 0)" }} />
    </div>
  );
}

