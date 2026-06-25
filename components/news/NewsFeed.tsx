"use client";

import { useMemo } from "react";
import type { NewsArticle } from "@/app/api/news/route";
import type { ArticleState } from "@/app/api/news/interactions/route";
import { formatRelativeTime } from "@/lib/format";

type Filter = "all" | "saved";

interface Props {
  tickers: string[];
  articles: NewsArticle[];
  loading: boolean;
  selectedTicker: string | null;
  onTickerSelect: (ticker: string | null) => void;
  interactions: Record<string, ArticleState>;
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  onInteract: (url: string, update: Partial<ArticleState>) => void;
  onManageSources: () => void;
}

export function NewsFeed({
  tickers,
  articles,
  loading,
  selectedTicker,
  onTickerSelect,
  interactions,
  filter,
  onFilterChange,
  onInteract,
  onManageSources,
}: Props) {
  const filtered = useMemo(() => {
    let list = articles.filter((a) => !interactions[a.url]?.deleted);
    if (selectedTicker) list = list.filter((a) => a.ticker === selectedTicker);
    if (filter === "saved") list = list.filter((a) => interactions[a.url]?.saved);
    return list;
  }, [articles, selectedTicker, interactions, filter]);

  const [lead, ...rest] = filtered;

  return (
    <div className="flex flex-1 overflow-hidden border-r border-border">
      {/* Ticker sidebar */}
      <nav
        className="w-28 shrink-0 border-r border-border overflow-y-auto py-3 flex flex-col"
        aria-label="News filter"
      >
        <div className="flex-1">
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
        </div>
      </nav>

      {/* Feed area */}
      <div className="flex-1 overflow-y-auto flex flex-col min-w-0">
        {/* Filter tabs */}
        <div className="flex items-center gap-0.5 px-4 py-2 border-b border-border shrink-0">
          {(["all", "saved"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => onFilterChange(f)}
              className="px-3 py-1 rounded-sm text-xs font-medium transition-colors capitalize"
              style={{
                color: filter === f ? "oklch(0.72 0.14 74)" : undefined,
              }}
              aria-pressed={filter === f}
            >
              {f === "all" ? "All" : "Saved"}
            </button>
          ))}
          <button
            onClick={onManageSources}
            className="px-3 py-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground transition-colors ml-1"
          >
            Edit Sources
          </button>
        </div>

        {loading ? (
          <FeedSkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center flex-1">
            <p className="text-sm text-muted-foreground">
              {filter === "saved"
                ? "No saved articles yet."
                : selectedTicker
                ? `No recent news for ${selectedTicker}.`
                : "No news found. Check back soon."}
            </p>
          </div>
        ) : (
          <div>
            {lead && (
              <LeadStory item={lead} state={interactions[lead.url]} onInteract={onInteract} />
            )}
            {rest.map((item) => (
              <FeedItem
                key={item.id}
                item={item}
                state={interactions[item.url]}
                onInteract={onInteract}
              />
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
    active ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
  ].join(" ");
}

/* ─── Per-article action buttons ─── */
function Actions({
  url,
  state,
  onInteract,
}: {
  url: string;
  state: ArticleState | undefined;
  onInteract: (url: string, update: Partial<ArticleState>) => void;
}) {
  const isRead = state?.read ?? false;
  const isSaved = state?.saved ?? false;

  function stop(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  return (
    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
      {/* Save */}
      <button
        onClick={(e) => { stop(e); onInteract(url, { saved: !isSaved }); }}
        className="w-7 h-7 flex items-center justify-center rounded transition-colors hover:bg-white/5 text-sm"
        style={{ color: isSaved ? "oklch(0.72 0.14 74)" : "oklch(0.40 0 0)" }}
        title={isSaved ? "Unsave" : "Save"}
      >
        {isSaved ? "★" : "☆"}
      </button>
      {/* Mark read */}
      <button
        onClick={(e) => { stop(e); onInteract(url, { read: !isRead }); }}
        className="w-7 h-7 flex items-center justify-center rounded transition-colors hover:bg-white/5 text-xs"
        style={{ color: isRead ? "oklch(0.72 0.14 74)" : "oklch(0.40 0 0)" }}
        title={isRead ? "Mark unread" : "Mark read"}
      >
        {isRead ? "●" : "○"}
      </button>
      {/* Dismiss */}
      <button
        onClick={(e) => { stop(e); onInteract(url, { deleted: true }); }}
        className="w-7 h-7 flex items-center justify-center rounded transition-colors hover:bg-white/5 text-xs"
        style={{ color: "oklch(0.40 0 0)" }}
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
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
      {[...Array(6)].map((_, i) => (
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
function LeadStory({
  item,
  state,
  onInteract,
}: {
  item: NewsArticle;
  state: ArticleState | undefined;
  onInteract: (url: string, update: Partial<ArticleState>) => void;
}) {
  const isRead = state?.read ?? false;

  const inner = (
    <article
      className="px-6 py-5 border-b border-border group transition-opacity duration-150"
      style={{ opacity: isRead ? 0.5 : 1 }}
    >
      <div className="flex items-start gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {item.ticker && (
            <span
              className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded-sm shrink-0"
              style={{ background: "oklch(0.16 0 0)", color: "oklch(0.72 0.14 74)" }}
            >
              {item.ticker}
            </span>
          )}
          <span className="text-xs text-muted-foreground truncate">{item.source}</span>
          <span className="text-xs text-muted-foreground ml-auto shrink-0">
            {formatRelativeTime(new Date(item.timestamp))}
          </span>
        </div>
        <Actions url={item.url} state={state} onInteract={onInteract} />
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
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block"
      onClick={() => { if (!isRead) onInteract(item.url, { read: true }); }}
    >
      {inner}
    </a>
  ) : (
    inner
  );
}

/* ─── Regular feed item ─── */
function FeedItem({
  item,
  state,
  onInteract,
}: {
  item: NewsArticle;
  state: ArticleState | undefined;
  onInteract: (url: string, update: Partial<ArticleState>) => void;
}) {
  const isRead = state?.read ?? false;

  const inner = (
    <article
      className="px-6 py-4 border-b border-border hover:bg-card group transition-colors duration-150"
      style={{ opacity: isRead ? 0.5 : 1 }}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            {item.ticker && (
              <span
                className="text-xs font-mono shrink-0"
                style={{ color: "oklch(0.72 0.14 74)" }}
              >
                {item.ticker}
              </span>
            )}
            <span className="text-xs text-muted-foreground truncate">{item.source}</span>
            <span className="text-xs text-muted-foreground ml-auto shrink-0">
              {formatRelativeTime(new Date(item.timestamp))}
            </span>
          </div>
          <p className="text-sm font-medium text-foreground leading-snug group-hover:underline">
            {item.headline}
          </p>
        </div>
        <Actions url={item.url} state={state} onInteract={onInteract} />
      </div>
    </article>
  );

  return item.url ? (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block"
      onClick={() => { if (!isRead) onInteract(item.url, { read: true }); }}
    >
      {inner}
    </a>
  ) : (
    inner
  );
}
