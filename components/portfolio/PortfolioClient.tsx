"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { AccountSidebar } from "./AccountSidebar";
import { SummaryStrip } from "./SummaryStrip";
import { HoldingsTable } from "./HoldingsTable";
import { HoldingsHeatmap } from "./HoldingsHeatmap";
import { CSVUploadPanel } from "./CSVUploadPanel";
import { AddPositionForm } from "./AddPositionForm";
import { AddCashForm } from "./AddCashForm";
import { ClosePositionModal } from "./ClosePositionModal";
import { DividendManager } from "./DividendManager";
import { ClosedPositions } from "./ClosedPositions";
import { DividendHistory } from "./DividendHistory";
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
  drip: boolean | null;
}

type ViewState = "loading" | "empty" | "uploading" | "addPosition" | "addCash" | "ready";

interface CashBalance {
  account: string;
  label: string;
  balance: number;
}

export function PortfolioClient() {
  const [view, setView] = useState<ViewState>("loading");
  const [subView, setSubView] = useState<"table" | "heatmap" | "closed" | "dividends">("table");
  const [holdings, setHoldings] = useState<HoldingWithMetrics[]>([]);
  const [cash, setCash] = useState<CashBalance[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [quotesError, setQuotesError] = useState(false);
  const [closingHolding, setClosingHolding] = useState<HoldingWithMetrics | null>(null);
  const [managingDividends, setManagingDividends] = useState(false);

  const existingAccounts = useMemo(
    () => [...new Set([...holdings.map((h) => h.account), ...cash.map((c) => c.account)])].sort(),
    [holdings, cash]
  );

  const cashByAccount = useMemo(() => {
    const m: Record<string, { label: string; balance: number }> = {};
    for (const c of cash) m[c.account] = { label: c.label, balance: c.balance };
    return m;
  }, [cash]);

  const loadData = useCallback(async () => {
    setView("loading");
    try {
      const [res, cashRes] = await Promise.all([
        fetch("/api/holdings"),
        fetch("/api/cash").catch(() => null),
      ]);
      if (!res.ok) throw new Error();
      const { holdings: dbHoldings }: { holdings: DBHolding[] } = await res.json();

      const cashBalances: CashBalance[] = cashRes?.ok
        ? (await cashRes.json()).balances ?? []
        : [];
      setCash(cashBalances);

      if ((!dbHoldings || dbHoldings.length === 0) && cashBalances.length === 0) {
        setView("empty");
        return;
      }
      if (!dbHoldings || dbHoldings.length === 0) {
        // Cash-only: nothing to price, but show the cash UI.
        setHoldings([]);
        setLastRefreshed(new Date());
        setView("ready");
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
            drip: h.drip ?? false,
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
    await Promise.all([
      fetch("/api/holdings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: accountName }),
      }),
      fetch("/api/cash", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: accountName }),
      }).catch(() => null),
    ]);
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

  if (view === "addPosition") {
    return (
      <AddPositionForm
        existingAccounts={existingAccounts}
        onSaved={() => loadData()}
        onCancel={() => setView("ready")}
      />
    );
  }

  if (view === "addCash") {
    return (
      <AddCashForm
        existingAccounts={existingAccounts}
        cashByAccount={cashByAccount}
        onSaved={() => loadData()}
        onCancel={() => setView("ready")}
      />
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <AccountSidebar
        holdings={holdings}
        cash={cash}
        selected={selectedAccount}
        onSelect={setSelectedAccount}
        onRemoveAccount={handleRemoveAccount}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        <SummaryStrip holdings={holdings} cash={cash} account={selectedAccount} />

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
            <div className="flex items-center rounded-sm border border-border overflow-hidden mr-2">
              <button
                onClick={() => setSubView("table")}
                className="text-xs px-2.5 py-1 transition-colors duration-150"
                style={{
                  background: subView === "table" ? "oklch(0.16 0 0)" : "transparent",
                  color: subView === "table" ? "var(--primary)" : "oklch(0.64 0.008 74)",
                }}
              >
                Table
              </button>
              <button
                onClick={() => setSubView("heatmap")}
                className="text-xs px-2.5 py-1 transition-colors duration-150"
                style={{
                  background: subView === "heatmap" ? "oklch(0.16 0 0)" : "transparent",
                  color: subView === "heatmap" ? "var(--primary)" : "oklch(0.64 0.008 74)",
                }}
              >
                Heatmap
              </button>
              <button
                onClick={() => setSubView("closed")}
                className="text-xs px-2.5 py-1 transition-colors duration-150"
                style={{
                  background: subView === "closed" ? "oklch(0.16 0 0)" : "transparent",
                  color: subView === "closed" ? "var(--primary)" : "oklch(0.64 0.008 74)",
                }}
              >
                Closed
              </button>
              <button
                onClick={() => setSubView("dividends")}
                className="text-xs px-2.5 py-1 transition-colors duration-150"
                style={{
                  background: subView === "dividends" ? "oklch(0.16 0 0)" : "transparent",
                  color: subView === "dividends" ? "var(--primary)" : "oklch(0.64 0.008 74)",
                }}
              >
                Dividends
              </button>
            </div>
            <button
              onClick={loadData}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-sm hover:bg-accent"
            >
              Refresh prices
            </button>
            <button
              onClick={() => setManagingDividends(true)}
              className="text-xs px-3 py-1 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              Manage dividends
            </button>
            <button
              onClick={() => setView("addPosition")}
              className="text-xs px-3 py-1 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              Add position
            </button>
            <button
              onClick={() => setView("addCash")}
              className="text-xs px-3 py-1 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              Add cash
            </button>
            <button
              onClick={() => setView("uploading")}
              className="text-xs px-3 py-1 rounded-sm"
              style={{ background: "oklch(0.72 0.14 74)", color: "oklch(0.08 0 0)" }}
            >
              Upload CSV
            </button>
          </div>
        </div>

        {subView === "table" && (
          <HoldingsTable
            holdings={holdings}
            account={selectedAccount}
            onEdit={async (holding, updates) => {
              const res = await fetch("/api/holdings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: holding.id, ...updates }),
              });
              if (!res.ok) throw new Error((await res.json()).error);
              loadData();
            }}
            onClose={(holding) => setClosingHolding(holding)}
            onDelete={async (holding) => {
              const res = await fetch("/api/holdings", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: holding.id }),
              });
              if (!res.ok) throw new Error((await res.json()).error);
              loadData();
            }}
          />
        )}
        {subView === "heatmap" && (
          <HoldingsHeatmap holdings={holdings} account={selectedAccount} />
        )}
        {subView === "closed" && <ClosedPositions />}
        {subView === "dividends" && <DividendHistory />}
      </main>

      {closingHolding && (
        <ClosePositionModal
          holding={closingHolding}
          onConfirm={async (shares, salePrice) => {
            const res = await fetch("/api/holdings/close", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                holdingId: closingHolding.id,
                shares,
                salePrice,
              }),
            });
            if (!res.ok) {
              const d = await res.json();
              throw new Error(d.error ?? "Failed to close");
            }
            setClosingHolding(null);
            loadData();
          }}
          onCancel={() => setClosingHolding(null)}
        />
      )}

      {managingDividends && (
        <DividendManager
          holdings={holdings}
          account={selectedAccount}
          onSaved={() => { setManagingDividends(false); loadData(); }}
          onCancel={() => setManagingDividends(false)}
        />
      )}
    </div>
  );
}
