"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AccountSidebar } from "./AccountSidebar";
import { SummaryStrip } from "./SummaryStrip";
import { unitMethodReturn, type ReturnSnapshot, type ReturnFlow } from "@/lib/portfolio-return";
import { HoldingsTable } from "./HoldingsTable";
import { PortfolioDeck } from "./PortfolioDeck";
import { AddAccountPanel } from "./AddAccountPanel";
import { AddPositionForm } from "./AddPositionForm";
import { AddBondForm } from "./AddBondForm";
import { AddOptionFlow } from "./AddOptionFlow";
import { AddFutureForm } from "./AddFutureForm";
import { AddCashForm } from "./AddCashForm";
import { DepositForm } from "./DepositForm";
import { ClosePositionModal } from "./ClosePositionModal";
import { DividendManager } from "./DividendManager";
import { ClosedPositions } from "./ClosedPositions";
import { DividendHistory } from "./DividendHistory";
import { FixedIncomeView } from "./FixedIncomeView";
import { DerivativesView } from "./DerivativesView";
import { MonthlyReports } from "./MonthlyReports";
import { WatchlistDeck } from "@/components/watchlist/WatchlistDeck";
import { computeMetrics, isDerivative } from "@/lib/types";
import { type ExtHoursQuote } from "@/lib/ext-hours";
import type { HoldingWithMetrics, Quote, BondMetrics, InstrumentType, BondType, DayCount, BondPriceSource, OptionType, Direction } from "@/lib/types";

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
  underlying: string | null;
  expiry: string | null;
  strike: number | null;
  option_type: string | null;
  multiplier: number | null;
  direction: string | null;
  combo_id: string | null;
}

type BondMark = BondMetrics & { currentPrice: number };
type DerivativeMark = { currentPrice: number; iv?: number; spot?: number };

type ViewState = "loading" | "empty" | "addAccount" | "addPosition" | "addBond" | "addOption" | "addFuture" | "addCash" | "deposit" | "ready";

/** How often live quotes are re-pulled. Matches the 60s TTL on the quote cache
 *  in lib/finnhub.ts, so polling faster would only ever return the same marks. */
const QUOTE_REFRESH_MS = 60_000;

/** Priced by /api/quotes — equities and ETF-wrapped bonds. Non-ETF bonds mark
 *  via /api/bonds/marks and options/futures via /api/holdings/derivatives-marks
 *  (their "ticker" is a constructed label, not a quotable symbol). */
const pricesViaQuotes = (h: HoldingWithMetrics) =>
  !isDerivative(h) && (h.instrumentType !== "bond" || h.bondType === "etf");

interface CashBalance {
  account: string;
  label: string;
  balance: number;
}

export function PortfolioClient() {
  const [view, setView] = useState<ViewState>("loading");
  const [subView, setSubView] = useState<"table" | "heatmap" | "bonds" | "derivatives" | "closed" | "income" | "reports" | "watchlist">("heatmap");
  const [holdings, setHoldings] = useState<HoldingWithMetrics[]>([]);
  const [cash, setCash] = useState<CashBalance[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [quotesError, setQuotesError] = useState(false);
  /* Extended-hours quotes by ticker, kept BESIDE the holdings on purpose. Folding
     them into a holding would put an after-hours mark within reach of
     `currentPrice`, and /api/snapshots/cron runs at 6pm ET — inside the
     post-market window — so that would corrupt the stored history. */
  const [extQuotes, setExtQuotes] = useState<Record<string, ExtHoursQuote>>({});
  const [closingHolding, setClosingHolding] = useState<HoldingWithMetrics | null>(null);
  const [managingDividends, setManagingDividends] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<ReturnSnapshot[]>([]);
  const [flows, setFlows] = useState<ReturnFlow[]>([]);
  const [seeds, setSeeds] = useState<{ account: string; seedCostBasis: number; basePrice: number }[]>([]);
  /* Accounts the user has declared (a row in account_meta). Includes accounts
     created without a CSV, which have no holdings and no cash yet — they'd be
     invisible if accounts were only ever derived from holdings/cash. */
  const [declaredAccounts, setDeclaredAccounts] = useState<string[]>([]);

  const existingAccounts = useMemo(
    () => [...new Set([...holdings.map((h) => h.account), ...cash.map((c) => c.account), ...declaredAccounts])].sort(),
    [holdings, cash, declaredAccounts]
  );

  const cashByAccount = useMemo(() => {
    const m: Record<string, { label: string; balance: number }> = {};
    for (const c of cash) m[c.account] = { label: c.label, balance: c.balance };
    return m;
  }, [cash]);

  /* ── The selected scope ──
     "All Accounts" = every account combined; an individual account = ONLY that
     account's assets. Filtering happens exactly ONCE here and every panel below
     the sidebar renders off these lists, so the hero, heatmap, table, bonds,
     derivatives, income and closed views can never disagree about what's in
     view. The sidebar itself still gets the FULL lists — it has to show every
     account and its total regardless of what's selected. */
  const scopedHoldings = useMemo(
    () => (selectedAccount === "all" ? holdings : holdings.filter((h) => h.account === selectedAccount)),
    [holdings, selectedAccount],
  );
  const scopedCash = useMemo(
    () => (selectedAccount === "all" ? cash : cash.filter((c) => c.account === selectedAccount)),
    [cash, selectedAccount],
  );

  /* Which asset-class tabs exist is a property of the SELECTED account, not of
     the whole portfolio — an account holding no bonds shouldn't offer a Bonds
     tab. `activeSubView` keeps the panel and the tab strip in agreement when a
     tab disappears out from under the current selection. */
  const hasBonds = useMemo(() => scopedHoldings.some((h) => h.instrumentType === "bond"), [scopedHoldings]);
  const hasDerivatives = useMemo(() => scopedHoldings.some(isDerivative), [scopedHoldings]);
  const activeSubView =
    (subView === "bonds" && !hasBonds) || (subView === "derivatives" && !hasDerivatives) ? "heatmap" : subView;

  /* Cumulative time-weighted return for the selected account (or all), computed
     the same way as the dashboard hero so the two agree. null until snapshots
     load / when there isn't enough history. */
  const cumReturn = useMemo(() => {
    const allOn = selectedAccount === "all";
    const enabled = allOn ? new Set(existingAccounts) : new Set([selectedAccount]);
    const acctHoldings = scopedHoldings;
    const liveValue = acctHoldings.reduce((s, h) => s + h.value, 0);
    const acctCash = scopedCash;
    const liveCash = acctCash.reduce((s, c) => s + c.balance, 0);
    /* Seed resolution lives in lib/portfolio-return.ts `resolveSeedCapital` —
       ONE definition shared with the dashboard hero, the monthly reports and
       the annual summary, so the four can't drift on what "contributed capital"
       means. It needs the NAV series to know which accounts predate it, and
       `unitMethodReturn` builds that series itself, so we hand it the sources
       (stored anchors + a live-capital fallback) rather than a finished number. */
    const seedByAccount = new Map(seeds.map((s) => [s.account, s.seedCostBasis]));
    const liveCapital = (acct: string) =>
      acctHoldings.filter((h) => h.account === acct).reduce((s, h) => s + h.costTotal, 0) +
      acctCash.filter((c) => c.account === acct).reduce((s, c) => s + c.balance, 0);
    const r = unitMethodReturn(snapshots, flows, enabled, allOn, { value: liveValue, cash: liveCash }, {
      storedSeeds: seedByAccount,
      liveCapital,
    });
    if (r.seedCostBasis <= 0) return null; // no capital anchor → cost-basis unrealized
    return { pct: r.totalPct, gain: r.totalGain };
  }, [snapshots, flows, seeds, selectedAccount, existingAccounts, scopedHoldings, scopedCash]);

  const loadData = useCallback(async () => {
    setView("loading");
    try {
      const [res, cashRes, snapRes, metaRes] = await Promise.all([
        fetch("/api/holdings"),
        fetch("/api/cash").catch(() => null),
        fetch("/api/snapshots").catch(() => null),
        fetch("/api/accounts/meta").catch(() => null),
      ]);
      if (!res.ok) throw new Error();
      const { holdings: dbHoldings }: { holdings: DBHolding[] } = await res.json();

      const cashBalances: CashBalance[] = cashRes?.ok
        ? (await cashRes.json()).balances ?? []
        : [];
      setCash(cashBalances);

      const declared: string[] = metaRes?.ok
        ? (await metaRes.json()).accounts ?? []
        : [];
      setDeclaredAccounts(declared);

      if (snapRes?.ok) {
        const snap = await snapRes.json();
        setSnapshots(snap.snapshots ?? []);
        setFlows(snap.flows ?? []);
        setSeeds(snap.seeds ?? []);
      }

      // Truly empty only when there's nothing at all — a declared account with
      // no holdings/cash still gets the dashboard, so it can be filled in.
      if ((!dbHoldings || dbHoldings.length === 0) && cashBalances.length === 0 && declared.length === 0) {
        setView("empty");
        return;
      }
      if (!dbHoldings || dbHoldings.length === 0) {
        // No priceable holdings (cash-only, or a freshly created empty account).
        setHoldings([]);
        setLastRefreshed(new Date());
        setView("ready");
        return;
      }

      // Equities + bond ETFs price via /api/quotes; non-ETF bonds via
      // /api/bonds/marks; options/futures via /api/holdings/derivatives-marks
      // (their "ticker" is a constructed label, not a real quote symbol).
      const priceableTickers = [
        ...new Set(
          dbHoldings
            .filter((h) => h.instrument_type !== "bond" || h.bond_type === "etf")
            .filter((h) => h.instrument_type !== "option" && h.instrument_type !== "future")
            .map((h) => h.ticker),
        ),
      ];
      let quotes: Record<string, Quote> = {};
      setQuotesError(false);
      try {
        const qRes = await fetch(`/api/quotes?tickers=${priceableTickers.join(",")}`);
        if (qRes.ok) {
          quotes = (await qRes.json()).quotes ?? {};
          setExtQuotes(quotes);
        } else setQuotesError(true);
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

      // Live per-unit marks for options/futures.
      let derivativeMarks: Record<string, DerivativeMark> = {};
      if (dbHoldings.some((h) => h.instrument_type === "option" || h.instrument_type === "future")) {
        try {
          const dRes = await fetch("/api/holdings/derivatives-marks");
          if (dRes.ok) derivativeMarks = (await dRes.json()).marks ?? {};
        } catch {
          // non-fatal — derivatives fall back to cost basis below
        }
      }

      const merged: HoldingWithMetrics[] = dbHoldings.map((h) => {
        const isBondRow = h.instrument_type === "bond";
        const isEtfBond = isBondRow && h.bond_type === "etf";
        const isDerivativeRow = h.instrument_type === "option" || h.instrument_type === "future";
        const q = quotes[h.ticker];
        const mark = isBondRow && !isEtfBond ? marks[h.id] : undefined;
        const dMark = isDerivativeRow ? derivativeMarks[h.id] : undefined;
        const currentPrice = mark ? mark.currentPrice : dMark ? dMark.currentPrice : q?.price ?? h.cost_basis;
        return computeMetrics(
          {
            id: h.id,
            ticker: h.ticker,
            name: h.name,
            sector: isDerivativeRow ? "Derivatives" : isBondRow ? "Fixed Income" : sectors[h.ticker] ?? "",
            shares: h.shares,
            costBasis: h.cost_basis,
            currentPrice,
            account: h.account,
            notes: h.notes ?? undefined,
            drip: h.drip ?? false,
            acquiredAt: h.acquired_at,
            instrumentType: (h.instrument_type ?? "equity") as InstrumentType,
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
            underlying: h.underlying ?? undefined,
            expiry: h.expiry ?? undefined,
            strike: h.strike ?? undefined,
            optionType: (h.option_type ?? undefined) as OptionType | undefined,
            multiplier: h.multiplier ?? undefined,
            direction: (h.direction ?? undefined) as Direction | undefined,
            comboId: h.combo_id ?? undefined,
            iv: dMark?.iv,
            underlyingSpot: dMark?.spot,
          },
          (isBondRow && !isEtfBond) || isDerivativeRow ? 0 : q?.changePct ?? 0,
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

  /* ── Live re-pricing, every minute ──
     The sidebar's per-account day change is only as fresh as the quotes behind
     it, so equities/ETFs are re-marked on an interval. This is deliberately NOT
     `loadData()`: that flips the whole page to "loading" and re-reads holdings,
     cash, snapshots and sectors, none of which move minute to minute. Only the
     quote leg is refetched and folded into the existing rows, so the table,
     heatmap, hero and sidebar all re-price together without a visible reload.
     Non-ETF bonds and derivatives are skipped — they mark from different
     endpoints and carry no intraday change here.
     `holdingsRef` keeps the poll off the `holdings` dependency, so the interval
     isn't torn down and restarted by its own updates. */
  const holdingsRef = useRef<HoldingWithMetrics[]>([]);
  useEffect(() => { holdingsRef.current = holdings; }, [holdings]);

  const refreshQuotes = useCallback(async () => {
    const tickers = [...new Set(holdingsRef.current.filter(pricesViaQuotes).map((h) => h.ticker))];
    if (tickers.length === 0) return;
    try {
      const res = await fetch(`/api/quotes?tickers=${tickers.join(",")}`);
      if (!res.ok) { setQuotesError(true); return; }
      const quotes: Record<string, Quote> = (await res.json()).quotes ?? {};
      setQuotesError(false);
      setExtQuotes(quotes);
      setHoldings((prev) =>
        prev.map((h) => {
          if (!pricesViaQuotes(h)) return h;
          const q = quotes[h.ticker];
          // No quote back for this ticker → keep the last good mark rather than
          // dropping the row to cost basis.
          if (!q || !Number.isFinite(q.price) || q.price <= 0) return h;
          return computeMetrics({ ...h, currentPrice: q.price }, q.changePct ?? 0);
        }),
      );
      setLastRefreshed(new Date());
    } catch {
      setQuotesError(true);
    }
  }, []);

  useEffect(() => {
    if (view !== "ready") return;
    const tick = () => {
      // Don't poll a tab nobody is looking at; refresh on the way back instead.
      if (document.visibilityState === "visible") refreshQuotes();
    };
    const id = setInterval(tick, QUOTE_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") refreshQuotes(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [view, refreshQuotes]);

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
      // Also drop the declaration, or the account would come back at $0.
      fetch("/api/accounts/meta", {
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
      <AddAccountPanel
        onSaved={() => loadData()}
      />
    );
  }

  if (view === "addAccount") {
    return (
      <AddAccountPanel
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

  if (view === "addOption") {
    return (
      <AddOptionFlow
        existingAccounts={existingAccounts}
        onSaved={() => { setView("ready"); setSubView("derivatives"); loadData(); }}
        onCancel={() => setView("ready")}
      />
    );
  }

  if (view === "addFuture") {
    return (
      <AddFutureForm
        existingAccounts={existingAccounts}
        onSaved={() => { setView("ready"); setSubView("derivatives"); loadData(); }}
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
        extraAccounts={declaredAccounts}
        selected={selectedAccount}
        onSelect={setSelectedAccount}
        onRemoveAccount={handleRemoveAccount}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        <SummaryStrip holdings={scopedHoldings} cash={scopedCash} account={selectedAccount} cumReturn={cumReturn} ext={extQuotes} />

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
                  background: activeSubView === "heatmap" ? "oklch(0.16 0 0)" : "transparent",
                  color: activeSubView === "heatmap" ? "var(--primary)" : "oklch(0.64 0.008 74)",
                }}
              >
                Heatmap
              </button>
              <button
                onClick={() => setSubView("table")}
                className="text-xs px-2.5 py-1 transition-colors duration-150"
                style={{
                  background: activeSubView === "table" ? "oklch(0.16 0 0)" : "transparent",
                  color: activeSubView === "table" ? "var(--primary)" : "oklch(0.64 0.008 74)",
                }}
              >
                Table
              </button>
              {hasBonds && (
                <button
                  onClick={() => setSubView("bonds")}
                  className="text-xs px-2.5 py-1 transition-colors duration-150"
                  style={{
                    background: activeSubView === "bonds" ? "oklch(0.16 0 0)" : "transparent",
                    color: activeSubView === "bonds" ? "var(--primary)" : "oklch(0.64 0.008 74)",
                  }}
                >
                  Bonds
                </button>
              )}
              {hasDerivatives && (
                <button
                  onClick={() => setSubView("derivatives")}
                  className="text-xs px-2.5 py-1 transition-colors duration-150"
                  style={{
                    background: activeSubView === "derivatives" ? "oklch(0.16 0 0)" : "transparent",
                    color: activeSubView === "derivatives" ? "var(--primary)" : "oklch(0.64 0.008 74)",
                  }}
                >
                  Options/Futures
                </button>
              )}
              <button
                onClick={() => setSubView("closed")}
                className="text-xs px-2.5 py-1 transition-colors duration-150"
                style={{
                  background: activeSubView === "closed" ? "oklch(0.16 0 0)" : "transparent",
                  color: activeSubView === "closed" ? "var(--primary)" : "oklch(0.64 0.008 74)",
                }}
              >
                Closed
              </button>
              <button
                onClick={() => setSubView("income")}
                className="text-xs px-2.5 py-1 transition-colors duration-150"
                style={{
                  background: activeSubView === "income" ? "oklch(0.16 0 0)" : "transparent",
                  color: activeSubView === "income" ? "var(--primary)" : "oklch(0.64 0.008 74)",
                }}
              >
                Income
              </button>
              <button
                onClick={() => setSubView("reports")}
                className="text-xs px-2.5 py-1 transition-colors duration-150"
                style={{
                  background: activeSubView === "reports" ? "oklch(0.16 0 0)" : "transparent",
                  color: activeSubView === "reports" ? "var(--primary)" : "oklch(0.64 0.008 74)",
                }}
              >
                Reports
              </button>
              <button
                onClick={() => setSubView("watchlist")}
                className="text-xs px-2.5 py-1 transition-colors duration-150"
                style={{
                  background: activeSubView === "watchlist" ? "oklch(0.16 0 0)" : "transparent",
                  color: activeSubView === "watchlist" ? "var(--primary)" : "oklch(0.64 0.008 74)",
                }}
              >
                Watchlist
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
                    <button role="menuitem" onClick={() => { setAddMenuOpen(false); setView("addOption"); }} className="block w-full text-left text-xs px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">Option</button>
                    <button role="menuitem" onClick={() => { setAddMenuOpen(false); setView("addFuture"); }} className="block w-full text-left text-xs px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">Future</button>
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
              onClick={() => setView("addAccount")}
              className="text-xs px-3 py-1 rounded-sm"
              style={{ background: "oklch(0.72 0.14 74)", color: "oklch(0.08 0 0)" }}
            >
              Add Account
            </button>
          </div>
        </div>

        {activeSubView === "table" && (
          <HoldingsTable
            holdings={scopedHoldings.filter((h) => !isDerivative(h))}
            cash={scopedCash}
            account={selectedAccount}
            ext={extQuotes}
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
        {activeSubView === "heatmap" && (
          // Options join the heatmap (sized by |value|, like bonds get tiles);
          // futures stay out — their market value is notional exposure and
          // would dwarf every equity tile.
          <PortfolioDeck
            holdings={scopedHoldings.filter((h) => !isDerivative(h) || h.instrumentType === "option")}
            cash={scopedCash}
            account={selectedAccount}
            ext={extQuotes}
          />
        )}
        {activeSubView === "bonds" && (
          <FixedIncomeView
            holdings={scopedHoldings}
            onEdit={async (holding, updates) => {
              const res = await fetch("/api/holdings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: holding.id, ...updates }),
              });
              if (!res.ok) throw new Error((await res.json()).error);
              loadData();
            }}
          />
        )}
        {activeSubView === "derivatives" && (
          <DerivativesView holdings={scopedHoldings} onClose={(holding) => setClosingHolding(holding)} />
        )}
        {activeSubView === "closed" && <ClosedPositions account={selectedAccount} />}
        {activeSubView === "income" && (
          <DividendHistory
            bonds={scopedHoldings.filter((h) => h.instrumentType === "bond" && h.bondType !== "etf")}
            account={selectedAccount}
          />
        )}
        {activeSubView === "reports" && <MonthlyReports account={selectedAccount} />}
        {activeSubView === "watchlist" && <WatchlistDeck />}
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
          holdings={holdings.filter((h) => h.instrumentType !== "bond" && !isDerivative(h))}
          account={selectedAccount}
          onSaved={() => { setManagingDividends(false); loadData(); }}
          onCancel={() => setManagingDividends(false)}
        />
      )}
    </div>
  );
}
