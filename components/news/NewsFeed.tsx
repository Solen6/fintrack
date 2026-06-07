"use client";

import { useMemo } from "react";
import type { NewsArticle } from "@/app/api/news/route";
import { formatRelativeTime } from "@/lib/format";

interface Props {
  tickers: string[];
  articles: NewsArticle[];
  loading: boolean;
  selectedTicker: string | null;
  onTickerSelect: (ticker: string | null) => void;
}

export function NewsFeed({ tickers, articles, loading, selectedTicker, onTickerSelect }: Props) {
  const filtered = useMemo(() => {
    if (!selectedTicker) return articles;
    return articles.filter((a) => a.ticker === selectedTicker);
  }, [articles, selectedTicker]);

  const [lead, ...rest] = filtered;

  return (
    <div className="flex flex-1 overflow-hidden border-r border-border">
      {/* Ticker sidebar */}
      <nav
        className="w-28 shrink-0 border-r border-border overflow-y-auto py-3"
        aria-label="News ticker filter"
      >
        <button onClick={() => onTickerSelect(null)} className={tickerBtn(selectedTicker === null)}>
          All
        </button>
        {tickers.map((t) => (
          <button
            key={t}
            onClick={() => onTickerSelect(t)}
            className={tickerBtn(selectedTicker === t)}
            aria-pressed={selectedTicker === t}
          >
            {t}
          </button>
        ))}
        {tickers.length === 0 && !loading && (
          <p className="px-4 py-2 text-xs text-muted-foreground leading-snug">
            Upload a portfolio to see tickers here.
          </p>
        )}
      </nav>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <FeedSkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">
              {selectedTicker
                ? `No recent news for ${selectedTicker}.`
                : "No news found. Check back soon."}
            </p>
          </div>
        ) : (
          <div>
            {lead && <LeadStory item={lead} />}
            {rest.map((item) => (
              <FeedItem key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function tickerBtn(active: boolean) {
  return [
    "w-full text-left px-4 py-2 text-sm font-mono transition-colors duration-150",
    active
      ? "text-foreground font-semibold"
      : "text-muted-foreground hover:text-foreground",
  ].join(" ");
}

/* ─── Loading skeleton ─── */
function FeedSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="px-6 py-5 border-b border-border">
        <div className="flex gap-2 mb-3">
          <div className="h-4 w-12 rounded-sm" style={{ background: "oklch(0.16 0 0)" }} />
          <div className="h-4 w-20 rounded-sm" style={{ background: "oklch(0.14 0 0)" }} />
        </div>
        <div className="h-5 w-3/4 rounded-sm mb-2" style={{ background: "oklch(0.16 0 0)" }} />
        <div className="h-4 w-full rounded-sm mb-1" style={{ background: "oklch(0.14 0 0)" }} />
        <div className="h-4 w-2/3 rounded-sm" style={{ background: "oklch(0.14 0 0)" }} />
      </div>
      {[...Array(5)].map((_, i) => (
        <div key={i} className="px-6 py-4 border-b border-border">
          <div className="flex gap-2 mb-2">
            <div className="h-3 w-10 rounded-sm" style={{ background: "oklch(0.16 0 0)" }} />
            <div className="h-3 w-16 rounded-sm" style={{ background: "oklch(0.14 0 0)" }} />
          </div>
          <div className="h-4 w-4/5 rounded-sm" style={{ background: "oklch(0.16 0 0)" }} />
        </div>
      ))}
    </div>
  );
}

/* ─── Lead story ─── */
function LeadStory({ item }: { item: NewsArticle }) {
  const inner = (
    <article className="px-6 py-5 border-b border-border group">
      <div className="flex items-center gap-2 mb-2">
        {item.ticker && (
          <span
            className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded-sm"
            style={{ background: "oklch(0.16 0 0)", color: "oklch(0.72 0.14 74)" }}
          >
            {item.ticker}
          </span>
        )}
        <span className="text-xs text-muted-foreground">{item.source}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {formatRelativeTime(new Date(item.timestamp))}
        </span>
      </div>
      <h2
        className="text-base font-semibold leading-snug mb-2 text-foreground group-hover:underline"
        style={{ textWrap: "balance" } as React.CSSProperties}
      >
        {item.headline}
      </h2>
      {item.summary && (
        <p
          className="text-sm text-muted-foreground leading-relaxed line-clamp-3"
          style={{ textWrap: "pretty" } as React.CSSProperties}
        >
          {item.summary}
        </p>
      )}
    </article>
  );

  return item.url ? (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className="block">
      {inner}
    </a>
  ) : (
    inner
  );
}

/* ─── Regular feed item ─── */
function FeedItem({ item }: { item: NewsArticle }) {
  const inner = (
    <article className="px-6 py-4 border-b border-border transition-colors duration-150 hover:bg-card group">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            {item.ticker && (
              <span className="text-xs font-mono shrink-0" style={{ color: "oklch(0.72 0.14 74)" }}>
                {item.ticker}
              </span>
            )}
            <span className="text-xs text-muted-foreground">{item.source}</span>
            <span className="text-xs text-muted-foreground ml-auto shrink-0">
              {formatRelativeTime(new Date(item.timestamp))}
            </span>
          </div>
          <p className="text-sm font-medium text-foreground leading-snug group-hover:underline">
            {item.headline}
          </p>
        </div>
      </div>
    </article>
  );

  return item.url ? (
    <a href={item.url} target="_blank" rel="noopener noreferrer" className="block">
      {inner}
    </a>
  ) : (
    inner
  );
}
