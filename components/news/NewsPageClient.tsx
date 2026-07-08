"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import nextDynamic from "next/dynamic";
import { NewsFeed } from "@/components/news/NewsFeed";
import { MacroPanel } from "@/components/news/MacroPanel";
import { NewsSourceManager } from "@/components/news/NewsSourceManager";
import type { NewsSource } from "@/components/news/NewsSourceManager";
import { NewsPreferencesModal } from "@/components/news/NewsPreferencesModal";
import type { NewsArticle } from "@/app/api/news/route";
import type { ArticleState } from "@/app/api/news/interactions/route";
import { DEFAULT_BUILTIN_PREFS, type BuiltinKey, type BuiltinPrefs } from "@/lib/news-builtins";
import {
  DEFAULT_PREFS,
  loadPrefs,
  savePrefs,
  isOnboarded,
  markOnboarded,
  type NewsPrefs,
} from "@/lib/news-preferences";

const CommodityChart = nextDynamic(
  () => import("@/components/news/CommodityChart").then((m) => m.CommodityChart),
  {
    ssr: false,
    loading: () => <div className="border-t border-border" style={{ height: 280 }} />,
  }
);

const POLL_INTERVAL = 10 * 60_000; // 10 minutes

async function fetchAllNews(
  portfolioTickers: string[],
  builtins: BuiltinPrefs
): Promise<NewsArticle[]> {
  const param = portfolioTickers.join(",");
  const empty = Promise.resolve({ articles: [] as NewsArticle[] });
  const [finnhubResult, avResult, saResult, feedsResult] = await Promise.allSettled([
    builtins.finnhub
      ? fetch(`/api/news?tickers=${param}`).then((r) => (r.ok ? r.json() : { articles: [] }))
      : empty,
    builtins.alphavantage
      ? fetch(`/api/news/av?tickers=${param}`).then((r) => (r.ok ? r.json() : { articles: [] }))
      : empty,
    builtins.seekingalpha
      ? fetch(`/api/news/sa?tickers=${param}`).then((r) => (r.ok ? r.json() : { articles: [] }))
      : empty,
    fetch(`/api/news/feeds`).then((r) => (r.ok ? r.json() : { articles: [] })),
  ]);

  const finnhub: NewsArticle[] =
    finnhubResult.status === "fulfilled" ? (finnhubResult.value.articles ?? []) : [];
  const av: NewsArticle[] =
    avResult.status === "fulfilled" ? (avResult.value.articles ?? []) : [];
  const sa: NewsArticle[] =
    saResult.status === "fulfilled" ? (saResult.value.articles ?? []) : [];
  const feeds: NewsArticle[] =
    feedsResult.status === "fulfilled" ? (feedsResult.value.articles ?? []) : [];

  // Merge: RSS feeds first (user-curated), then AV (broad market), then
  // Finnhub + Seeking Alpha (portfolio-specific). First-seen URL wins.
  const seen = new Set<string>();
  const merged: NewsArticle[] = [];
  for (const a of [...feeds, ...av, ...finnhub, ...sa]) {
    const key = a.url || a.id;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(a);
    }
  }
  return merged.sort((a, b) => b.timestamp - a.timestamp).slice(0, 150);
}

export function NewsPageClient() {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "saved">("all");
  const [tickers, setTickers] = useState<string[]>([]);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [interactions, setInteractions] = useState<Record<string, ArticleState>>({});
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [builtins, setBuiltins] = useState<BuiltinPrefs>(DEFAULT_BUILTIN_PREFS);
  const [loading, setLoading] = useState(true);
  const [showSourceManager, setShowSourceManager] = useState(false);
  const [prefs, setPrefs] = useState<NewsPrefs>(DEFAULT_PREFS);
  const [showPrefs, setShowPrefs] = useState(false);
  const [prefsFirstRun, setPrefsFirstRun] = useState(false);
  const tickersRef = useRef<string[]>([]);
  const interactionsRef = useRef<Record<string, ArticleState>>({});
  const builtinsRef = useRef<BuiltinPrefs>(DEFAULT_BUILTIN_PREFS);
  const mountedRef = useRef(true);

  // Re-fetch the merged feed from current tickers + builtin prefs (used by poll + toggles)
  const refreshNews = useCallback(async () => {
    try {
      const merged = await fetchAllNews(tickersRef.current, builtinsRef.current);
      if (mountedRef.current) setArticles(merged);
    } catch { /* silent */ }
  }, []);

  // Load everything on mount
  useEffect(() => {
    mountedRef.current = true;

    async function load() {
      setLoading(true);
      try {
        // Holdings, interactions, sources, builtin prefs all load in parallel
        const [hRes, intRes, srcRes, blRes] = await Promise.allSettled([
          fetch("/api/holdings").then((r) => (r.ok ? r.json() : { holdings: [] })),
          fetch("/api/news/interactions").then((r) => (r.ok ? r.json() : { interactions: {} })),
          fetch("/api/news/sources").then((r) => (r.ok ? r.json() : { sources: [] })),
          fetch("/api/news/builtins").then((r) => (r.ok ? r.json() : { builtins: DEFAULT_BUILTIN_PREFS })),
        ]);

        if (!mountedRef.current) return;

        const portfolioTickers: string[] = hRes.status === "fulfilled"
          ? [...new Set<string>((hRes.value.holdings as Array<{ ticker: string }>).map((h) => h.ticker))].sort()
          : [];

        tickersRef.current = portfolioTickers;
        setTickers(portfolioTickers);

        if (intRes.status === "fulfilled") {
          const map = intRes.value.interactions ?? {};
          setInteractions(map);
          interactionsRef.current = map;
        }
        if (srcRes.status === "fulfilled") setSources(srcRes.value.sources ?? []);
        if (blRes.status === "fulfilled") {
          const bl = blRes.value.builtins ?? DEFAULT_BUILTIN_PREFS;
          setBuiltins(bl);
          builtinsRef.current = bl;
        }

        // Load saved preferences (client-only) and trigger onboarding on first visit.
        setPrefs(loadPrefs());
        if (!isOnboarded()) {
          setPrefsFirstRun(true);
          setShowPrefs(true);
        }

        const merged = await fetchAllNews(portfolioTickers, builtinsRef.current);
        if (!mountedRef.current) return;
        setArticles(merged);
      } catch {
        // fall through to empty state
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    }

    load();
    const interval = setInterval(refreshNews, POLL_INTERVAL);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [refreshNews]);

  const handleToggleBuiltin = useCallback((key: BuiltinKey, enabled: boolean) => {
    const prev = builtinsRef.current;
    const next = { ...prev, [key]: enabled };

    // Optimistic
    builtinsRef.current = next;
    setBuiltins(next);
    refreshNews(); // re-fetch so disabled-source articles drop out / enabled ones appear

    // Persist (rollback on error)
    fetch("/api/news/builtins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, enabled }),
    })
      .then((r) => { if (!r.ok) throw new Error(); })
      .catch(() => {
        builtinsRef.current = prev;
        setBuiltins(prev);
        refreshNews();
      });
  }, [refreshNews]);

  const handleSavePrefs = useCallback(
    async (next: NewsPrefs, sourcesToAdd: { name: string; url: string }[]) => {
      savePrefs(next);
      setPrefs(next);
      markOnboarded();
      setShowPrefs(false);

      // Seed any newly-enabled curated sources as custom RSS feeds.
      if (sourcesToAdd.length) {
        const added: NewsSource[] = [];
        for (const feed of sourcesToAdd) {
          try {
            const res = await fetch("/api/news/sources", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(feed),
            });
            if (res.ok) {
              const d = await res.json();
              if (d.source) added.push(d.source);
            }
          } catch {
            /* skip this feed, keep going */
          }
        }
        if (added.length && mountedRef.current) {
          setSources((prev) => [...prev, ...added]);
        }
      }
      // Re-fetch so newly-added feeds pull into the merged feed.
      refreshNews();
    },
    [refreshNews]
  );

  const handleClosePrefs = useCallback(() => {
    // Dismissing the first-run modal still counts as onboarded (keep defaults)
    // so we don't nag on every visit.
    if (prefsFirstRun && !isOnboarded()) {
      markOnboarded();
      savePrefs(prefs);
    }
    setShowPrefs(false);
  }, [prefsFirstRun, prefs]);

  const handleInteract = useCallback((url: string, update: Partial<ArticleState>) => {
    const current = interactionsRef.current[url] ?? { read: false, saved: false, deleted: false };
    const next = { ...current, ...update };

    // Optimistic
    interactionsRef.current = { ...interactionsRef.current, [url]: next };
    setInteractions((prev) => ({ ...prev, [url]: next }));

    // Persist (fire-and-forget; rollback on error)
    fetch("/api/news/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, read: next.read, saved: next.saved, deleted: next.deleted }),
    }).catch(() => {
      interactionsRef.current = { ...interactionsRef.current, [url]: current };
      setInteractions((prev) => ({ ...prev, [url]: current }));
    });
  }, []);

  return (
    <>
      <div className="flex flex-1 overflow-hidden min-h-0">
        <NewsFeed
          tickers={tickers}
          articles={articles}
          loading={loading}
          selectedTicker={selectedTicker}
          onTickerSelect={setSelectedTicker}
          interactions={interactions}
          filter={filter}
          onFilterChange={setFilter}
          onInteract={handleInteract}
          onManageSources={() => setShowSourceManager(true)}
          prefs={prefs}
          onEditPreferences={() => {
            setPrefsFirstRun(false);
            setShowPrefs(true);
          }}
        />
        <MacroPanel />
      </div>
      <CommodityChart />

      {showSourceManager && (
        <NewsSourceManager
          sources={sources}
          builtins={builtins}
          onClose={() => setShowSourceManager(false)}
          onAdd={(s) => setSources((prev) => [...prev, s])}
          onToggle={(id, enabled) =>
            setSources((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)))
          }
          onDelete={(id) => setSources((prev) => prev.filter((s) => s.id !== id))}
          onToggleBuiltin={handleToggleBuiltin}
        />
      )}

      {showPrefs && (
        <NewsPreferencesModal
          firstRun={prefsFirstRun}
          initialPrefs={prefs}
          sources={sources}
          onClose={handleClosePrefs}
          onSave={handleSavePrefs}
          onOpenAdvanced={() => {
            handleClosePrefs();
            setShowSourceManager(true);
          }}
        />
      )}
    </>
  );
}
