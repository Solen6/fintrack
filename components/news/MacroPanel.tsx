"use client";

import { useEffect, useState } from "react";
import type { MacroRateItem } from "@/app/api/macro/route";
import type { SentimentData } from "@/app/api/sentiment/route";

export function MacroPanel() {
  const [rates, setRates] = useState<MacroRateItem[]>([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const [sentiment, setSentiment] = useState<SentimentData | null>(null);
  const [sentimentLoading, setSentimentLoading] = useState(true);

  useEffect(() => {
    fetch("/api/macro")
      .then((r) => r.json())
      .then((d) => {
        setRates(d.rates ?? []);
        setUpdatedAt(d.updatedAt ? new Date(d.updatedAt) : null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    fetch("/api/sentiment")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSentiment(d && !d.error ? d : null))
      .catch(() => {})
      .finally(() => setSentimentLoading(false));
  }, []);

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-r border-border flex flex-col">
      {/* Rates */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-medium text-foreground leading-none">Rates &amp; Macro</h2>
          {updatedAt && (
            <p className="text-xs" style={{ color: "oklch(0.38 0.008 74)" }}>
              {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>

        {loading ? <RatesSkeleton /> : (
          <div className="flex flex-col gap-2.5">
            {rates.map((r) => <RateRow key={r.label} rate={r} />)}
          </div>
        )}
      </div>

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

/* ─── Single rate row ─── */
function RateRow({ rate: r }: { rate: MacroRateItem }) {
  const positive = r.change > 0;
  const negative = r.change < 0;
  const changeColor = positive
    ? "var(--positive)"
    : negative
    ? "var(--negative)"
    : "oklch(0.44 0.008 74)";

  const changeLabel =
    r.change === 0
      ? null
      : r.unit === "bps"
      ? `${r.change > 0 ? "+" : ""}${r.change}bp`
      : `${r.change > 0 ? "+" : ""}${r.change}%`;

  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <span className="text-sm text-muted-foreground">{r.label}</span>
        {r.note && (
          <p className="text-muted-foreground" style={{ fontSize: "0.65rem", opacity: 0.6 }}>
            {r.note}
          </p>
        )}
      </div>
      <div className="flex items-baseline gap-2 shrink-0">
        <span className="text-sm font-mono text-foreground">{r.value}</span>
        {changeLabel && (
          <span className="text-xs font-mono" style={{ color: changeColor }}>
            {changeLabel}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Loading skeleton ─── */
function RatesSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 animate-pulse">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <div className="h-4 w-24 rounded-sm" style={{ background: "oklch(0.16 0 0)" }} />
          <div className="h-4 w-14 rounded-sm" style={{ background: "oklch(0.16 0 0)" }} />
        </div>
      ))}
    </div>
  );
}
