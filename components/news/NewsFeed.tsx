"use client";

import { useMemo, useState } from "react";
import type { NewsArticle } from "@/app/api/news/route";
import type { ArticleState } from "@/app/api/news/interactions/route";
import { formatRelativeTime } from "@/lib/format";
import { sourceColor } from "@/lib/news-source-color";
import { articleLocked, articleVisible, type NewsPrefs } from "@/lib/news-preferences";

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
  prefs: NewsPrefs;
  onEditPreferences: () => void;
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
  prefs,
  onEditPreferences,
}: Props) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    let list = articles.filter((a) => !interactions[a.url]?.deleted);
    list = list.filter((a) => articleVisible(a, prefs));
    if (selectedTicker) list = list.filter((a) => a.ticker === selectedTicker);
    if (filter === "saved") list = list.filter((a) => interactions[a.url]?.saved);
    if (q) {
      list = list.filter(
        (a) =>
          a.headline.toLowerCase().includes(q) ||
          a.summary.toLowerCase().includes(q) ||
          a.source.toLowerCase().includes(q) ||
          (a.ticker ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [articles, selectedTicker, interactions, filter, prefs, q]);

  // Distinguish "no data" from "your preferences filtered everything out" from
  // "your search matched nothing".
  const noSearchMatch = q.length > 0 && filtered.length === 0;
  const hidByPrefs =
    !noSearchMatch &&
    filtered.length === 0 &&
    filter === "all" &&
    !selectedTicker &&
    articles.filter((a) => !interactions[a.url]?.deleted).length > 0;

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
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-0.5 shrink-0">
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
          </div>

          {/* Search */}
          <div className="relative min-w-0 w-36 sm:w-52">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
              <SearchIcon />
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search news…"
              aria-label="Search news"
              className="w-full bg-transparent border border-border rounded-sm pl-7 pr-6 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground transition-colors text-xs"
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1 shrink-0">
            <button
              onClick={onEditPreferences}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-medium text-foreground border border-border hover:border-primary transition-colors"
            >
              <SlidersIcon />
              Preferences
            </button>
            <button
              onClick={onManageSources}
              className="px-3 py-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Edit Sources
            </button>
          </div>
        </div>

        {loading ? (
          <FeedSkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-2 px-6 text-center">
            {noSearchMatch ? (
              <>
                <p className="text-sm text-muted-foreground">
                  No articles match “{query.trim()}”.
                </p>
                <button
                  onClick={() => setQuery("")}
                  className="text-xs font-medium transition-colors"
                  style={{ color: "oklch(0.72 0.14 74)" }}
                >
                  Clear search
                </button>
              </>
            ) : hidByPrefs ? (
              <>
                <p className="text-sm text-muted-foreground">
                  No articles match your preferences.
                </p>
                <button
                  onClick={onEditPreferences}
                  className="text-xs font-medium transition-colors"
                  style={{ color: "oklch(0.72 0.14 74)" }}
                >
                  Adjust preferences
                </button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {filter === "saved"
                  ? "No saved articles yet."
                  : selectedTicker
                  ? `No recent news for ${selectedTicker}.`
                  : "No news found. Check back soon."}
              </p>
            )}
          </div>
        ) : (
          <div>
            {lead && (
              <LeadStory
                item={lead}
                state={interactions[lead.url]}
                onInteract={onInteract}
                locked={articleLocked(lead, prefs)}
              />
            )}
            {rest.map((item) => (
              <FeedItem
                key={item.id}
                item={item}
                state={interactions[item.url]}
                onInteract={onInteract}
                locked={articleLocked(item, prefs)}
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

/* Magnifier icon for the search box (SVG, not emoji). */
function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* Sliders icon for the Preferences button (SVG, not emoji). */
function SlidersIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 4.5h7M11.5 4.5H14M2 11.5h2.5M7 11.5h7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="10" cy="4.5" r="1.75" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="5.5" cy="11.5" r="1.75" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/* ─── Source color coding ───
   Stable source → color mapping lives in lib/news-source-color so the feed and
   the Edit Sources modal render matching dots. */
function SourceLabel({ source }: { source: string | undefined }) {
  if (!source) return null;
  const color = sourceColor(source);
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: color }}
        aria-hidden
      />
      <span className="text-xs truncate" style={{ color }}>
        {source}
      </span>
    </span>
  );
}

/* ─── Paywall marker ───
   Shown when the user's plan for that publisher is the free tier and the
   publisher gates everything (WSJ, NYT, Bloomberg, FT). Marking rather than
   hiding is deliberate: the headline still carries information, and hiding these
   would just duplicate the source on/off switch. "Hide locked articles" in
   Preferences turns this into a filter for anyone who'd rather not see them. */
function LockBadge() {
  return (
    <span
      className="flex items-center gap-1 shrink-0 text-xs"
      style={{ color: "oklch(0.55 0.02 74)" }}
      title="Subscriber-only — you have this source set to Free in Preferences"
    >
      <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden>
        <rect x="2.5" y="5.5" width="7" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4.25 5.5V4a1.75 1.75 0 0 1 3.5 0v1.5" stroke="currentColor" strokeWidth="1.3" />
      </svg>
      <span className="sr-only">Subscriber-only. </span>
      Paywalled
    </span>
  );
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
  locked,
}: {
  item: NewsArticle;
  state: ArticleState | undefined;
  onInteract: (url: string, update: Partial<ArticleState>) => void;
  locked: boolean;
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
          <SourceLabel source={item.source} />
          {locked && <LockBadge />}
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
  locked,
}: {
  item: NewsArticle;
  state: ArticleState | undefined;
  onInteract: (url: string, update: Partial<ArticleState>) => void;
  locked: boolean;
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
            <SourceLabel source={item.source} />
            {locked && <LockBadge />}
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
