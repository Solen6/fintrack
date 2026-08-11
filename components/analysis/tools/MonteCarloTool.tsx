"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCurrencyCompact, formatPercent } from "@/lib/format";
import { Sensitive, usePrivacy, MONEY_MASK } from "@/lib/privacy";
import type {
  AnalysisBasketResponse,
  AnalysisPosition,
  AnalysisPositionsResponse,
} from "@/lib/analytics/api-types";
import {
  portfolioReturns,
  annualizedGeoReturn,
  annualizedVol,
  defaultSpec,
  estimateRuntimeMs,
  probAbove,
  NO_FLOWS,
  TRADING_DAYS,
  type McEngineKind,
  type McFlows,
  type McSpec,
  type RebalancePolicy,
  type SolveVariable,
  type WithdrawalKind,
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
} from "../ui";
import { useAnalysisData } from "../useAnalysisData";
import { useMcEngine } from "../useMcEngine";
import { CHART } from "../charts";
import { BasketBuilder, BASKET_MAX, type BasketItem } from "../BasketBuilder";
import { MixEditor } from "../MixEditor";
import {
  fetchRebalanceTargetAccounts,
  planWeightLoad,
  overflowMessage,
  type AccountTargets,
} from "../weight-sources";
import { FanChart } from "../montecarlo/FanChart";
import { DrawdownPanel, TerminalPanel } from "../montecarlo/RiskPanels";
import { GoalPanel, DepletionPanel } from "../montecarlo/GoalPanel";
import { Field, Pill, PillRow, MoneyInput, NumInput, Check, Section, LegendItem, Caveat } from "../montecarlo/controls";

type Weighting = "custom" | "equal";

const HORIZONS = [5, 10, 20, 30];
const PATH_OPTIONS = [1000, 5000, 25000];
const WINDOWS = [
  { days: 365, label: "1Y" },
  { days: 730, label: "2Y" },
  { days: 1095, label: "3Y" },
  { days: 1825, label: "5Y" },
];
const ENGINES: { id: McEngineKind; label: string; hint: string }[] = [
  { id: "bootstrap-block", label: "Block bootstrap", hint: "Resamples contiguous stretches of real history, so crashes stay clustered. The honest default." },
  { id: "bootstrap-iid", label: "Simple bootstrap", hint: "Resamples one day at a time. Keeps fat tails but scatters bad runs, which understates drawdowns." },
  { id: "normal", label: "Normal", hint: "Lognormal from a drift and vol. Smooth, thin-tailed, and useful when you want to impose assumptions rather than replay history." },
  { id: "student-t", label: "Fat tails", hint: "Student-t innovations at the same variance — far more weight in the extreme tail." },
];
const REBALANCES: { id: RebalancePolicy; label: string; hint: string }[] = [
  { id: "continuous", label: "Continuous", hint: "Weights never drift. Mathematically the same as simulating one blended return series." },
  { id: "quarterly", label: "Quarterly", hint: "Reset to target weights every 63 trading days." },
  { id: "annual", label: "Annual", hint: "Reset to target weights once a year." },
  { id: "never", label: "Buy & hold", hint: "Never rebalance — winners compound into a bigger and bigger share of the portfolio." },
];
const WITHDRAWAL_KINDS: { id: WithdrawalKind; label: string; hint: string }[] = [
  { id: "fixed-real", label: "Fixed (real)", hint: "Same purchasing power every year — the nominal cheque grows with inflation. This is the 4%-rule mechanic." },
  { id: "fixed-nominal", label: "Fixed (nominal)", hint: "Same dollar amount every year, which quietly shrinks in real terms." },
  { id: "percent-of-balance", label: "% of balance", hint: "A fixed percentage of whatever the portfolio is worth. Can never fully run out, but the income swings." },
];

const BASE_SEED = 20240501;
/** Runtime we're willing to spend before a path count needs opting into. */
const COMFY_MS = 4000;
/** Periwinkle — the one hue the frontier chart's palette doesn't already use. */
const PINNED_COLOR = "oklch(0.68 0.12 275)";

function humanMs(ms: number): string {
  if (ms < 900) return "<1s";
  if (ms < 60_000) return `~${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s > 0 ? `~${m}m ${s}s` : `~${m}m`;
}

export function MonteCarloTool() {
  const { hidden } = usePrivacy();

  /* ─── Basket & mix ─── */
  const [items, setItems] = useState<BasketItem[]>([]);
  const [weightPct, setWeightPct] = useState<Record<string, number>>({});
  const [actualPct, setActualPct] = useState<Record<string, number>>({});
  const [autofilling, setAutofilling] = useState(false);
  const [autofillError, setAutofillError] = useState<string | null>(null);
  const [mixNote, setMixNote] = useState<string | null>(null);
  const [mixBusy, setMixBusy] = useState(false);
  /** Non-null only while waiting for the user to say which account's targets. */
  const [rebalanceAccounts, setRebalanceAccounts] = useState<AccountTargets[] | null>(null);
  const didInit = useRef(false);

  /* ─── Simulation settings ─── */
  const [years, setYears] = useState(30);
  const [engine, setEngine] = useState<McEngineKind>("bootstrap-block");
  const [rebalance, setRebalance] = useState<RebalancePolicy>("annual");
  const [weighting, setWeighting] = useState<Weighting>("custom");
  const [windowDays, setWindowDays] = useState(730);
  const [paths, setPaths] = useState(1000);
  const [seedBump, setSeedBump] = useState(0);
  const seed = BASE_SEED + seedBump;

  /* ─── Assumptions ─── */
  const [blockDays, setBlockDays] = useState(21);
  const [df, setDf] = useState(4);
  const [overrideDrift, setOverrideDrift] = useState(false);
  const [driftPct, setDriftPct] = useState(7);
  const [overrideVol, setOverrideVol] = useState(false);
  const [volPct, setVolPct] = useState(16);
  const [parameterUncertainty, setParameterUncertainty] = useState(false);

  /* ─── Cash flow ─── */
  const [startValue, setStartValue] = useState(10000);
  const [monthly, setMonthly] = useState(0);
  const [escalationPct, setEscalationPct] = useState(0);
  const [stopYear, setStopYear] = useState(0);
  const [withdrawal, setWithdrawal] = useState(0);
  const [withdrawalKind, setWithdrawalKind] = useState<WithdrawalKind>("fixed-real");
  const [withdrawalPct, setWithdrawalPct] = useState(4);
  const [withdrawStartYear, setWithdrawStartYear] = useState(0);
  const [feeBps, setFeeBps] = useState(0);
  const [inflationPct, setInflationPct] = useState(3);
  const [reportReal, setReportReal] = useState(false);
  const [lumpYear, setLumpYear] = useState(0);
  const [lumpAmount, setLumpAmount] = useState(0);

  /* ─── Display ─── */
  const [goal, setGoal] = useState(0);
  const [showPaths, setShowPaths] = useState(true);
  const [logScale, setLogScale] = useState(false);
  const [showBenchmark, setShowBenchmark] = useState(false);
  /** A snapshot of an earlier run, to compare settings changes against. Keyed
      by horizon because the band grid has to line up for the overlay to mean
      anything. */
  const [pinned, setPinned] = useState<{ values: number[]; label: string; horizonDays: number } | null>(null);

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
      const kept = positions.slice(0, BASKET_MAX);
      if (kept.length < positions.length) {
        setAutofillError(
          `Loaded your ${kept.length} largest positions — ${positions.length - kept.length} more didn't fit the ${BASKET_MAX}-ticker limit.`,
        );
      }
      setItems(kept.map((p) => ({ ticker: p.ticker, fromPortfolio: true })));
      const w: Record<string, number> = {};
      for (const p of kept) w[p.ticker] = p.weight * 100;
      setWeightPct(w);
      setActualPct(w);
      setWeighting("custom");
      if (j.totalValue && j.totalValue > 0) setStartValue(Math.round(j.totalValue));
    } catch (e) {
      setAutofillError(e instanceof Error ? e.message : "Failed to load positions");
    } finally {
      setAutofilling(false);
    }
  }, []);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    autofill();
  }, [autofill]);

  const tickers = items.map((i) => i.ticker);
  const url = tickers.length >= 1 ? `/api/analysis/basket?tickers=${tickers.join(",")}&days=${windowDays}` : null;
  const { data, loading, error, retry } = useAnalysisData<AnalysisBasketResponse>(url);

  const base = useMemo(() => {
    if (!data || data.empty) return null;
    const included = items.filter((i) => data.returns[i.ticker]?.length);
    if (included.length < 1) return null;

    const rawW = included.map((i) => Math.max(0, weightPct[i.ticker] ?? 0));
    const enteredSum = rawW.reduce((s, x) => s + x, 0);
    const hasPortfolio = enteredSum > 1e-9;
    const useWeighting: Weighting = hasPortfolio && weighting === "custom" ? "custom" : "equal";
    const weights =
      useWeighting === "custom" ? rawW.map((w) => w / enteredSum) : included.map(() => 1 / included.length);

    const matrix = included.map((i) => data.returns[i.ticker]);
    const port = portfolioReturns(matrix, weights);
    if (port.length < 20) return null;

    const bindingStart = included.map((i) => data.starts[i.ticker] ?? "").reduce((a, b) => (b > a ? b : a), "");
    const bindingTicker = included.find((i) => (data.starts[i.ticker] ?? "") === bindingStart)?.ticker ?? "";
    // Relative, so a deliberately short window doesn't permanently cry wolf.
    const expectedDays = Math.round((windowDays * TRADING_DAYS) / 365);

    return {
      port,
      matrix,
      weights,
      annRet: annualizedGeoReturn(port),
      annVol: annualizedVol(port),
      hasPortfolio,
      hasActual: Object.keys(actualPct).length > 0,
      enteredSum,
      tickers: included.map((i) => i.ticker),
      useWeighting,
      count: included.length,
      windowDays: data.windowDays,
      windowStart: data.windowStart,
      shortWindow: data.windowDays < expectedDays * 0.75,
      bindingTicker,
      bindingStart,
      benchmark: data.benchmark,
    };
  }, [data, items, weightPct, actualPct, weighting, windowDays]);

  const flows = useMemo<McFlows>(
    () => ({
      ...NO_FLOWS,
      contribution: monthly > 0 ? monthly : 0,
      contributionEveryDays: 21,
      contributionEscalationPct: escalationPct,
      contributionStopYear: stopYear > 0 ? stopYear : null,
      withdrawal: withdrawalKind === "percent-of-balance" ? 0 : withdrawal,
      withdrawalEveryDays: 21,
      withdrawalKind,
      withdrawalPct,
      withdrawalStartYear: withdrawStartYear,
      lumpSums: lumpAmount !== 0 && lumpYear > 0 ? [{ year: lumpYear, amount: lumpAmount }] : [],
      feeAnnualBps: feeBps,
      inflationPct,
      reportReal,
    }),
    [monthly, escalationPct, stopYear, withdrawal, withdrawalKind, withdrawalPct, withdrawStartYear, lumpAmount, lumpYear, feeBps, inflationPct, reportReal],
  );

  const withdrawing = withdrawalKind === "percent-of-balance" ? withdrawalPct > 0 : withdrawal > 0;

  const spec = useMemo<McSpec | null>(() => {
    if (!base || startValue <= 0) return null;
    return {
      ...defaultSpec(),
      engine,
      blockDays,
      df,
      rebalance,
      returnsByAsset: base.matrix,
      weights: base.weights,
      assume: {
        drift: overrideDrift ? driftPct / 100 : null,
        vol: overrideVol ? volPct / 100 : null,
      },
      parameterUncertainty,
      horizonDays: years * TRADING_DAYS,
      paths,
      seed,
      initialValue: startValue,
      flows,
      keepPaths: showPaths ? 12 : 0,
      antithetic: engine === "normal" || engine === "student-t",
    };
  }, [base, engine, blockDays, df, rebalance, overrideDrift, driftPct, overrideVol, volPct, parameterUncertainty, years, paths, seed, startValue, flows, showPaths]);

  const { result, busy, error: simError, offThread, cappedTo, solve } = useMcEngine(spec);

  /* The benchmark rides the same window and settings, so the comparison is
     like-for-like. Only built when shown — it's a second full simulation. */
  const benchSpec = useMemo<McSpec | null>(() => {
    if (!spec || !showBenchmark || !base?.benchmark?.returns?.length) return null;
    return {
      ...spec,
      returnsByAsset: [base.benchmark.returns],
      weights: [1],
      rebalance: "continuous",
      paths: Math.min(spec.paths, 5000),
      keepPaths: 0,
    };
  }, [spec, showBenchmark, base]);
  const { result: benchResult } = useMcEngine(benchSpec);

  const pinnedActive = !!pinned && pinned.horizonDays === years * TRADING_DAYS;
  const estMs = spec ? estimateRuntimeMs(spec) : 0;
  const probGoal = goal > 0 && result ? probAbove(result.terminal, goal) : null;
  const refetching = loading && !!base;
  const money = (n: number) => (hidden ? MONEY_MASK : formatCurrencyCompact(n));

  const onSolve = useCallback(
    (variable: SolveVariable, target: number) => {
      if (!spec) return Promise.reject(new Error("Nothing to solve"));
      // Solve at a reduced path count: ~24 simulations, and the answer is a
      // threshold rather than a percentile, so it tolerates more sampling noise.
      return solve({ spec: { ...spec, paths: Math.min(spec.paths, 2000), keepPaths: 0 }, variable, goal, target });
    },
    [solve, spec, goal],
  );

  /* ─── Basket handlers ─── */
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
    setAutofillError(null);
  };

  const setWeight = (ticker: string, pct: number) => {
    setWeightPct((prev) => ({ ...prev, [ticker]: Math.max(0, pct) }));
    setWeighting("custom");
  };
  const loadCurrent = () => {
    setWeightPct(actualPct);
    setWeighting("custom");
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
    setWeighting("custom");
    setMixNote(
      overflowMessage(plan, BASKET_MAX) ??
        `Loaded ${account} targets — percentages of that account, normalized to 100% here.`,
    );
  };

  const loadRebalance = async () => {
    setMixBusy(true);
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
      setMixBusy(false);
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
    setWeighting("custom");
    setMixNote(null);
  };
  const normalizeWeights = () => {
    const sum = items.reduce((s, i) => s + Math.max(0, weightPct[i.ticker] ?? 0), 0);
    if (sum <= 1e-9) return;
    setWeightPct(Object.fromEntries(items.map((i) => [i.ticker, ((weightPct[i.ticker] ?? 0) / sum) * 100])));
  };

  return (
    <ToolShell
      category="Projections"
      title="Monte Carlo"
      subtitle="Simulate thousands of futures for a basket of tickers — with real rebalancing, fat tails, contributions and withdrawals, and an honest account of how wrong the inputs could be."
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

        {items.length === 0 ? (
          <EmptyBlock title="Add tickers to simulate." hint="Type a few tickers, or click “Autofill from portfolio” to load your holdings." />
        ) : loading && !base ? (
          <LoadingBlock />
        ) : error ? (
          <ErrorBlock message={error} onRetry={retry} />
        ) : !base ? (
          <EmptyBlock title="Not enough history to simulate." hint="Add a ticker with more price history, or autofill your portfolio." />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]" style={{ color: CHART.muted }}>
              <span>
                {base.count} {base.count === 1 ? "ticker" : "tickers"} · {base.useWeighting === "custom" ? "custom-weighted" : "equal-weighted"} ·{" "}
                {base.windowDays} days{base.windowStart ? ` since ${base.windowStart}` : ""} · history {formatPercent(base.annRet * 100)} @{" "}
                {formatPercent(base.annVol * 100, false)} vol
              </span>
              {base.shortWindow && base.bindingTicker && (
                <span style={{ color: CHART.negative }}>⚠ short window — {base.bindingTicker} starts {base.bindingStart}.</span>
              )}
            </div>

            {/* ── Primary controls ── */}
            <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
              <Field label="Horizon">
                <PillRow>
                  {HORIZONS.map((h) => (
                    <Pill key={h} active={years === h} onClick={() => setYears(h)}>{h}y</Pill>
                  ))}
                </PillRow>
              </Field>
              <Field label="Engine">
                <PillRow>
                  {ENGINES.map((e) => (
                    <Pill key={e.id} active={engine === e.id} onClick={() => setEngine(e.id)} title={e.hint}>{e.label}</Pill>
                  ))}
                </PillRow>
              </Field>
              <Field label="Rebalancing">
                <PillRow>
                  {REBALANCES.map((r) => (
                    <Pill key={r.id} active={rebalance === r.id} onClick={() => setRebalance(r.id)} title={r.hint}>{r.label}</Pill>
                  ))}
                </PillRow>
              </Field>
              {base.hasPortfolio && (
                <Field label="Weighting">
                  <PillRow>
                    <Pill active={weighting === "custom"} onClick={() => setWeighting("custom")}>Custom</Pill>
                    <Pill active={weighting === "equal"} onClick={() => setWeighting("equal")}>Equal</Pill>
                  </PillRow>
                </Field>
              )}
              <Field label="Paths" hint={estMs > COMFY_MS ? humanMs(estMs) : undefined}>
                <PillRow>
                  {PATH_OPTIONS.map((p) => {
                    const cost = spec ? estimateRuntimeMs({ ...spec, paths: p }) : 0;
                    return (
                      <Pill
                        key={p}
                        active={paths === p}
                        tone={cost > 20000 ? "warn" : "primary"}
                        onClick={() => setPaths(p)}
                        title={`Estimated ${humanMs(cost)} with the current engine and basket`}
                      >
                        {p >= 1000 ? `${p / 1000}k` : p}
                      </Pill>
                    );
                  })}
                </PillRow>
              </Field>
              <button
                type="button"
                onClick={() => setSeedBump((s) => s + 1)}
                className="rounded-sm border border-border bg-[oklch(0.16_0_0)] px-3.5 py-2 text-[12.5px] text-foreground transition-colors duration-150 hover:border-[oklch(0.28_0_0)]"
              >
                Resample
              </button>
            </div>

            {estMs > 20000 && (
              <Caveat>
                This configuration is estimated at {humanMs(estMs)}. The parametric engines simulate every asset against a
                covariance matrix, which costs roughly the square of the basket size — a bootstrap engine reproduces the
                same correlations directly from history and runs far faster on a large basket.
              </Caveat>
            )}

            {/* ── Assumptions ── */}
            <Section
              title="Assumptions"
              summary={`${WINDOWS.find((w) => w.days === windowDays)?.label ?? ""} history${overrideDrift ? ` · ${driftPct}% assumed` : ""}${parameterUncertainty ? " · uncertainty on" : ""}`}
            >
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                  <Field label="History window" hint="drives return, vol and correlation">
                    <PillRow>
                      {WINDOWS.map((w) => (
                        <Pill key={w.days} active={windowDays === w.days} onClick={() => setWindowDays(w.days)}>{w.label}</Pill>
                      ))}
                    </PillRow>
                  </Field>
                  {engine === "bootstrap-block" && (
                    <Field label="Mean block" hint="trading days">
                      <NumInput value={blockDays} onChange={setBlockDays} unit="d" min={2} max={252} />
                    </Field>
                  )}
                  {engine === "student-t" && (
                    <Field label="Tail heaviness" hint="lower = fatter">
                      <NumInput value={df} onChange={setDf} unit="df" min={2.5} max={30} step={0.5} />
                    </Field>
                  )}
                </div>

                <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                  <div className="flex items-end gap-2.5">
                    <Check checked={overrideDrift} onChange={setOverrideDrift} label="Assume a return" />
                    {overrideDrift && <NumInput value={driftPct} onChange={setDriftPct} unit="%/yr" step={0.5} min={-20} max={40} />}
                  </div>
                  <div className="flex items-end gap-2.5">
                    <Check checked={overrideVol} onChange={setOverrideVol} label="Assume a volatility" />
                    {overrideVol && <NumInput value={volPct} onChange={setVolPct} unit="%" step={0.5} min={0} max={80} />}
                  </div>
                </div>

                <Check
                  checked={parameterUncertainty}
                  onChange={setParameterUncertainty}
                  label="Account for estimation error in the expected return"
                  hint={`Draws each path's expected return from its sampling distribution instead of trusting one point estimate. On ${(base.windowDays / TRADING_DAYS).toFixed(1)} years of data the standard error is about ±${formatPercent((base.annVol / Math.sqrt(base.windowDays / TRADING_DAYS)) * 100, false)} a year — the single biggest source of false precision in a long projection.`}
                />

                {overrideDrift && (
                  <p className="text-[11px] leading-relaxed" style={{ color: CHART.muted }}>
                    On the bootstrap engines an assumed return is applied by shifting every resampled day by a constant, so
                    the shape and the correlations of real history are preserved — only the drift moves.
                  </p>
                )}
              </div>
            </Section>

            {/* ── Cash flow ── */}
            <Section
              title="Cash flow"
              summary={`${money(startValue)} start${monthly > 0 ? ` · +${money(monthly)}/mo` : ""}${withdrawing ? " · withdrawing" : ""}${reportReal ? " · today's dollars" : ""}`}
            >
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                  <Field label="Starting amount">
                    <MoneyInput value={startValue} onChange={setStartValue} width="w-32" />
                  </Field>
                  <Field label="Monthly contribution">
                    <MoneyInput value={monthly} onChange={setMonthly} />
                  </Field>
                  {monthly > 0 && (
                    <>
                      <Field label="Raise it yearly">
                        <NumInput value={escalationPct} onChange={setEscalationPct} unit="%" step={0.5} max={20} placeholder="0" />
                      </Field>
                      <Field label="Stop contributing" hint="0 = never">
                        <NumInput value={stopYear} onChange={setStopYear} unit="yr" max={years} placeholder="never" />
                      </Field>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                  <Field label="Withdrawal rule">
                    <PillRow>
                      {WITHDRAWAL_KINDS.map((k) => (
                        <Pill key={k.id} active={withdrawalKind === k.id} onClick={() => setWithdrawalKind(k.id)} title={k.hint}>{k.label}</Pill>
                      ))}
                    </PillRow>
                  </Field>
                  {withdrawalKind === "percent-of-balance" ? (
                    <Field label="Withdraw yearly">
                      <NumInput value={withdrawalPct} onChange={setWithdrawalPct} unit="%" step={0.25} max={50} />
                    </Field>
                  ) : (
                    <Field label="Monthly withdrawal">
                      <MoneyInput value={withdrawal} onChange={setWithdrawal} />
                    </Field>
                  )}
                  {withdrawing && (
                    <Field label="Start withdrawing" hint="0 = now">
                      <NumInput value={withdrawStartYear} onChange={setWithdrawStartYear} unit="yr" max={years} placeholder="now" />
                    </Field>
                  )}
                </div>

                <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                  <Field label="One-off amount" hint="+ in, − out">
                    <MoneyInput value={Math.abs(lumpAmount)} onChange={(n) => setLumpAmount(lumpAmount < 0 ? -n : n)} placeholder="none" />
                  </Field>
                  {lumpAmount !== 0 && (
                    <>
                      <Field label="In year">
                        <NumInput value={lumpYear} onChange={setLumpYear} unit="yr" min={1} max={years} />
                      </Field>
                      <Field label="Direction">
                        <PillRow>
                          <Pill active={lumpAmount > 0} onClick={() => setLumpAmount(Math.abs(lumpAmount))}>Adding</Pill>
                          <Pill active={lumpAmount < 0} onClick={() => setLumpAmount(-Math.abs(lumpAmount))}>Taking out</Pill>
                        </PillRow>
                      </Field>
                    </>
                  )}
                  <Field label="Annual fees" hint="expense ratios, advice">
                    <NumInput value={feeBps} onChange={setFeeBps} unit="bp" max={500} placeholder="0" />
                  </Field>
                  <Field label="Inflation">
                    <NumInput value={inflationPct} onChange={setInflationPct} unit="%" step={0.25} max={20} />
                  </Field>
                </div>

                <Check
                  checked={reportReal}
                  onChange={setReportReal}
                  label="Show everything in today's dollars"
                  hint={`Deflates every projected figure by ${inflationPct}% a year. Over ${years} years that divides the headline number by ${Math.pow(1 + inflationPct / 100, years).toFixed(1)}× — the difference between a number that sounds impressive and one you can spend.`}
                />
              </div>
            </Section>

            <MixEditor
              description="Set what share of the portfolio each name is — e.g. 3% NVDA. The simulation runs on this mix, so the weights drive the projected return, volatility and every percentile band below."
              tickers={base.tickers}
              weightPct={weightPct}
              setWeight={setWeight}
              sum={base.enteredSum}
              onLoadCurrent={base.hasActual ? loadCurrent : undefined}
              onLoadRebalance={loadRebalance}
              rebalanceChoices={rebalanceAccounts}
              onPickRebalance={pickRebalance}
              onCancelRebalance={() => setRebalanceAccounts(null)}
              onEqualWeight={equalWeight}
              onScaleTo100={normalizeWeights}
              busy={mixBusy}
              note={mixNote}
              inactiveNote={
                base.useWeighting === "equal" && base.hasPortfolio
                  ? "Weighting is set to Equal — these weights aren’t being simulated. Switch to Custom above to use them."
                  : undefined
              }
            />

            {simError ? (
              <ErrorBlock message={simError} />
            ) : !result ? (
              <LoadingBlock label={busy ? `Simulating ${paths.toLocaleString()} paths…` : "Loading…"} />
            ) : (
              <>
                <StatRow>
                  <Stat label="Median outcome" value={<Sensitive>{money(result.median)}</Sensitive>} tone="positive" sub={`${years}-year P50${reportReal ? ", today's $" : ""}`} />
                  <Stat label="P10 (pessimistic)" value={<Sensitive>{money(result.p10)}</Sensitive>} sub="1-in-10 downside" />
                  <Stat label="P90 (optimistic)" value={<Sensitive>{money(result.p90)}</Sensitive>} sub="1-in-10 upside" />
                  <Stat
                    label="Worst drawdown"
                    value={formatPercent(result.maxDrawdowns[Math.floor(result.paths / 2)] * 100)}
                    tone="negative"
                    sub="typical path, peak to trough"
                  />
                  {withdrawing && (
                    <Stat
                      label="Money lasts"
                      value={formatPercent((1 - result.ruinFraction) * 100, false)}
                      tone={result.ruinFraction > 0.1 ? "negative" : "positive"}
                      sub={`through ${years} years`}
                    />
                  )}
                  {probGoal != null && (
                    <Stat label="Prob ≥ goal" value={formatPercent(probGoal * 100, false)} tone={probGoal >= 0.5 ? "positive" : "negative"} sub="paths reaching goal" />
                  )}
                </StatRow>

                <Panel
                  title={`Projected value · ${years}y · ${ENGINES.find((e) => e.id === engine)?.label.toLowerCase()}${reportReal ? " · today's dollars" : ""}`}
                >
                  <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Check checked={showPaths} onChange={setShowPaths} label="Show individual paths" />
                    <Check checked={logScale} onChange={setLogScale} label="Log scale" />
                    <Check checked={showBenchmark} onChange={setShowBenchmark} label={`Compare to ${base.benchmark?.ticker ?? "SPY"}`} />
                    <button
                      type="button"
                      onClick={() =>
                        pinnedActive
                          ? setPinned(null)
                          : setPinned({
                              values: result.bands.map((b) => b.p50),
                              label: `pinned · ${ENGINES.find((e) => e.id === engine)?.label.toLowerCase()}, ${REBALANCES.find((r) => r.id === rebalance)?.label.toLowerCase()}`,
                              horizonDays: years * TRADING_DAYS,
                            })
                      }
                      className="rounded-full border border-border bg-card px-3 py-1 text-[11.5px] text-muted-foreground transition-colors duration-150 hover:border-[oklch(0.28_0_0)] hover:text-foreground"
                    >
                      {pinnedActive ? "Clear pinned" : "Pin this run to compare"}
                    </button>
                    {busy && (
                      <span className="text-[11.5px]" style={{ color: CHART.muted }}>
                        recomputing…
                      </span>
                    )}
                  </div>
                  {pinned && !pinnedActive && (
                    <p className="mb-2 text-[11.5px]" style={{ color: CHART.muted }}>
                      Pinned run was over a different horizon, so it isn&apos;t comparable — clear it or return to {(pinned.horizonDays / TRADING_DAYS).toFixed(0)}y.
                    </p>
                  )}

                  <FanChart
                    bands={result.bands}
                    horizonDays={years * TRADING_DAYS}
                    format={money}
                    samplePaths={showPaths ? result.samplePaths : []}
                    compare={
                      pinnedActive
                        ? { values: pinned!.values, color: PINNED_COLOR, label: "pinned median" }
                        : showBenchmark && benchResult
                          ? { values: benchResult.bands.map((b) => b.p50), color: CHART.steel, label: `${base.benchmark?.ticker ?? "SPY"} median` }
                          : null
                    }
                    goal={goal}
                    logScale={logScale}
                    startValue={startValue}
                  />

                  <div className="mt-3 flex flex-wrap gap-4">
                    <LegendItem color={CHART.amber} label="Median (P50)" />
                    <LegendItem color={CHART.steel} label="25th–75th" />
                    <LegendItem color={CHART.muted} label="5th–95th" />
                    {showPaths && <LegendItem color={CHART.amber} label="individual paths" />}
                    {pinnedActive && <LegendItem color={PINNED_COLOR} label={pinned!.label} dashed />}
                    {!pinnedActive && showBenchmark && benchResult && <LegendItem color={CHART.steel} label={`${base.benchmark?.ticker ?? "SPY"} median`} dashed />}
                    {goal > 0 && <LegendItem color={CHART.positive} label="goal" dashed />}
                  </div>
                  {pinnedActive && showBenchmark && (
                    <p className="mt-2 text-[11.5px]" style={{ color: CHART.muted }}>
                      The pinned run takes the comparison line while it&apos;s active; clear it to see {base.benchmark?.ticker ?? "SPY"} again.
                    </p>
                  )}
                  {logScale && result.ruinFraction > 0 && (
                    <p className="mt-2 text-[11.5px]" style={{ color: CHART.muted }}>
                      A log axis has no room for zero, so paths that ran out of money flatten onto the bottom gridline rather
                      than reaching it. The ruin figures below count them properly.
                    </p>
                  )}
                </Panel>

                <div className="grid gap-4 lg:grid-cols-2">
                  <DrawdownPanel run={result} />
                  <TerminalPanel run={result} goal={goal} format={money} startValue={startValue} />
                </div>

                <GoalPanel run={result} goal={goal} setGoal={setGoal} format={money} spec={spec} solve={onSolve} years={years} />

                {withdrawing && <DepletionPanel run={result} years={years} />}

                <MethodologyNote>
                  <p>
                    {result.paths.toLocaleString()} simulated paths over {years} years, {offThread ? "run off the main thread in a Web Worker" : "run inline"}
                    {cappedTo ? ` and capped to ${cappedTo.toLocaleString()} paths because no Worker was available` : ""}. Deterministic —{" "}
                    <span className="text-foreground">Resample</span> re-runs with a new seed. Percentiles carry sampling error of their
                    own; the table above shows it per row, and it shrinks as the square root of the path count.
                  </p>
                  <p>
                    <span className="text-foreground">{ENGINES.find((e) => e.id === engine)?.label}</span> —{" "}
                    {ENGINES.find((e) => e.id === engine)?.hint}{" "}
                    {engine === "student-t" && (
                      <>
                        Worth knowing: at matched variance the fat-tailed engine mostly moves the deep tail (past roughly
                        1-in-500). Aggregating hundreds of daily draws averages away even a huge single day, so the median
                        and the typical drawdown barely change.
                      </>
                    )}
                    {rebalance === "continuous" ? (
                      <> Weights are held fixed, which is arithmetically identical to simulating one blended return series.</>
                    ) : (
                      <> Each asset is simulated separately and the portfolio is reset to your target weights {rebalance === "never" ? "never — so winners compound into an ever-larger share" : rebalance === "annual" ? "once a year" : "every quarter"}.</>
                    )}
                  </p>
                  <p>
                    Built from each ticker&apos;s own {(base.windowDays / TRADING_DAYS).toFixed(1)}-year daily history, so it works no matter how
                    long you&apos;ve held them. Returns are total return, dividends included.{" "}
                    {parameterUncertainty
                      ? "Expected return is drawn per path from its sampling distribution, so the cone reflects how little a few years of data really pins down."
                      : "Expected return is taken as a point estimate — turn on estimation error under Assumptions to see how much that assumption is worth."}{" "}
                    Past returns are not a promise of the future; this is a range, not a forecast.
                  </p>
                </MethodologyNote>
              </>
            )}
          </div>
        )}
      </div>
    </ToolShell>
  );
}
