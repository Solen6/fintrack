"use client";

import { useState, useEffect } from "react";
import nextDynamic from "next/dynamic";
import { NewsFeed } from "@/components/news/NewsFeed";
import { MacroPanel } from "@/components/news/MacroPanel";
import type { NewsArticle } from "@/app/api/news/route";

const CommodityChart = nextDynamic(
  () => import("@/components/news/CommodityChart").then((m) => m.CommodityChart),
  {
    ssr: false,
    loading: () => <div className="border-t border-border" style={{ height: 280 }} />,
  }
);

export function NewsPageClient() {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [tickers, setTickers] = useState<string[]>([]);
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        // 1. Load portfolio to get the user's tickers
        const hRes = await fetch("/api/holdings");
        const hData = hRes.ok ? await hRes.json() : { holdings: [] };
        const portfolioTickers: string[] = [
          ...new Set<string>(
            (hData.holdings as Array<{ ticker: string }>).map((h) => h.ticker)
          ),
        ].sort();

        if (cancelled) return;

        // 2. Fetch news for those tickers
        const param = portfolioTickers.join(",");
        const nRes = await fetch(`/api/news?tickers=${param}`);
        const nData = nRes.ok ? await nRes.json() : { articles: [] };

        if (cancelled) return;
        setTickers(portfolioTickers);
        setArticles(nData.articles ?? []);
      } catch {
        // fall through to empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
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
        />
        <MacroPanel />
      </div>
      <CommodityChart />
    </>
  );
}
