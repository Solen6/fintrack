"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { AccountSidebar } from "./AccountSidebar";
import { SummaryStrip } from "./SummaryStrip";
import { unitMethodReturn, earliestStoredCapital, type ReturnSnapshot, type ReturnFlow } from "@/lib/portfolio-return";
import { HoldingsTable } from "./HoldingsTable";
import { PortfolioDeck } from "./PortfolioDeck";
import { CSVUploadPanel } from "./CSVUploadPanel";
import { AddPositionForm } from "./AddPositionForm";
import { AddBondForm } from "./AddBondForm";
import { AddCashForm } from "./AddCashForm";
import { DepositForm } from "./DepositForm";
import { ClosePositionModal } from "./ClosePositionModal";
import { DividendManager } from "./DividendManager";
import { ClosedPositions } from "./ClosedPositions";
import { DividendHistory } from "./DividendHistory";
import { FixedIncomeView } from "./FixedIncomeView";
import { MonthlyReports } from "./MonthlyReports";
import { computeMetrics } from "@/lib/types";
import type { HoldingWithMetrics, Quote, BondMetrics, InstrumentType, BondType, DayCount, BondPriceSource } from "@/lib/types";

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
  instrument_type: string | null;
  bond_type: string | null;
  cusip: string | null;
  coupon_rate: number | null;
  coupon_freq: number | null;
  maturity_date: string | null;
  issue_date: string | null;
  day_count: string | null;
  price_source: string | null;
  manual_price: number | null;
  credit_spread_bps: number | null;
  acquired_at: string | null;
}

type BondMark = BondMetrics & { currentPrice: number };

type ViewState = "loading" | "empty" | "uploading" | "addPosition" | "addBond" | "addCash" | "deposit" | "ready";

interface CashBalance {
  account: string;
  label: string;
  balance: number;
}

export function PortfolioClient() {
  const [view, setView] = useState<ViewState>("loading");
  const [subView, setSubView] = useState<"table" | "heatmap" | "bonds" | "closed" | "income" | "reports">("heatmap");
  const [holdings, setHoldings] = useState<HoldingWithMetrics[]>([]);
  const [cash, setCash] = useState<CashBalance[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [quotesError, setQuotesError] = useState(false);
  const [closingHolding, setClosingHolding] = useState<HoldingWithMetrics | null>(null);
  const [managingDividends, setManagingDividends] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<ReturnSnapshot[]>([]);
  const [flows, setFlows] = useState<ReturnFlow[]>([]);
  const [seeds, setSeeds] = useState<{ account: string; seedCostBasis: number; basePrice: number }[]>([]);

  const existingAccounts = useMemo(
    () => [...new Set([...holdings.map((h) => h.account), ...cash.map((c) => c.account)])].sort(),
    [holdings, cash]
  );

  const hasBonds = useMemo(() => holdings.some((h) => h.instrumentType === "bond"), [holdings]);

  const cashByAccount = useMemo(() => {
    const m: Record<string, { label: string; balance: number }> = {};
    for (const c of cash) m[c.account] = { label: c.label, balance: c.balance };
    return m;
  }, [cash]);

  /* Cumulative time-weighted return for the selected account (or all), computed
     the same way as the dashboard hero so the two agree. null until snapshots
     load / when there isn't enough history. */
  const cumReturn = useMemo(() => {
    const allOn = selectedAccount === "all";
    const enabled = allOn ? new Set(existingAccounts) : new Set([selectedAccount]);
    const acctHoldings = allOn ? holdings : holdings.filter((h) => h.account === selectedAccount);
    const liveValue = acctHoldings.reduce((s, h) => s + h.value, 0);
    const acctCash = allOn ? cash : cash.filter((c) => c.account === selectedAccount);
    const liveCash = acctCash.reduce((s, c) => s + c.balance, 0);
    // Seed cost basis for the selected account(s): stored anchor (portfolio_seed),
    // falling back — for any account not seeded yet — to cost basis + cash as of
    // that account's EARLIEST STORED snapshot, never live/current values. Live
    // cash already includes every deposit/withdrawal made since inception, which
    // would double-count them: once baked into the anchor, again minted/redeemed
    // by unitMethodReturn's flow loop — a deposit would then read as a loss and
    // a withdrawal as a gain. Only an account with NO stored history at all (a
    // brand-new account) falls back to live cost basis + cash.
    const seedByAccount = new Map(seeds.map((s) => [s.account, s.seedCostBasis]));
    let seedCostBasis = 0;
    for (const acct of enabled) {
      const seeded = seedByAccount.get(acct);
      if (seeded != null) { seedCostBasis += seeded; continue; }
      const anchor = earliestStoredCapital(snapshots, new Set([acct]), false);
      if (anchor) { seedCostBasis += anchor.costBasis + anchor.cash; continue; }
      const liveCostBasis = acctHoldings.filter((h) => h.account === acct).reduce((s, h) => s + h.costTotal, 0);
      const liveCashAcct = acctCash.filter((c) => c.account === acct).reduce((s, c) => s + c.balance, 0);
      seedCostBasis += liveCostBasis + liveCashAcct;
    }
    if (seedCostBasis <= 0) return null; // no cost basis → fall back to cost-basis unrealized
    const r = unitMethodReturn(snapshots, flows, enabled, allOn, { value: liveValue, cash: liveCash }, seedCostBasis);
    return { pct: r.totalPct, gain: r.totalGain };
  }, [snapshots, flows, seeds, selectedAccount, existingAccounts, holdings, cash]);

  const loadData = useCallback(async () => {
    setView("loading");
    try {
      const [res, cashRes, snapRes] = await Promise.all([
        fetch("/api/holdings"),
        fetch("/api/cash").catch(() => null),
        fetch("/api/snapshots").catch(() => null),
      ]);
      if (!res.ok) throw new Error();
      const { holdings: dbHoldings }: { holdings: DBHolding[] } = await res.json();

      const cashBalances: CashBalance[] = cashRes?.ok
        ? (await cashRes.json()).balances ?? []
        : [];
      setCash(cashBalances);

      if (snapRes?.ok) {
        const snap = await snapRes.json();
        setSnapshots(snap.snapshots ?? []);
        setFlows(snap.flows ?? []);
        setSeeds(snap.seeds ?? []);
      }

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

      // Equities + bond ETFs price via /api/quotes; non-ETF bonds via /api/bonds/marks.
      const priceableTickers = [
        ...new Set(
          dbHoldings
            .filter((h) => h.instrument_type !== "bond" || h.bond_type === "etf")
            .map((h) => h.ticker),
        ),
      ];
      let quotes: Record<string, Quote> = {};
      setQuotesError(false);
      try {
        const qRes = await fetch(`/api/quotes?tickers=${priceableTickers.join(",")}`);
        if (qRes.ok) quotes = (await qRes.json()).quotes ?? {};
        else setQuotesError(true);
      } catch {
        setQuotesError(true);
      }

      // Live sectors from Finnhub — authoritative for equities; bonds are forced to "Fixed Income".
      let sectors: Record<string, string> = {};
      try {
        const sRes = await fetch(`/api/sectors?tickers=${priceableTickers.join(",")}`);
        if (sRes.ok) sectors = (await sRes.json()).sectors ?? {};
      } catch {
        // non-fatal — fall back to "—" in the table
      }

      // Live clean-price marks + fixed-income analytics for non-ETF bonds.
      let marks: Record<string, BondMark> = {};
      if (dbHoldings.some((h) => h.instrument_type === "bond" && h.bond_type !== "etf")) {
        try {
          const mRes = await fetch("/api/bonds/marks");
          if (mRes.ok) marks = (await mRes.json()).marks ?? {};
        } catch {
          // non-fatal — bonds fall back to cost basis below
        }
      }

      const merged: HoldingWithMetrics[] = dbHoldings.map((h) => {
        const isBondRow = h.instrument_type === "bond";
        const isEtfBond = isBondRow && h.bond_type === "etf";
        const q = quotes[h.ticker];
        const mark = isBondRow && !isEtfBond ? marks[h.id] : undefined;
        const currentPrice = mark ? mark.currentPrice : q?.price ?? h.cost_basis;
        return computeMetrics(
          {
            id: h.id,
            ticker: h.ticker,
            name: h.name,
            sector: isBondRow ? "Fixed Income" : sectors[h.ticker] ?? "",
            shares: h.shares,
            costBasis: h.cost_basis,
            currentPrice,
            account: h.account,
            notes: h.notes ?? undefined,
            drip: h.drip ?? false,
            acquiredAt: h.acquired_at,
            instrumentType: (isBondRow ? "bond" : "equity") as InstrumentType,
            bondType: (h.bond_type ?? undefined) as BondType | undefined,
            cusip: h.cusip ?? undefined,
            couponRate: h.coupon_rate ?? undefined,
            couponFreq: h.coupon_freq ?? undefined,
            maturityDate: h.maturity_date ?? undefined,
            issueDate: h.issue_date ?? undefined,
            dayCount: (h.day_count ?? undefined) as DayCount | undefined,
            priceSource: (h.price_source ?? undefined) as BondPriceSource | undefined,
            manualPrice: h.manual_price ?? undefined,
            creditSpreadBps: h.credit_spread_bps ?? undefined,
            bondMetrics: mark,
          },
          isBondRow && !isEtfBond ? 0 : q?.changePct ?? 0,
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

  if (view === "addBond") {
    return (
      <AddBondForm
        existingAccounts={existingAccounts}
        onSaved={() => { setView("ready"); setSubView("bonds"); loadData(); }}
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

  if (view === "deposit") {
    return (
      <DepositForm
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
        <SummaryStrip holdings={holdings} cash={cash} account={selectedAccount} cumReturn={cumReturn} />

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
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-sm hover:bg-accent mr-1"
            >
              Refresh prices
            </button>
            <div className="flex items-center rounded-sm border border-border overflow-hidden mr-2">
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
                onClick={() => setSubView("table")}
                className="text-xs px-2.5 py-1 transition-colors duration-150"
                style={{
                  background: subView === "table" ? "oklch(0.16 0 0)" : "transparent",
                  color: subView === "table" ? "var(--primary)" : "oklch(0.64 0.008 74)",
                }}
              >
                Table
              </button>
              {hasBonds && (
                <button
                  onClick={() => setSubView("bonds")}
                  className="text-xs px-2.5 py-1 transition-colors duration-150"
                  style={{
                    background: subView === "bonds" ? "oklch(0.16 0 0)" : "transparent",
                    color: subView === "bonds" ? "var(--primary)" : "oklch(0.64 0.008 74)",
                  }}
                >
                  Bonds
                </button>
              )}
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
                onClick={() => setSubView("income")}
                className="text-xs px-2.5 py-1 transition-colors duration-150"
                style={{
                  background: subView === "income" ? "oklch(0.16 0 0)" : "transparent",
                  color: subView === "income" ? "var(--primary)" : "oklch(0.64 0.008 74)",
                }}
              >
                Income
              </button>
              <button
                onClick={() => setSubView("reports")}
                className="text-xs px-2.5 py-1 transition-colors duration-150"
                style={{
                  background: subView === "reports" ? "oklch(0.16 0 0)" : "transparent",
                  color: subView === "reports" ? "var(--primary)" : "oklch(0.64 0.008 74)",
                }}
              >
                Reports
              </button>
            </div>
            <button
              onClick={() => setManagingDividends(true)}
              className="text-xs px-3 py-1 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              Manage dividends
            </button>
            <div className="relative">
              <button
                onClick={() => setAddMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={addMenuOpen}
                className="text-xs px-3 py-1 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors inline-flex items-center gap-1"
              >
                Add
                <span aria-hidden className="text-[0.6rem] leading-none">▾</span>
              </button>
              {addMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" aria-hidden onClick={() => setAddMenuOpen(false)} />
                  <div role="menu" className="absolute left-0 mt-1 z-20 min-w-[8rem] rounded-md border border-border bg-card py-1 shadow-lg">
                    <button role="menuitem" onClick={() => { setAddMenuOpen(false); setView("addPosition"); }} className="block w-full text-left text-xs px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">Position</button>
                    <button role="menuitem" onClick={() => { setAddMenuOpen(false); setView("addBond"); }} className="block w-full text-left text-xs px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">Bond</button>
                    <button role="menuitem" onClick={() => { setAddMenuOpen(false); setView("addCash"); }} className="block w-full text-left text-xs px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">Cash</button>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={() => setView("deposit")}
              className="text-xs px-3 py-1 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              Deposit / Withdraw
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
          <PortfolioDeck holdings={holdings} cash={cash} />
        )}
        {subView === "bonds" && <FixedIncomeView holdings={holdings} />}
        {subView === "closed" && <ClosedPositions />}
        {subView === "income" && (
          <DividendHistory bonds={holdings.filter((h) => h.instrumentType === "bond" && h.bondType !== "etf")} />
        )}
        {subView === "reports" && <MonthlyReports account={selectedAccount} />}
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
          holdings={holdings.filter((h) => h.instrumentType !== "bond")}
          account={selectedAccount}
          onSaved={() => { setManagingDividends(false); loadData(); }}
          onCancel={() => setManagingDividends(false)}
        />
      )}
    </div>
  );
}
