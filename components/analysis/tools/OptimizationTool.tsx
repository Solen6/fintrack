"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatPercent } from "@/lib/format";
import type {
  AnalysisBasketResponse,
  AnalysisPosition,
  AnalysisPositionsResponse,
} from "@/lib/analytics/api-types";
import {
  annualizedMeanReturn,
  annualizedVol,
  covarianceMatrix,
  annualizeCov,
  longOnlyFrontier,
  portfolioMetrics,
  randomCloud,
  mulberry32,
  weightVector,
  missingTickers,
} from "@/lib/analytics";
import {
  ToolShell,
  Panel,
  Stat,
  StatRow,
  LoadingBlock,
  ErrorBlock,
  EmptyBlock,
  MethodologyNote,
  MiniButton,
} from "../ui";
import { MixEditor } from "../MixEditor";
import {
  fetchRebalanceTargetAccounts,
  planWeightLoad,
  overflowMessage,
  type AccountTargets,
} from "../weight-sources";
import { useAnalysisData } from "../useAnalysisData";
import { ScatterPlot, CHART, type ScatterPoint } from "../charts";
import { BasketBuilder, BASKET_MAX, type BasketItem } from "../BasketBuilder";

const RF = 0.043; // ~1y T-bill
const VIOLET = "oklch(0.62 0.13 300)";
const TEAL = "oklch(0.72 0.09 190)";
/* Two hues left free by the existing chart palette (amber 74 / steel 240 /
   green 152 / teal 190 / violet 300 / red 25), so plotted portfolios read as
   their own family without colliding with anything already on the chart. */
const ROSE = "oklch(0.72 0.12 340)";   // the S&P 500 benchmark point
const PERI = "oklch(0.68 0.12 275)";   // your saved portfolios
const LIME = "oklch(0.74 0.12 110)";   // your portfolio in past years
/** Toggle id for the benchmark point (shares the `shown` set with saved ids). */
const SPY_ID = "sp500";
/** History window options. 1Y is the default: risk and Sharpe over a longer
    window average in older, more volatile regimes, which reads as a worse
    portfolio than the last twelve months actually were. */
const WINDOWS: { label: string; days: number }[] = [
  { label: "1Y", days: 365 },
  { label: "2Y", days: 730 },
  { label: "3Y", days: 1095 },
  { label: "5Y", days: 1825 },
];
const DEFAULT_WINDOW = 365;
/** λ-sweep resolution. Higher than the 40 it started at so the curve is smooth
    enough to hover and pin individual points; ~50ms even at a 60-name basket. */
const FRONTIER_POINTS = 60;
/** Weight rows shown before the "show all" toggle. */
const VISIBLE_ROWS = 15;

type Target = "sharpe" | "minvar";
/** A pinned frontier point, tied to the basket it came from so a basket edit
    can't leave the pin pointing at a different portfolio. */
interface Pin {
  sig: string;
  idx: number;
}

export interface SavedPortfolio {
  id: string;
  name: string;
  /** Ticker -> percent. Not necessarily summing to 100; normalized at plot time. */
  weights: Record<string, number>;
}

/** A yearly capture of the user's actual portfolio composition. */
export interface FrontierSnapshot {
  id: string;
  takenOn: string;
  weights: Record<string, number>;
  totalValue: number | null;
}

/** A snapshot resolved onto the chart, priced over the CURRENT window. */
export interface PlotSnapshot extends FrontierSnapshot {
  metrics: ReturnType<typeof portfolioMetrics> | null;
  missing: string[];
  label: string;
}

/** A saved portfolio resolved onto the chart. `metrics` is null when none of
    its tickers could be priced over the window. */
export interface PlotPortfolio {
  id: string;
  name: string;
  weights: Record<string, number>;
  metrics: ReturnType<typeof portfolioMetrics> | null;
  /** Referenced tickers that couldn't be priced — weight was redistributed. */
  missing: string[];
}

export function OptimizationTool() {
  const [items, setItems] = useState<BasketItem[]>([]);
  /** User-editable mix, ticker -> percent of the basket. */
  const [weightPct, setWeightPct] = useState<Record<string, number>>({});
  /** What autofill last read off the real account, for "Reset to actual". */
  const [actualPct, setActualPct] = useState<Record<string, number>>({});
  const [cash, setCash] = useState(0);
  const [riskyValue, setRiskyValue] = useState(0);
  const [autofilling, setAutofilling] = useState(false);
  const [autofillError, setAutofillError] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>("sharpe");
  const [pin, setPin] = useState<Pin | null>(null);
  const [saved, setSaved] = useState<SavedPortfolio[]>([]);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mixNote, setMixNote] = useState<string | null>(null);
  /** Non-null only while waiting for the user to say which account's targets. */
  const [rebalanceAccounts, setRebalanceAccounts] = useState<AccountTargets[] | null>(null);
  /** What's drawn on the chart: benchmark + saved-portfolio + snapshot ids. */
  const [shown, setShown] = useState<Set<string>>(new Set([SPY_ID]));
  const [days, setDays] = useState(DEFAULT_WINDOW);
  const [snapshots, setSnapshots] = useState<FrontierSnapshot[]>([]);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  /** Snapshot whose holdings are open below the chart. */
  const [inspected, setInspected] = useState<string | null>(null);
  const didInit = useRef(false);

  const autofill = useCallback(async () => {
    setAutofilling(true);
    setAutofillError(null);
    try {
      const r = await fetch("/api/analysis/positions");
      const j = (await r.json()) as AnalysisPositionsResponse & { error?: string };
      if (!r.ok) throw new Error(j.error || "Failed to load positions");
      const positions = (j.positions ?? []) as AnalysisPosition[];
      if (positions.length === 0) {
        setAutofillError("No priceable equity or ETF positions to autofill.");
        return;
      }
      // Positions arrive value-sorted, so capping keeps the largest holdings.
      // Without this the basket route would silently drop the overflow.
      const kept = positions.slice(0, BASKET_MAX);
      if (kept.length < positions.length) {
        setAutofillError(
          `Loaded your ${kept.length} largest positions — ${positions.length - kept.length} more didn't fit the ${BASKET_MAX}-ticker limit.`,
        );
      }
      setItems(kept.map((p) => ({ ticker: p.ticker, fromPortfolio: true })));
      // Seed the editable mix with the real weights, as percentages.
      const w: Record<string, number> = {};
      for (const p of kept) w[p.ticker] = p.weight * 100;
      setWeightPct(w);
      setActualPct(w);
      setCash(j.cash ?? 0);
      setRiskyValue(j.riskyValue ?? 0);
    } catch (e) {
      setAutofillError(e instanceof Error ? e.message : "Failed to load positions");
    } finally {
      setAutofilling(false);
    }
  }, []);

  const loadSaved = useCallback(async () => {
    try {
      const r = await fetch("/api/analysis/portfolios");
      const j = (await r.json()) as { portfolios?: SavedPortfolio[]; error?: string };
      if (!r.ok) throw new Error(j.error || "Failed to load saved portfolios");
      setSaved(j.portfolios ?? []);
      setSavedError(null);
    } catch (e) {
      setSavedError(e instanceof Error ? e.message : "Failed to load saved portfolios");
    }
  }, []);

  /* Ask the server to capture a yearly snapshot. It writes one only when the
     newest is 365+ days old, so calling this on every load is safe — and it
     returns the full list either way, so this doubles as the fetch. */
  const loadSnapshots = useCallback(async () => {
    try {
      const r = await fetch("/api/analysis/portfolio-snapshots", { method: "POST" });
      const j = (await r.json()) as { snapshots?: FrontierSnapshot[]; error?: string };
      if (!r.ok) throw new Error(j.error || "Failed to load portfolio snapshots");
      const list = j.snapshots ?? [];
      setSnapshots(list);
      // Past years are the point of the feature — show them by default.
      setShown((prev) => {
        const next = new Set(prev);
        for (const s of list) next.add(s.id);
        return next;
      });
      setSnapshotError(null);
    } catch (e) {
      setSnapshotError(e instanceof Error ? e.message : "Failed to load portfolio snapshots");
    }
  }, []);

  // Open pre-loaded with the user's portfolio (still ticker-history-driven).
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    autofill();
    loadSaved();
    loadSnapshots();
  }, [autofill, loadSaved, loadSnapshots]);

  const tickers = items.map((i) => i.ticker);
  // Price every ticker any portfolio could need, whether or not it's currently
  // shown — that keeps toggling a portfolio on/off instant instead of firing a
  // refetch. The route caps and reports anything it can't take.
  const extra = useMemo(() => {
    const inBasket = new Set(tickers);
    const wanted = new Set<string>();
    for (const p of saved) for (const t of Object.keys(p.weights)) wanted.add(t);
    // Names a past portfolio held that you no longer do still need pricing.
    for (const s of snapshots) for (const t of Object.keys(s.weights)) wanted.add(t);
    return [...wanted].filter((t) => !inBasket.has(t)).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join(","), saved, snapshots]);

  const url =
    tickers.length >= 1
      ? `/api/analysis/basket?tickers=${tickers.join(",")}` +
        (extra.length ? `&extra=${extra.join(",")}` : "") +
        `&days=${days}`
      : null;
  const { data, loading, error, retry } = useAnalysisData<AnalysisBasketResponse>(url);

  const model = useMemo(() => {
    if (!data || data.empty) return null;
    const included = items.filter((i) => data.returns[i.ticker]?.length);
    if (included.length < 2) return null;

    const matrix = included.map((i) => data.returns[i.ticker]);
    const mu = included.map((i) => annualizedMeanReturn(data.returns[i.ticker]));
    const sigma = annualizeCov(covarianceMatrix(matrix));

    // "Your mix" — the editable weight vector, normalized over the basket.
    const rawW = included.map((i) => Math.max(0, weightPct[i.ticker] ?? 0));
    const enteredSum = rawW.reduce((s, x) => s + x, 0);
    const hasPortfolio = enteredSum > 1e-9;
    const refWeights = hasPortfolio
      ? rawW.map((w) => w / enteredSum)
      : included.map(() => 1 / included.length);
    const hasActual = Object.keys(actualPct).length > 0;

    const current = portfolioMetrics(mu, sigma, refWeights, RF);
    const augFrontier = longOnlyFrontier(mu, sigma, RF, FRONTIER_POINTS);
    const cloud = randomCloud(mu, sigma, 400, mulberry32(20240501), RF);

    // Base frontier over portfolio-only tickers, to show the before/after.
    const pfIncluded = included.filter((i) => i.fromPortfolio);
    let baseFrontier: ReturnType<typeof longOnlyFrontier> | null = null;
    if (pfIncluded.length >= 2) {
      const pmatrix = pfIncluded.map((i) => data.returns[i.ticker]);
      const pmu = pfIncluded.map((i) => annualizedMeanReturn(data.returns[i.ticker]));
      const psigma = annualizeCov(covarianceMatrix(pmatrix));
      baseFrontier = longOnlyFrontier(pmu, psigma, RF, FRONTIER_POINTS);
    }
    const hasCand = included.some((i) => !i.fromPortfolio) && baseFrontier !== null;

    const candPoints = included
      .filter((i) => !i.fromPortfolio)
      .map((i) => ({
        ticker: i.ticker,
        ret: annualizedMeanReturn(data.returns[i.ticker]),
        vol: annualizedVol(data.returns[i.ticker]),
      }));

    const tangency = augFrontier.maxSharpe;
    const cmlSlope = tangency.vol > 0 ? (tangency.ret - RF) / tangency.vol : 0;
    const sameRiskUpside =
      hasPortfolio && current.vol > 0 && current.vol <= tangency.vol
        ? RF + cmlSlope * current.vol - current.ret
        : null;
    const totalVal = riskyValue + cash;
    const cashWeight = totalVal > 0 ? cash / totalVal : 0;
    const riskyFrac = totalVal > 0 ? riskyValue / totalVal : 1;
    const showCash = hasPortfolio && cash > 0 && riskyValue > 0;
    const currentInclCash = {
      vol: riskyFrac * current.vol,
      ret: riskyFrac * current.ret + (1 - riskyFrac) * RF,
    };

    /* ─── Plotted portfolios ───
       Priced off a WIDER covariance than the frontier: the basket plus the
       reference-only tickers, so a portfolio can hold names you don't own.
       The frontier itself still optimizes over the basket alone. */
    const refd = (data.referenced ?? []).filter((t) => data.returns[t]?.length);
    const allTickers = [...included.map((i) => i.ticker), ...refd];
    const pricedSet = new Set(allTickers);
    const allMu = allTickers.map((t) => annualizedMeanReturn(data.returns[t]));
    const allSigma = annualizeCov(covarianceMatrix(allTickers.map((t) => data.returns[t])));

    const plotted: PlotPortfolio[] = saved
      .map((p) => ({ id: p.id, name: p.name, weights: p.weights }))
      .filter((p) => shown.has(p.id))
      .map((p) => {
        const wv = weightVector(p.weights, allTickers);
        return {
          ...p,
          // weightVector drops unpriceable names and renormalizes, so the point
          // still plots — `missing` is what makes that visible rather than silent.
          missing: missingTickers(p.weights, pricedSet),
          metrics: wv ? portfolioMetrics(allMu, allSigma, wv, RF) : null,
        };
      });

    /* Yearly snapshots of the real portfolio, priced over the CURRENT window —
       i.e. "how would the mix I held then look on today's data?". That's what
       makes them comparable to your current mix and to the frontier; it is NOT
       the return they actually realized during that year. */
    const plotSnapshots: PlotSnapshot[] = snapshots
      .filter((s) => shown.has(s.id))
      .map((s) => {
        const wv = weightVector(s.weights, allTickers);
        return {
          ...s,
          label: s.takenOn.slice(0, 4),
          missing: missingTickers(s.weights, pricedSet),
          metrics: wv ? portfolioMetrics(allMu, allSigma, wv, RF) : null,
        };
      });

    /* The S&P 500 reference point. The basket route already fetches SPY as the
       benchmark over this exact window (and adjusted, so it's total return), so
       this needs no extra request — and it's measured the same way as every
       other point: arithmetic mean × 252 for return, stdev × √252 for vol. */
    const spyReturns = data.benchmark?.returns ?? [];
    const spy =
      spyReturns.length > 1
        ? (() => {
            const ret = annualizedMeanReturn(spyReturns);
            const vol = annualizedVol(spyReturns);
            return { ret, vol, sharpe: vol > 0 ? (ret - RF) / vol : 0 };
          })()
        : null;
    const showSpy = shown.has(SPY_ID) && spy !== null;

    // Window transparency.
    const bindingStart = included
      .map((i) => data.starts[i.ticker] ?? "")
      .reduce((a, b) => (b > a ? b : a), "");
    const bindingTicker = included.find((i) => (data.starts[i.ticker] ?? "") === bindingStart)?.ticker ?? "";

    return {
      sig: included.map((i) => i.ticker).join(","),
      included,
      refWeights,
      hasPortfolio,
      hasActual,
      enteredSum,
      plotted,
      plotSnapshots,
      allTickers,
      spy,
      showSpy,
      current,
      augFrontier,
      baseFrontier,
      hasCand,
      cloud,
      candPoints,
      tangency,
      sameRiskUpside,
      cashWeight,
      showCash,
      currentInclCash,
      windowDays: data.windowDays,
      // Trading days the chosen window should yield, for the "short window"
      // check — a fixed 252 threshold would false-alarm on every 1Y window.
      expectedDays: Math.round((days * 252) / 365),
      windowStart: data.windowStart,
      bindingTicker,
      bindingStart,
      years: (data.dates.length / 252).toFixed(1),
    };
  }, [data, items, weightPct, actualPct, cash, riskyValue, saved, snapshots, shown, days]);

  // A pin only survives while the basket it was taken from is unchanged.
  const pinned =
    model && pin && pin.sig === model.sig ? model.augFrontier.frontier[pin.idx] ?? null : null;
  const selected = model
    ? pinned ?? (target === "sharpe" ? model.augFrontier.maxSharpe : model.augFrontier.gmv)
    : null;
  const refetching = loading && !!model;

  const add = (t: string) => setItems((prev) => (prev.some((i) => i.ticker === t) ? prev : [...prev, { ticker: t, fromPortfolio: false }]));
  const remove = (t: string) => {
    setItems((prev) => prev.filter((i) => i.ticker !== t));
    setWeightPct((prev) => {
      if (!(t in prev)) return prev;
      const next = { ...prev };
      delete next[t];
      return next;
    });
  };
  const clear = () => {
    setItems([]);
    setWeightPct({});
    setActualPct({});
    setCash(0);
    setRiskyValue(0);
    setAutofillError(null);
    setPin(null);
  };

  /* ─── Editable mix ─── */
  const setWeight = (ticker: string, pct: number) =>
    setWeightPct((prev) => ({ ...prev, [ticker]: Math.max(0, pct) }));
  const loadCurrent = () => {
    setWeightPct(actualPct);
    setMixNote(null);
  };
  /* Rebalance targets are percentages of ONE account, so loading them means
     naming the account. One account with targets loads straight through; more
     than one raises a picker rather than combining them, which would need
     account values this tool never fetches. */
  const applyRebalance = (account: string, targets: Record<string, number>) => {
    const plan = planWeightLoad(targets, items.map((i) => i.ticker), BASKET_MAX);
    if (plan.empty) {
      setMixNote(`No targets saved for ${account}.`);
      return;
    }
    setItems((prev) => [...prev, ...plan.toAdd.map((t) => ({ ticker: t, fromPortfolio: false }))]);
    setWeightPct(plan.weights);
    setPin(null);
    setMixNote(
      overflowMessage(plan, BASKET_MAX) ??
        `Loaded ${account} targets — percentages of that account, normalized to 100% here.`,
    );
  };

  const loadRebalance = async () => {
    setBusy(true);
    setRebalanceAccounts(null);
    try {
      const accounts = await fetchRebalanceTargetAccounts();
      if (accounts.length === 0) {
        setMixNote("No rebalance targets saved yet — set them in the Rebalancer tool first.");
        return;
      }
      if (accounts.length === 1) {
        applyRebalance(accounts[0].account, accounts[0].targets);
        return;
      }
      setRebalanceAccounts(accounts);
      setMixNote(null);
    } catch (e) {
      setMixNote(e instanceof Error ? e.message : "Failed to load rebalance targets");
    } finally {
      setBusy(false);
    }
  };

  const pickRebalance = (account: string) => {
    const hit = rebalanceAccounts?.find((a) => a.account === account);
    setRebalanceAccounts(null);
    if (hit) applyRebalance(hit.account, hit.targets);
  };
  const equalWeight = () => {
    const each = items.length > 0 ? 100 / items.length : 0;
    setWeightPct(Object.fromEntries(items.map((i) => [i.ticker, each])));
    setMixNote(null);
  };
  /** Rescale the entered weights so they sum to exactly 100. */
  const normalizeWeights = () => {
    const sum = items.reduce((s, i) => s + Math.max(0, weightPct[i.ticker] ?? 0), 0);
    if (sum <= 1e-9) return;
    setWeightPct(
      Object.fromEntries(items.map((i) => [i.ticker, ((weightPct[i.ticker] ?? 0) / sum) * 100])),
    );
  };

  /* ─── Saved portfolios ─── */
  const toggleShown = (id: string) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setManyShown = (ids: string[], on: boolean) =>
    setShown((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const saveCurrentMix = async () => {
    const entries = items
      .map((i) => [i.ticker, Math.max(0, weightPct[i.ticker] ?? 0)] as const)
      .filter(([, w]) => w > 0);
    if (entries.length === 0) {
      setSavedError("Give at least one ticker a weight above 0 before saving.");
      return;
    }
    const name = window.prompt("Name this portfolio", `My mix ${saved.length + 1}`)?.trim();
    if (!name) return;
    setBusy(true);
    try {
      const r = await fetch("/api/analysis/portfolios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, weights: Object.fromEntries(entries) }),
      });
      const j = (await r.json()) as { portfolio?: SavedPortfolio; error?: string };
      if (!r.ok || !j.portfolio) throw new Error(j.error || "Save failed");
      setSaved((prev) => [...prev, j.portfolio!]);
      setShown((prev) => new Set(prev).add(j.portfolio!.id));
      setSavedError(null);
    } catch (e) {
      setSavedError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const deleteSaved = async (p: SavedPortfolio) => {
    if (!window.confirm(`Delete “${p.name}”?`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/analysis/portfolios?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
      if (!r.ok) {
        const j = (await r.json()) as { error?: string };
        throw new Error(j.error || "Delete failed");
      }
      setSaved((prev) => prev.filter((x) => x.id !== p.id));
      setShown((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
      setSavedError(null);
    } catch (e) {
      setSavedError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  /** Load a portfolio's weights into the editable mix, pulling any names it
      needs into the basket so they're priced and optimized over. */
  const loadIntoMix = (p: SavedPortfolio | { weights: Record<string, number> }) => {
    const plan = planWeightLoad(p.weights, items.map((i) => i.ticker), BASKET_MAX);
    if (plan.empty) return;
    setItems((prev) => [...prev, ...plan.toAdd.map((t) => ({ ticker: t, fromPortfolio: false }))]);
    setWeightPct(plan.weights);
    setPin(null);
    setMixNote(overflowMessage(plan, BASKET_MAX));
  };

  return (
    <ToolShell
      category="Allocation"
      title="Portfolio Optimization"
      subtitle="Build a basket of tickers — or autofill your portfolio — set what share each name is, and see where the mix sits on the efficient frontier against the S&P 500. It uses each ticker's own history, so it works even for positions you just bought."
      asOf={data?.asOf}
    >
      <div className="flex flex-col gap-4">
        <BasketBuilder
          items={items}
          onAdd={add}
          onRemove={remove}
          onAutofill={autofill}
          onClear={clear}
          autofilling={autofilling}
          autofillError={autofillError}
          excluded={data?.excluded ?? []}
          refetching={refetching}
        />

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: CHART.muted }}>
            History window
          </span>
          <div className="inline-flex items-center gap-1 rounded-md border border-border bg-[oklch(0.16_0_0)] p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                type="button"
                onClick={() => {
                  setDays(w.days);
                  setPin(null); // frontier is re-solved on the new window
                }}
                aria-pressed={days === w.days}
                className={cn(
                  "rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-150",
                  days === w.days ? "bg-primary text-[oklch(0.08_0_0)]" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
          <span className="text-[11.5px]" style={{ color: CHART.muted }}>
            every return, volatility and Sharpe on this page is measured over this trailing window
          </span>
        </div>

        {items.length === 0 ? (
          <EmptyBlock
            title="Add tickers to build a basket."
            hint="Type a few tickers, or click “Autofill from portfolio” to load your current holdings. The frontier needs at least two."
          />
        ) : loading && !model ? (
          <LoadingBlock />
        ) : error ? (
          <ErrorBlock message={error} onRetry={retry} />
        ) : !model || !selected ? (
          <EmptyBlock
            title="Need at least two tickers with usable history."
            hint="Add another ticker (or autofill your portfolio). Very recently listed tickers may not have enough history yet."
          />
        ) : (
          <OptimizationContent
            model={model}
            selected={selected}
            target={target}
            setTarget={(t) => {
              setTarget(t);
              setPin(null);
            }}
            pinIdx={pinned ? pin!.idx : null}
            onPin={(idx) => setPin({ sig: model.sig, idx })}
            clearPin={() => setPin(null)}
            weightPct={weightPct}
            setWeight={setWeight}
            loadCurrent={loadCurrent}
            loadRebalance={loadRebalance}
            rebalanceAccounts={rebalanceAccounts}
            pickRebalance={pickRebalance}
            clearRebalanceChoices={() => setRebalanceAccounts(null)}
            mixNote={mixNote}
            equalWeight={equalWeight}
            normalizeWeights={normalizeWeights}
            saveCurrentMix={saveCurrentMix}
            saved={saved}
            savedError={savedError}
            busy={busy}
            shown={shown}
            toggleShown={toggleShown}
            setManyShown={setManyShown}
            deleteSaved={deleteSaved}
            loadIntoMix={loadIntoMix}
            snapshotError={snapshotError}
            inspected={inspected}
            setInspected={setInspected}
          />
        )}
      </div>
    </ToolShell>
  );
}

type Model = NonNullable<ReturnType<typeof buildModelType>>;
// Helper only for typing the content props; never called.
function buildModelType() {
  return null as unknown as {
    sig: string;
    included: BasketItem[];
    refWeights: number[];
    hasPortfolio: boolean;
    hasActual: boolean;
    enteredSum: number;
    plotted: PlotPortfolio[];
    plotSnapshots: PlotSnapshot[];
    allTickers: string[];
    spy: { ret: number; vol: number; sharpe: number } | null;
    showSpy: boolean;
    current: ReturnType<typeof portfolioMetrics>;
    augFrontier: ReturnType<typeof longOnlyFrontier>;
    baseFrontier: ReturnType<typeof longOnlyFrontier> | null;
    hasCand: boolean;
    cloud: ReturnType<typeof randomCloud>;
    candPoints: { ticker: string; ret: number; vol: number }[];
    tangency: ReturnType<typeof longOnlyFrontier>["maxSharpe"];
    sameRiskUpside: number | null;
    cashWeight: number;
    showCash: boolean;
    currentInclCash: { vol: number; ret: number };
    windowDays: number;
    expectedDays: number;
    windowStart: string;
    bindingTicker: string;
    bindingStart: string;
    years: string;
  };
}

/** Top contributors to a weight vector, as tooltip rows. */
function topWeights(weights: number[], items: BasketItem[], k = 3) {
  return weights
    .map((w, i) => ({ ticker: items[i]?.ticker ?? "", w }))
    .filter((x) => x.w > 0.005)
    .sort((a, b) => b.w - a.w)
    .slice(0, k)
    .map((x) => ({ label: x.ticker, value: formatPercent(x.w * 100, false) }));
}

const pctRow = (label: string, v: number) => ({ label, value: formatPercent(v * 100, false) });

/** Bar width as a rounded CSS percentage. Rounded because full float precision
    buys no visible accuracy and only bloats the inline style. */
const barPct = (v: number, max: number) => `${((v / max) * 100).toFixed(2)}%`;

function OptimizationContent({
  model,
  selected,
  target,
  setTarget,
  pinIdx,
  onPin,
  clearPin,
  weightPct,
  setWeight,
  loadCurrent,
  loadRebalance,
  rebalanceAccounts,
  pickRebalance,
  clearRebalanceChoices,
  mixNote,
  equalWeight,
  normalizeWeights,
  saveCurrentMix,
  saved,
  savedError,
  busy,
  shown,
  toggleShown,
  setManyShown,
  deleteSaved,
  loadIntoMix,
  snapshotError,
  inspected,
  setInspected,
}: {
  model: Model;
  selected: ReturnType<typeof portfolioMetrics>;
  target: Target;
  setTarget: (t: Target) => void;
  pinIdx: number | null;
  onPin: (idx: number) => void;
  clearPin: () => void;
  weightPct: Record<string, number>;
  setWeight: (ticker: string, pct: number) => void;
  loadCurrent: () => void;
  loadRebalance: () => void;
  rebalanceAccounts: AccountTargets[] | null;
  pickRebalance: (account: string) => void;
  clearRebalanceChoices: () => void;
  mixNote: string | null;
  equalWeight: () => void;
  normalizeWeights: () => void;
  saveCurrentMix: () => void;
  saved: SavedPortfolio[];
  savedError: string | null;
  busy: boolean;
  shown: Set<string>;
  toggleShown: (id: string) => void;
  setManyShown: (ids: string[], on: boolean) => void;
  deleteSaved: (p: SavedPortfolio) => void;
  loadIntoMix: (p: { weights: Record<string, number> }) => void;
  snapshotError: string | null;
  inspected: string | null;
  setInspected: (id: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const currentLabel = model.hasPortfolio ? "Your mix" : "Equal-weight";

  /* ─── Chart geometry. The cloud is drawn first (and opted out of hover), then
     the frontier nodes, then the named markers — later points win hover ties,
     so a marker always beats the curve node sitting underneath it. ─── */
  const cloudPoints: ScatterPoint[] = model.cloud.map((p) => ({
    x: p.vol * 100,
    y: p.ret * 100,
    color: CHART.muted,
    r: 2,
    noHover: true,
  }));

  const frontierPoints: ScatterPoint[] = model.augFrontier.frontier.map((p, i) => ({
    x: p.vol * 100,
    y: p.ret * 100,
    color: CHART.amber,
    r: 2,
    clickable: true,
    pointId: `frontier:${i}`,
    emphasis: i === pinIdx,
    name: i === pinIdx ? "Pinned mix" : "Frontier mix",
    meta: [
      pctRow("Expected return", p.ret),
      pctRow("Volatility", p.vol),
      { label: "Sharpe", value: p.sharpe.toFixed(2) },
      ...topWeights(p.weights, model.included),
    ],
  }));

  const markerPoints: ScatterPoint[] = [
    ...model.candPoints.map((c) => ({
      x: c.vol * 100,
      y: c.ret * 100,
      color: VIOLET,
      r: 4,
      label: c.ticker,
      name: `${c.ticker} · added ticker`,
      meta: [
        pctRow("Expected return", c.ret),
        pctRow("Volatility", c.vol),
        { label: "Sharpe (alone)", value: (c.vol > 0 ? (c.ret - RF) / c.vol : 0).toFixed(2) },
      ],
    })),
    {
      x: 0,
      y: RF * 100,
      color: TEAL,
      r: 4,
      label: "Cash",
      name: "Cash · risk-free",
      meta: [pctRow("Return", RF), { label: "Volatility", value: "0.00%" }],
    },
    ...(model.showCash
      ? [
          {
            x: model.currentInclCash.vol * 100,
            y: model.currentInclCash.ret * 100,
            color: TEAL,
            ring: true,
            r: 5,
            name: "You + cash",
            meta: [
              pctRow("Expected return", model.currentInclCash.ret),
              pctRow("Volatility", model.currentInclCash.vol),
              pctRow("Cash weight", model.cashWeight),
            ],
          } as ScatterPoint,
        ]
      : []),
    {
      x: model.current.vol * 100,
      y: model.current.ret * 100,
      color: CHART.steel,
      ring: true,
      r: 6,
      name: `${currentLabel} mix`,
      meta: [
        pctRow("Expected return", model.current.ret),
        pctRow("Volatility", model.current.vol),
        { label: "Sharpe", value: model.current.sharpe.toFixed(2) },
        ...topWeights(model.refWeights, model.included),
      ],
    },
    {
      x: model.augFrontier.maxSharpe.vol * 100,
      y: model.augFrontier.maxSharpe.ret * 100,
      color: CHART.amber,
      r: 6,
      name: "Max Sharpe (tangency)",
      meta: [
        pctRow("Expected return", model.augFrontier.maxSharpe.ret),
        pctRow("Volatility", model.augFrontier.maxSharpe.vol),
        { label: "Sharpe", value: model.augFrontier.maxSharpe.sharpe.toFixed(2) },
        ...topWeights(model.augFrontier.maxSharpe.weights, model.included),
      ],
    },
    {
      x: model.augFrontier.gmv.vol * 100,
      y: model.augFrontier.gmv.ret * 100,
      color: CHART.positive,
      r: 5,
      name: "Minimum variance",
      meta: [
        pctRow("Expected return", model.augFrontier.gmv.ret),
        pctRow("Volatility", model.augFrontier.gmv.vol),
        { label: "Sharpe", value: model.augFrontier.gmv.sharpe.toFixed(2) },
        ...topWeights(model.augFrontier.gmv.weights, model.included),
      ],
    },
  ];

  /* Plotted portfolios sit above the cloud but below the named markers, so a
     marker still wins a hover overlap. */
  const plottable = model.plotted.filter((p) => p.metrics !== null);
  const portfolioPoints: ScatterPoint[] = plottable.map((p, i) => ({
    x: p.metrics!.vol * 100,
    y: p.metrics!.ret * 100,
    color: PERI,
    r: 4.5,
    label: p.name,
    // Saved portfolios can bunch up, and names are long — stagger the labels
    // above/below and flip every fourth to the left so they stay readable.
    labelDy: i % 2 === 0 ? -9 : 13,
    labelLeft: i % 4 === 3,
    name: `${p.name} · saved`,
    meta: [
      pctRow("Expected return", p.metrics!.ret),
      pctRow("Volatility", p.metrics!.vol),
      { label: "Sharpe", value: p.metrics!.sharpe.toFixed(2) },
      ...Object.entries(p.weights)
        .filter(([, w]) => w > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([t, w]) => ({ label: t, value: `${w.toFixed(0)}%` })),
      ...(p.missing.length > 0
        ? [{ label: "not priced", value: p.missing.slice(0, 3).join(", ") }]
        : []),
    ],
  }));

  const spyPoint: ScatterPoint[] =
    model.showSpy && model.spy
      ? [
          {
            x: model.spy.vol * 100,
            y: model.spy.ret * 100,
            color: ROSE,
            r: 6,
            label: "S&P 500",
            name: "S&P 500 (SPY)",
            meta: [
              pctRow("Expected return", model.spy.ret),
              pctRow("Volatility", model.spy.vol),
              { label: "Sharpe", value: model.spy.sharpe.toFixed(2) },
            ],
          },
        ]
      : [];

  /* Past-year portfolios. Clicking one opens its holdings below the chart. */
  const snapPlottable = model.plotSnapshots.filter((s) => s.metrics !== null);
  const snapshotPoints: ScatterPoint[] = snapPlottable.map((s, i) => ({
    x: s.metrics!.vol * 100,
    y: s.metrics!.ret * 100,
    color: LIME,
    r: 5,
    label: s.label,
    labelDy: i % 2 === 0 ? -9 : 13,
    clickable: true,
    pointId: `snap:${s.id}`,
    emphasis: inspected === s.id,
    name: `Your portfolio · ${s.takenOn}`,
    hint: "Click to see its holdings",
    meta: [
      pctRow("Expected return", s.metrics!.ret),
      pctRow("Volatility", s.metrics!.vol),
      { label: "Sharpe", value: s.metrics!.sharpe.toFixed(2) },
      { label: "Holdings", value: String(Object.keys(s.weights).length) },
    ],
  }));

  // Oldest → newest, so the line reads as the portfolio's path over time.
  const snapshotTrail = [...snapPlottable]
    .sort((a, b) => a.takenOn.localeCompare(b.takenOn))
    .map((s) => ({ x: s.metrics!.vol * 100, y: s.metrics!.ret * 100 }));

  const points: ScatterPoint[] = [
    ...cloudPoints,
    ...frontierPoints,
    ...portfolioPoints,
    ...snapshotPoints,
    ...spyPoint,
    ...markerPoints,
  ];

  const augLine = model.augFrontier.frontier.map((p) => ({ x: p.vol * 100, y: p.ret * 100 }));
  const cml = [
    { x: 0, y: RF * 100 },
    { x: model.tangency.vol * 100, y: model.tangency.ret * 100 },
  ];
  const lines = [
    ...(model.hasCand && model.baseFrontier
      ? [{ points: model.baseFrontier.frontier.map((p) => ({ x: p.vol * 100, y: p.ret * 100 })), color: CHART.steel, dashed: true }]
      : []),
    { points: augLine, color: CHART.amber },
    { points: cml, color: TEAL },
    // Your portfolio's path across years, oldest to newest.
    ...(snapshotTrail.length > 1 ? [{ points: snapshotTrail, color: LIME, dashed: true }] : []),
  ];

  const handlePointClick = (p: ScatterPoint) => {
    const id = p.pointId ?? "";
    if (id.startsWith("frontier:")) {
      onPin(Number(id.slice(9)));
      setInspected(null);
    } else if (id.startsWith("snap:")) {
      const sid = id.slice(5);
      setInspected(inspected === sid ? null : sid); // click again to close
    }
  };

  const legendItems = [
    ...(model.hasCand
      ? [
          { label: "Portfolio only", color: CHART.steel, kind: "dash" as const },
          { label: "With additions", color: CHART.amber, kind: "line" as const },
        ]
      : [{ label: "Efficient frontier", color: CHART.amber, kind: "line" as const }]),
    { label: currentLabel, color: CHART.steel, kind: "ring" as const },
    { label: "Max-Sharpe", color: CHART.amber, kind: "dot" as const },
    { label: "Min-variance", color: CHART.positive, kind: "dot" as const },
    { label: "Capital market line", color: TEAL, kind: "line" as const },
    { label: "Cash", color: TEAL, kind: "dot" as const },
    ...(model.showCash ? [{ label: "You + cash", color: TEAL, kind: "ring" as const }] : []),
    ...(model.candPoints.length > 0 ? [{ label: "Added ticker", color: VIOLET, kind: "dot" as const }] : []),
    ...(model.showSpy ? [{ label: "S&P 500", color: ROSE, kind: "dot" as const }] : []),
    ...(snapPlottable.length > 0 ? [{ label: "Past years", color: LIME, kind: "dot" as const }] : []),
    ...(plottable.length > 0 ? [{ label: "Saved portfolio", color: PERI, kind: "dot" as const }] : []),
    ...(pinIdx != null ? [{ label: "Pinned mix", color: CHART.amber, kind: "ring" as const }] : []),
  ];

  const chart = (h: number) => (
    <ScatterPlot
      height={h}
      points={points}
      lines={lines}
      xLabel="Volatility (annualized %)"
      yLabel="Expected return (%)"
      xFormat={(n) => n.toFixed(0) + "%"}
      yFormat={(n) => n.toFixed(0) + "%"}
      onPointClick={handlePointClick}
      ariaLabel={`Efficient frontier for ${model.included.length} tickers. Max-Sharpe portfolio returns ${formatPercent(
        model.augFrontier.maxSharpe.ret * 100,
      )} at ${formatPercent(model.augFrontier.maxSharpe.vol * 100, false)} volatility; your ${currentLabel.toLowerCase()} mix returns ${formatPercent(
        model.current.ret * 100,
      )} at ${formatPercent(model.current.vol * 100, false)}.`}
    />
  );

  const inspectedSnap = snapPlottable.find((s) => s.id === inspected) ?? null;

  const hint = (
    <p className="m-0 text-[11.5px]" style={{ color: CHART.muted }}>
      Hover any point for its risk, return and top holdings. Click a point on the amber curve to pin that
      mix{snapPlottable.length > 0 ? ", or a green past-year point to see what you held then" : ""}.
    </p>
  );

  /* ─── Weights table ─── */
  const allRows = model.included
    .map((it, i) => ({
      ticker: it.ticker,
      isNew: !it.fromPortfolio,
      current: model.refWeights[i],
      optimal: selected.weights[i],
      delta: selected.weights[i] - model.refWeights[i],
    }))
    // Sort by whichever side is bigger, so a large holding the optimizer wants
    // to zero out still surfaces at the top rather than sinking to the bottom.
    .sort((x, y) => Math.max(y.optimal, y.current) - Math.max(x.optimal, x.current));

  const rows = showAll ? allRows : allRows.slice(0, VISIBLE_ROWS);
  const hiddenCount = allRows.length - rows.length;
  const shownOptimal = rows.reduce((s, r) => s + r.optimal, 0);
  const maxBar = Math.max(1e-9, ...allRows.map((r) => Math.max(r.optimal, r.current)));

  const sharpeGain = selected.sharpe - model.current.sharpe;
  const lift = model.baseFrontier ? model.augFrontier.maxSharpe.sharpe - model.baseFrontier.maxSharpe.sharpe : 0;
  const mixLabel = pinIdx != null ? "pinned mix" : target === "sharpe" ? "max Sharpe" : "min variance";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]" style={{ color: CHART.muted }}>
        <span>
          {model.included.length} tickers · {model.windowDays} overlapping trading days
          {model.windowStart ? ` since ${model.windowStart}` : ""}.
        </span>
        {model.windowDays < model.expectedDays * 0.75 && model.bindingTicker && (
          <span style={{ color: CHART.negative }}>
            ⚠ short window — {model.bindingTicker}&apos;s history starts {model.bindingStart}.
          </span>
        )}
      </div>

      <StatRow>
        <Stat label={`${currentLabel} Sharpe`} value={model.current.sharpe.toFixed(2)} tone={model.current.sharpe >= 1 ? "positive" : "default"} sub="reward per unit of risk" />
        <Stat
          label="Optimal Sharpe"
          value={selected.sharpe.toFixed(2)}
          tone={sharpeGain > 0.001 ? "positive" : "default"}
          sub={sharpeGain > 0.001 ? `+${sharpeGain.toFixed(2)} vs ${model.hasPortfolio ? "current" : "equal"}` : "already near-optimal"}
        />
        <Stat label="Optimal risk / return" value={formatPercent(selected.vol * 100, false)} sub={`${formatPercent(selected.ret * 100)} expected`} />
        {model.showCash && <Stat label="Your cash" value={formatPercent(model.cashWeight * 100, false)} tone="muted" sub="of total portfolio" />}
        {model.sameRiskUpside != null && model.sameRiskUpside > 0.001 && (
          <Stat label="Same-risk upside" value={formatPercent(model.sameRiskUpside * 100)} tone="positive" sub="via cash + max-Sharpe" />
        )}
        {model.hasCand && (
          <Stat label="Frontier lift" value={`${lift >= 0 ? "+" : ""}${lift.toFixed(2)}`} tone={lift > 0.001 ? "positive" : lift < -0.001 ? "negative" : "muted"} sub="max Sharpe vs portfolio-only" />
        )}
      </StatRow>

      <Panel
        title="Efficient frontier"
        right={
          <div className="flex items-center gap-2">
            <Pills target={target} setTarget={setTarget} pinned={pinIdx != null} clearPin={clearPin} />
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label="Expand chart"
              title="Expand chart"
              className="grid h-7 w-7 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <ExpandIcon />
            </button>
          </div>
        }
      >
        {chart(340)}
        <Legend items={legendItems} />
        <div className="mt-2">{hint}</div>
      </Panel>

      {inspectedSnap && (
        <SnapshotHoldings
          snap={inspectedSnap}
          onClose={() => setInspected(null)}
          onLoad={() => loadIntoMix(inspectedSnap)}
        />
      )}

      <MixEditor
        description={`Set what share of the portfolio each name is — e.g. 3% NVDA. This is the point plotted as “${currentLabel}”, so changing a weight moves it on the frontier and changes its Sharpe.`}
        tickers={model.included.map((i) => i.ticker)}
        weightPct={weightPct}
        setWeight={setWeight}
        sum={model.enteredSum}
        onLoadCurrent={model.hasActual ? loadCurrent : undefined}
        onLoadRebalance={loadRebalance}
        rebalanceChoices={rebalanceAccounts}
        onPickRebalance={pickRebalance}
        onCancelRebalance={clearRebalanceChoices}
        onEqualWeight={equalWeight}
        onScaleTo100={normalizeWeights}
        onSave={saveCurrentMix}
        busy={busy}
        note={mixNote}
      />

      <PortfolioShelf
        model={model}
        saved={saved}
        savedError={savedError}
        snapshotError={snapshotError}
        busy={busy}
        shown={shown}
        toggleShown={toggleShown}
        setManyShown={setManyShown}
        deleteSaved={deleteSaved}
        loadIntoMix={loadIntoMix}
      />

      <FrontierModal
        open={expanded}
        onClose={() => setExpanded(false)}
        title="Efficient frontier"
        controls={<Pills target={target} setTarget={setTarget} pinned={pinIdx != null} clearPin={clearPin} />}
        legend={<Legend items={legendItems} />}
        hint={hint}
      >
        {chart}
      </FrontierModal>

      <Panel
        title={`Suggested weights · ${mixLabel}`}
        right={
          <span className="font-mono text-[11px] tabular-nums" style={{ color: CHART.muted }}>
            {formatPercent(selected.vol * 100, false)} vol · {formatPercent(selected.ret * 100)} return ·{" "}
            {selected.sharpe.toFixed(2)} Sharpe
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <thead>
              <tr className="text-left" style={{ color: CHART.muted }}>
                <th className="pb-2 font-medium">Ticker</th>
                <th className="pb-2 text-right font-medium">{currentLabel} %</th>
                <th className="pb-2 text-right font-medium">Optimal %</th>
                <th className="pb-2 pl-3 font-medium">Allocation</th>
                <th className="pb-2 text-right font-medium">Δ (pts)</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {rows.map((r) => {
                const flat = Math.abs(r.delta) < 0.0005;
                const dropped = r.optimal < 0.0005;
                return (
                  <tr key={r.ticker} className="border-t border-border" style={{ opacity: dropped ? 0.62 : 1 }}>
                    <td className="py-1.5 font-sans font-medium">
                      {r.ticker}
                      {r.isNew && (
                        <span className="ml-2 rounded-[3px] px-1.5 py-[1px] text-[9.5px] font-semibold uppercase tracking-[0.04em]" style={{ background: "oklch(0.62 0.13 300 / 0.16)", color: VIOLET }}>
                          new
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-right">{formatPercent(r.current * 100, false)}</td>
                    <td className="py-1.5 text-right">{formatPercent(r.optimal * 100, false)}</td>
                    <td className="py-1.5 pl-3">
                      {/* Optimal weight as an amber bar, with the current weight
                          behind it in steel — the gap between them IS the trade. */}
                      <div className="relative h-[14px] w-[120px] overflow-hidden rounded-[3px] bg-[oklch(0.16_0_0)]">
                        <div
                          className="absolute left-0 top-0 h-full rounded-[3px]"
                          style={{ width: barPct(r.current, maxBar), background: CHART.steel, opacity: 0.42 }}
                        />
                        <div
                          className="absolute left-0 top-[3px] h-[8px] rounded-[3px]"
                          style={{ width: barPct(r.optimal, maxBar), background: CHART.amber }}
                        />
                      </div>
                    </td>
                    <td className="py-1.5 text-right" style={{ color: flat ? CHART.muted : r.delta > 0 ? CHART.positive : CHART.negative }}>
                      {flat ? "—" : formatPercent(r.delta * 100)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {allRows.length > VISIBLE_ROWS && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="rounded-sm border border-border bg-[oklch(0.16_0_0)] px-2.5 py-1 text-[11.5px] text-foreground transition-colors duration-150 hover:border-[oklch(0.28_0_0)]"
            >
              {showAll ? `Show top ${VISIBLE_ROWS}` : `Show all ${allRows.length}`}
            </button>
            <span className="font-mono text-[11px] tabular-nums" style={{ color: CHART.muted }}>
              {showAll
                ? `all ${allRows.length} names`
                : `${hiddenCount} more · shown rows hold ${formatPercent(shownOptimal * 100, false)} of the optimal mix`}
            </span>
          </div>
        )}
      </Panel>

      <MethodologyNote>
        <p>
          Markowitz mean-variance optimization over the tickers in your basket, using each ticker&apos;s own ~{model.years}
          years of daily returns — so it doesn&apos;t matter how long you&apos;ve actually held them. Expected returns are the
          annualized mean return; the risk model is the annualized sample covariance (both scaled by 252 trading days).
          The <strong>history window</strong> above sets that lookback for everything here. It matters a lot: a longer
          window averages in older, more volatile regimes, so the same portfolio can show a materially lower Sharpe over
          2–5 years than over the trailing one.
          The optimizer is <strong>long-only</strong> (weights ≥ 0, sum to 100%); &quot;Max Sharpe&quot; is the tangency
          portfolio, &quot;Min variance&quot; its lowest-vol point. Sharpe uses a {(RF * 100).toFixed(1)}% risk-free rate.
          The curve is traced at {FRONTIER_POINTS} risk-aversion levels; hovering a point reads out that mix, and
          clicking one pins it so the weights table shows it instead of Max Sharpe / Min variance. A pin is dropped
          automatically when you change the basket, since the weights would no longer line up.
        </p>
        <p>
          The steel point is <strong>your mix</strong> — the weights in the &ldquo;Asset weights&rdquo; panel, seeded from
          your actual holdings on autofill and editable from there. Entries are normalized to 100% before plotting, so only
          the relative sizes matter. Cash is the risk-free asset, plotted as the teal capital market line from the cash
          point through the max-Sharpe portfolio. Basket names are aligned to their common overlapping window, so a very
          short-history ticker can shrink it (flagged above).
        </p>
        <p>
          The rose <strong>S&amp;P 500</strong> point is SPY measured over the same window and the same way as everything
          else here — annualized mean daily return against annualized volatility, on dividend-adjusted (total-return)
          prices. It costs no extra request: SPY is already fetched as this tool&apos;s benchmark. Read it as the reference
          the whole chart is against — a basket sitting below and to the right of it took more risk for less return.
        </p>
        <p>
          <strong>Past years</strong> are automatic yearly captures of your real portfolio — one is taken the first time
          you open this tool, then a new one whenever the newest is 365 days old. Each is priced over the <em>current</em>
          window, so it answers &ldquo;how would the mix I held then look on today&apos;s data?&rdquo; — which is what makes
          it comparable to your current mix and to the frontier. It is deliberately <em>not</em> the return that mix
          actually realized during that year. Click a point to see the holdings behind it.
        </p>
        <p>
          <strong>Saved portfolios</strong> plot the same way, from weights you enter and save. They may hold names outside
          your basket; those are priced as reference-only tickers, aligned <em>onto</em> the basket&apos;s window rather than
          intersected with it, so a short-history name inside a portfolio can never shrink the window the frontier itself
          is computed over. If one can&apos;t be priced its weight is redistributed across the rest and it&apos;s called out
          above the chart.
        </p>
        <p>
          Important: expected returns estimated from history are extremely noisy and mean-variance optimizers are
          hypersensitive to them — treat the &quot;optimal&quot; mix as a directional guide, not a recommendation to buy.
          Transaction costs, taxes, position limits, liquidity, and changing correlations are not modeled.
        </p>
      </MethodologyNote>
    </div>
  );
}

/* ─── Portfolios drawn on the chart: built-in models + your saved ones ─── */
function PortfolioShelf({
  model,
  saved,
  savedError,
  snapshotError,
  busy,
  shown,
  toggleShown,
  setManyShown,
  deleteSaved,
  loadIntoMix,
}: {
  model: Model;
  saved: SavedPortfolio[];
  savedError: string | null;
  snapshotError: string | null;
  busy: boolean;
  shown: Set<string>;
  toggleShown: (id: string) => void;
  setManyShown: (ids: string[], on: boolean) => void;
  deleteSaved: (p: SavedPortfolio) => void;
  loadIntoMix: (p: { weights: Record<string, number> }) => void;
}) {
  const savedIds = saved.map((p) => p.id);
  const allSavedOn = savedIds.length > 0 && savedIds.every((id) => shown.has(id));
  const byId = new Map(model.plotted.map((p) => [p.id, p]));
  const setupNeeded = !!savedError && /run supabase/i.test(savedError);
  const snapSetupNeeded = !!snapshotError && /run supabase/i.test(snapshotError);
  const shownSnapCount = model.plotSnapshots.length;

  return (
    <Panel
      title="Portfolios on the chart"
      right={
        savedIds.length > 0 ? (
          <MiniButton onClick={() => setManyShown(savedIds, !allSavedOn)}>
            {allSavedOn ? "Hide all saved" : "Show all saved"}
          </MiniButton>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-[0.08em]" style={{ color: CHART.muted }}>
            Benchmark
          </div>
          <div className="flex flex-wrap gap-1.5">
            <PortfolioChip
              name="S&P 500"
              title="SPY over the same window — the index this basket is measured against"
              color={ROSE}
              on={shown.has(SPY_ID)}
              onToggle={() => toggleShown(SPY_ID)}
              metrics={model.showSpy && model.spy ? model.spy : null}
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-[0.08em]" style={{ color: CHART.muted }}>
            Saved by you
          </div>
          {setupNeeded ? (
            <p className="m-0 text-[11.5px]" style={{ color: CHART.muted }}>
              Run <code className="font-mono">supabase/optimizer-portfolios.sql</code> to save your own portfolios.
            </p>
          ) : saved.length === 0 ? (
            <p className="m-0 text-[11.5px]" style={{ color: CHART.muted }}>
              None yet — set weights above, then “Save as portfolio”.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {saved.map((p) => (
                <PortfolioChip
                  key={p.id}
                  name={p.name}
                  title="Saved portfolio"
                  color={PERI}
                  on={shown.has(p.id)}
                  onToggle={() => toggleShown(p.id)}
                  onLoad={() => loadIntoMix(p)}
                  onDelete={busy ? undefined : () => deleteSaved(p)}
                  metrics={byId.get(p.id)?.metrics ?? null}
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-[0.08em]" style={{ color: CHART.muted }}>
            Past years
          </div>
          {snapSetupNeeded ? (
            <p className="m-0 text-[11.5px]" style={{ color: CHART.muted }}>
              Run <code className="font-mono">supabase/portfolio-frontier-snapshots.sql</code> to start recording a yearly
              snapshot of your portfolio.
            </p>
          ) : model.plotSnapshots.length === 0 && shownSnapCount === 0 ? (
            <p className="m-0 text-[11.5px]" style={{ color: CHART.muted }}>
              Your portfolio is captured once a year — the first one is taken automatically, then a new point appears each
              year to compare against.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {model.plotSnapshots.map((s) => (
                <PortfolioChip
                  key={s.id}
                  name={s.takenOn}
                  title={`Your portfolio on ${s.takenOn} — click the chart point to see its holdings`}
                  color={LIME}
                  on
                  onToggle={() => toggleShown(s.id)}
                  onLoad={() => loadIntoMix(s)}
                  metrics={s.metrics}
                />
              ))}
            </div>
          )}
        </div>

        {savedError && !setupNeeded && (
          <p className="m-0 text-[11.5px]" style={{ color: CHART.negative }}>{savedError}</p>
        )}
        {snapshotError && !snapSetupNeeded && (
          <p className="m-0 text-[11.5px]" style={{ color: CHART.negative }}>{snapshotError}</p>
        )}
        {model.plotted.some((p) => p.missing.length > 0) && (
          <p className="m-0 text-[11.5px]" style={{ color: CHART.muted }}>
            ⚠{" "}
            {model.plotted
              .filter((p) => p.missing.length > 0)
              .map((p) => `${p.name}: no price history for ${p.missing.join(", ")}`)
              .join(" · ")}
            . Those weights were redistributed across the rest.
          </p>
        )}
      </div>
    </Panel>
  );
}

function PortfolioChip({
  name,
  title,
  color,
  on,
  onToggle,
  onLoad,
  onDelete,
  metrics,
}: {
  name: string;
  title: string;
  color: string;
  on: boolean;
  onToggle: () => void;
  /** Omitted for entries with no weight vector to copy (the benchmark). */
  onLoad?: () => void;
  onDelete?: () => void;
  metrics: { sharpe: number } | null;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors"
      style={{
        borderColor: on ? color : "oklch(0.28 0 0)",
        background: on ? `color-mix(in oklab, ${color} 14%, transparent)` : "transparent",
        color: on ? color : "oklch(0.64 0.008 74)",
      }}
      title={title}
    >
      <button type="button" onClick={onToggle} aria-pressed={on} className="inline-flex items-center gap-1.5">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: on ? color : "transparent", border: `1.5px solid ${on ? color : "oklch(0.40 0 0)"}` }}
        />
        {name}
        {on && metrics && (
          <span className="font-mono text-[10.5px] tabular-nums opacity-80">
            {metrics.sharpe.toFixed(2)}
          </span>
        )}
      </button>
      {onLoad && (
        <button
          type="button"
          onClick={onLoad}
          title="Load these weights into your mix"
          aria-label={`Load ${name} into your mix`}
          className="opacity-60 transition-opacity hover:opacity-100"
        >
          ↧
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          title="Delete"
          aria-label={`Delete ${name}`}
          className="opacity-60 transition-opacity hover:opacity-100"
        >
          ×
        </button>
      )}
    </span>
  );
}

function Pills({
  target,
  setTarget,
  pinned,
  clearPin,
}: {
  target: Target;
  setTarget: (t: Target) => void;
  pinned: boolean;
  clearPin: () => void;
}) {
  const opts: { key: Target; label: string }[] = [
    { key: "sharpe", label: "Max Sharpe" },
    { key: "minvar", label: "Min variance" },
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-border bg-[oklch(0.16_0_0)] p-0.5">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => setTarget(o.key)}
          aria-pressed={!pinned && target === o.key}
          className={cn(
            "rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-150",
            !pinned && target === o.key ? "bg-primary text-[oklch(0.08_0_0)]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
      {/* Only exists once a curve point has been clicked; × returns to the pills. */}
      {pinned && (
        <button
          type="button"
          onClick={clearPin}
          title="Clear pinned point"
          className="inline-flex items-center gap-1 rounded-[5px] bg-primary px-2.5 py-1 text-[11.5px] font-medium text-[oklch(0.08_0_0)]"
        >
          Pinned
          <span aria-hidden className="opacity-70">×</span>
          <span className="sr-only">— clear</span>
        </button>
      )}
    </div>
  );
}

/* What you actually held when a yearly snapshot was taken. */
function SnapshotHoldings({
  snap,
  onClose,
  onLoad,
}: {
  snap: PlotSnapshot;
  onClose: () => void;
  onLoad: () => void;
}) {
  const rows = Object.entries(snap.weights)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1]);
  const maxW = Math.max(1e-9, ...rows.map(([, w]) => w));

  return (
    <Panel
      title={`Your portfolio on ${snap.takenOn}`}
      right={
        <div className="flex items-center gap-2">
          {snap.metrics && (
            <span className="font-mono text-[11px] tabular-nums" style={{ color: CHART.muted }}>
              {formatPercent(snap.metrics.vol * 100, false)} vol · {formatPercent(snap.metrics.ret * 100)} return ·{" "}
              {snap.metrics.sharpe.toFixed(2)} Sharpe
            </span>
          )}
          <MiniButton onClick={onLoad}>Load into your mix</MiniButton>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close holdings"
            className="grid h-7 w-7 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      }
    >
      <p className="m-0 mb-3 text-[11.5px]" style={{ color: CHART.muted }}>
        {rows.length} {rows.length === 1 ? "holding" : "holdings"}, as a share of the invested sleeve. Its risk and
        return above are this mix measured on the <em>current</em> window — what it would look like today, not what it
        returned back then.
        {snap.missing.length > 0 && (
          <> No price history for {snap.missing.join(", ")}; that weight was redistributed across the rest.</>
        )}
      </p>
      <div className="grid gap-x-4 gap-y-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
        {rows.map(([ticker, w]) => (
          <div key={ticker} className="flex items-center gap-2 text-[12.5px]">
            <span className="w-[62px] shrink-0 truncate font-medium" title={ticker}>{ticker}</span>
            <span className="w-[52px] shrink-0 text-right font-mono tabular-nums">{w.toFixed(2)}%</span>
            <div className="relative h-[6px] flex-1 overflow-hidden rounded-full bg-[oklch(0.16_0_0)]">
              <div className="absolute left-0 top-0 h-full rounded-full" style={{ width: barPct(w, maxW), background: LIME }} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ExpandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

/* Fullscreen expand for the frontier — takes the chart as a render function so
   the inline card and the modal draw from ONE definition at different heights. */
function FrontierModal({
  open,
  onClose,
  title,
  controls,
  legend,
  hint,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  controls: React.ReactNode;
  legend: React.ReactNode;
  hint: React.ReactNode;
  children: (height: number) => React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  // The chart needs a pixel height; measure the flex area it gets to fill.
  useEffect(() => {
    if (!open) return;
    const el = areaRef.current;
    if (!el) return;
    const update = () => setH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="app-dialog m-auto h-[92vh] w-[96vw] max-w-[1600px] rounded-md border border-border bg-popover p-0 text-foreground"
    >
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: CHART.muted }}>
            {title}
          </h2>
          <div className="flex items-center gap-2">
            {controls}
            <button
              onClick={onClose}
              aria-label="Close"
              title="Close"
              className="grid h-7 w-7 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        {hint}
        <div ref={areaRef} className="min-h-0 flex-1">
          {open && h > 0 && children(h)}
        </div>
        {legend}
      </div>
    </dialog>
  );
}

function Legend({ items }: { items: { label: string; color: string; kind: "line" | "dash" | "dot" | "ring" }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: CHART.muted }}>
          {it.kind === "ring" ? (
            <span className="h-2.5 w-2.5 rounded-full" style={{ border: `2px solid ${it.color}` }} />
          ) : it.kind === "dash" ? (
            <span className="h-0 w-4" style={{ borderTop: `2px dashed ${it.color}` }} />
          ) : it.kind === "line" ? (
            <span className="h-[2px] w-4 rounded-full" style={{ background: it.color }} />
          ) : (
            <span className="h-2 w-2 rounded-full" style={{ background: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}
