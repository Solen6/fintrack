"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { AccountSidebar } from "./AccountSidebar";
import { SummaryStrip } from "./SummaryStrip";
import { HoldingsTable } from "./HoldingsTable";
import { CSVUploadPanel } from "./CSVUploadPanel";
import { computeMetrics } from "@/lib/types";
import type { HoldingWithMetrics, Quote } from "@/lib/types";

interface DBHolding {
  id: string;
  ticker: string;
  name: string;
  shares: number;
  cost_basis: number;
  account: string;
  sector: string | null;
  notes: string | null;
}

type ViewState = "loading" | "empty" | "uploading" | "ready";

export function PortfolioClient() {
  const [view, setView] = useState<ViewState>("loading");
  const [holdings, setHoldings] = useState<HoldingWithMetrics[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [quotesError, setQuotesError] = useState(false);

  const existingAccounts = useMemo(
    () => [...new Set(holdings.map((h) => h.account))].sort(),
    [holdings]
  );

  const loadData = useCallback(async () => {
    setView("loading");
    try {
      const res = await fetch("/api/holdings");
      if (!res.ok) throw new Error();
      const { holdings: dbHoldings }: { holdings: DBHolding[] } = await res.json();

      if (!dbHoldings || dbHoldings.length === 0) {
        setView("empty");
        return;
      }

      const tickers = [...new Set(dbHoldings.map((h) => h.ticker))];
      let quotes: Record<string, Quote> = {};
      setQuotesError(false);
      try {
        const qRes = await fetch(`/api/quotes?tickers=${tickers.join(",")}`);
        if (qRes.ok) quotes = (await qRes.json()).quotes ?? {};
        else setQuotesError(true);
      } catch {
        setQuotesError(true);
      }

      // Live sectors from Finnhub — authoritative; ignores stale stored values
      let sectors: Record<string, string> = {};
      try {
        const sRes = await fetch(`/api/sectors?tickers=${tickers.join(",")}`);
        if (sRes.ok) sectors = (await sRes.json()).sectors ?? {};
      } catch {
        // non-fatal — fall back to "—" in the table
      }

      const merged: HoldingWithMetrics[] = dbHoldings.map((h) => {
        const q = quotes[h.ticker];
        return computeMetrics(
          {
            id: h.id,
            ticker: h.ticker,
            name: h.name,
            sector: sectors[h.ticker] ?? "",
            shares: h.shares,
            costBasis: h.cost_basis,
            currentPrice: q?.price ?? h.cost_basis,
            account: h.account,
            notes: h.notes ?? undefined,
          },
          q?.changePct ?? 0
        );
      });

      setHoldings(merged);
      setLastRefreshed(new Date());
      setView("ready");
    } catch {
      setView("empty");
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRemoveAccount = async (accountName: string) => {
    await fetch("/api/holdings", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: accountName }),
    });
    loadData();
  };

  if (view === "loading") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground animate-pulse">Loading portfolio…</p>
      </div>
    );
  }

  if (view === "empty") {
    return (
      <CSVUploadPanel
        onSaved={() => loadData()}
      />
    );
  }

  if (view === "uploading") {
    return (
      <CSVUploadPanel
        existingAccounts={existingAccounts}
        onSaved={() => loadData()}
        onCancel={() => setView("ready")}
      />
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <AccountSidebar
        holdings={holdings}
        selected={selectedAccount}
        onSelect={setSelectedAccount}
        onRemoveAccount={handleRemoveAccount}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        <SummaryStrip holdings={holdings} account={selectedAccount} />

        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-2 border-b border-border shrink-0">
          <div>
            {quotesError && (
              <p className="text-xs" style={{ color: "var(--negative)" }}>
                Live prices unavailable — showing cost basis
              </p>
            )}
            {lastRefreshed && !quotesError && (
              <p className="text-xs text-muted-foreground">
                Prices as of{" "}
                {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-sm hover:bg-accent"
            >
              Refresh prices
            </button>
            <button
              onClick={() => setView("uploading")}
              className="text-xs px-3 py-1 rounded-sm"
              style={{ background: "oklch(0.72 0.14 74)", color: "oklch(0.08 0 0)" }}
            >
              Upload account
            </button>
          </div>
        </div>

        <HoldingsTable holdings={holdings} account={selectedAccount} />
      </main>
    </div>
  );
}
