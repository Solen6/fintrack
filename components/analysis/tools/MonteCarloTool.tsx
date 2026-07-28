"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCurrencyCompact, formatPercent } from "@/lib/format";
import { Sensitive, usePrivacy, MONEY_MASK } from "@/lib/privacy";
import { cn } from "@/lib/utils";
import type {
  AnalysisBasketResponse,
  AnalysisPosition,
  AnalysisPositionsResponse,
} from "@/lib/analytics/api-types";
import {
  portfolioReturns,
  annualizedGeoReturn,
  annualizedVol,
  bootstrapProjection,
  gbmProjection,
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
import { LineChart, CHART } from "../charts";
import { BasketBuilder, BASKET_MAX, type BasketItem } from "../BasketBuilder";
import { MixEditor } from "../MixEditor";
import { fetchRebalanceTargets, planWeightLoad, overflowMessage } from "../weight-sources";

type Engine = "bootstrap" | "gbm";
type Weighting = "custom" | "equal";
const HORIZONS = [5, 10, 20, 30];
const BASE_SEED = 20240501;

export function MonteCarloTool() {
  const { hidden } = usePrivacy();

  const [items, setItems] = useState<BasketItem[]>([]);
  /** User-editable mix, ticker -> percent of the basket. */
  const [weightPct, setWeightPct] = useState<Record<string, number>>({});
  /** What autofill last read off the real account, for "Reset to actual". */
  const [actualPct, setActualPct] = useState<Record<string, number>>({});
  const [autofilling, setAutofilling] = useState(false);
  const [autofillError, setAutofillError] = useState<string | null>(null);
  const [mixNote, setMixNote] = useState<string | null>(null);
  const [mixBusy, setMixBusy] = useState(false);
  const didInit = useRef(false);

  const [years, setYears] = useState(10);
  const [engine, setEngine] = useState<Engine>("bootstrap");
  const [weighting, setWeighting] = useState<Weighting>("custom");
  const [startValue, setStartValue] = useState(10000);
  const [monthly, setMonthly] = useState(0);
  const [goal, setGoal] = useState(0);
  const [seedBump, setSeedBump] = useState(0);
  const seed = BASE_SEED + seedBump;

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
  const url = tickers.length >= 1 ? `/api/analysis/basket?tickers=${tickers.join(",")}&days=730` : null;
  const { data, loading, error, retry } = useAnalysisData<AnalysisBasketResponse>(url);

  const base = useMemo(() => {
    if (!data || data.empty) return null;
    const included = items.filter((i) => data.returns[i.ticker]?.length);
    if (included.length < 1) return null;

    // The editable mix, normalized over the basket. Entries need not sum to 100.
    const rawW = included.map((i) => Math.max(0, weightPct[i.ticker] ?? 0));
    const enteredSum = rawW.reduce((s, x) => s + x, 0);
    const hasPortfolio = enteredSum > 1e-9;
    const useWeighting: Weighting = hasPortfolio && weighting === "custom" ? "custom" : "equal";
    const weights =
      useWeighting === "custom"
        ? rawW.map((w) => w / enteredSum)
        : included.map(() => 1 / included.length);
    const hasActual = Object.keys(actualPct).length > 0;

    const matrix = included.map((i) => data.returns[i.ticker]);
    const port = portfolioReturns(matrix, weights);
    if (port.length < 20) return null;

    const bindingStart = included.map((i) => data.starts[i.ticker] ?? "").reduce((a, b) => (b > a ? b : a), "");
    const bindingTicker = included.find((i) => (data.starts[i.ticker] ?? "") === bindingStart)?.ticker ?? "";

    return {
      port,
      annRet: annualizedGeoReturn(port),
      annVol: annualizedVol(port),
      hasPortfolio,
      hasActual,
      enteredSum,
      tickers: included.map((i) => i.ticker),
      useWeighting,
      count: included.length,
      windowDays: data.windowDays,
      windowStart: data.windowStart,
      bindingTicker,
      bindingStart,
    };
  }, [data, items, weightPct, actualPct, weighting]);

  const result = useMemo(() => {
    if (!base || startValue <= 0) return null;
    const cfg = {
      initialValue: startValue,
      horizonDays: years * 252,
      paths: 1000,
      seed,
      contribution: monthly > 0 ? monthly : 0,
      contributionEveryDays: 21,
    };
    return engine === "bootstrap"
      ? bootstrapProjection(base.port, cfg)
      : gbmProjection(base.annRet, base.annVol, cfg);
  }, [base, years, engine, monthly, seed, startValue]);

  const probGoal = goal > 0 && result ? result.probAbove(goal) : null;
  const refetching = loading && !!base;

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

  /* ─── Editable mix ─── */
  // Typing a weight implies you want it used, so switch off Equal weighting.
  const setWeight = (ticker: string, pct: number) => {
    setWeightPct((prev) => ({ ...prev, [ticker]: Math.max(0, pct) }));
    setWeighting("custom");
  };
  const loadCurrent = () => {
    setWeightPct(actualPct);
    setWeighting("custom");
    setMixNote(null);
  };
  const loadRebalance = async () => {
    setMixBusy(true);
    try {
      const plan = planWeightLoad(await fetchRebalanceTargets(), items.map((i) => i.ticker), BASKET_MAX);
      if (plan.empty) {
        setMixNote("No rebalance targets saved yet — set them in the Rebalancer tool first.");
        return;
      }
      setItems((prev) => [...prev, ...plan.toAdd.map((t) => ({ ticker: t, fromPortfolio: false }))]);
      setWeightPct(plan.weights);
      setWeighting("custom");
      setMixNote(overflowMessage(plan, BASKET_MAX));
    } catch (e) {
      setMixNote(e instanceof Error ? e.message : "Failed to load rebalance targets");
    } finally {
      setMixBusy(false);
    }
  };
  const equalWeight = () => {
    const each = items.length > 0 ? 100 / items.length : 0;
    setWeightPct(Object.fromEntries(items.map((i) => [i.ticker, each])));
    setWeighting("custom");
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

  return (
    <ToolShell
      category="Projections"
      title="Monte Carlo"
      subtitle="Simulate thousands of future paths for a basket of tickers — autofill your portfolio or build your own. It uses each ticker's own history, so recently-bought positions work fine."
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
        ) : !base || !result ? (
          <EmptyBlock title="Not enough history to simulate." hint="Add a ticker with more price history, or autofill your portfolio." />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]" style={{ color: CHART.muted }}>
              <span>
                {base.count} {base.count === 1 ? "ticker" : "tickers"} · {base.useWeighting === "custom" ? "custom-weighted" : "equal-weighted"} · {base.windowDays} days
                {base.windowStart ? ` since ${base.windowStart}` : ""}.
              </span>
              {base.windowDays < 252 && base.bindingTicker && (
                <span style={{ color: CHART.negative }}>⚠ short window — {base.bindingTicker} starts {base.bindingStart}.</span>
              )}
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
              <Field label="Horizon">
                <div className="flex gap-1.5">
                  {HORIZONS.map((h) => (
                    <Pill key={h} active={years === h} onClick={() => setYears(h)}>{h}y</Pill>
                  ))}
                </div>
              </Field>
              <Field label="Engine">
                <div className="flex gap-1.5">
                  <Pill active={engine === "bootstrap"} onClick={() => setEngine("bootstrap")}>Bootstrap</Pill>
                  <Pill active={engine === "gbm"} onClick={() => setEngine("gbm")}>Normal</Pill>
                </div>
              </Field>
              {base.hasPortfolio && (
                <Field label="Weighting">
                  <div className="flex gap-1.5">
                    <Pill active={weighting === "custom"} onClick={() => setWeighting("custom")}>Custom</Pill>
                    <Pill active={weighting === "equal"} onClick={() => setWeighting("equal")}>Equal</Pill>
                  </div>
                </Field>
              )}
              <Field label="Starting amount">
                <MoneyInput value={startValue} onChange={setStartValue} />
              </Field>
              <Field label="Monthly contribution">
                <MoneyInput value={monthly} onChange={setMonthly} />
              </Field>
              <Field label="Goal">
                <MoneyInput value={goal} onChange={setGoal} placeholder="none" />
              </Field>
              <button
                type="button"
                onClick={() => setSeedBump((s) => s + 1)}
                className="rounded-sm border border-border bg-[oklch(0.16_0_0)] px-3.5 py-2 text-[12.5px] text-foreground transition-colors duration-150 hover:border-[oklch(0.28_0_0)]"
              >
                Resample
              </button>
            </div>

            <MixEditor
              description="Set what share of the portfolio each name is — e.g. 3% NVDA. The simulation runs on this mix, so the weights drive the projected return, volatility and every percentile band below."
              tickers={base.tickers}
              weightPct={weightPct}
              setWeight={setWeight}
              sum={base.enteredSum}
              onLoadCurrent={base.hasActual ? loadCurrent : undefined}
              onLoadRebalance={loadRebalance}
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

            <StatRow>
              <Stat label="Median outcome" value={<Sensitive>{formatCurrencyCompact(result.median)}</Sensitive>} tone="positive" sub={`${years}-year P50`} />
              <Stat label="P10 (pessimistic)" value={<Sensitive>{formatCurrencyCompact(result.p10)}</Sensitive>} sub="1-in-10 downside" />
              <Stat label="P90 (optimistic)" value={<Sensitive>{formatCurrencyCompact(result.p90)}</Sensitive>} sub="1-in-10 upside" />
              <Stat label="Starting value" value={<Sensitive>{formatCurrencyCompact(startValue)}</Sensitive>} tone="muted" sub={`${formatPercent(base.annRet * 100)} · ${formatPercent(base.annVol * 100, false)} vol`} />
              {probGoal != null && (
                <Stat label="Prob ≥ goal" value={formatPercent(probGoal * 100, false)} tone={probGoal >= 0.5 ? "positive" : "negative"} sub="paths reaching goal" />
              )}
            </StatRow>

            <Panel title={`Projected value · ${years}y · ${engine === "bootstrap" ? "bootstrap" : "normal"}`}>
              <LineChart
                height={280}
                showEndDot={false}
                yFormat={(n) => (hidden ? MONEY_MASK : formatCurrencyCompact(n))}
                series={[
                  { name: "P90", color: CHART.muted, values: result.bands.map((b) => b.p90), dashed: true },
                  { name: "P75", color: CHART.steel, values: result.bands.map((b) => b.p75) },
                  { name: "Median", color: CHART.amber, values: result.bands.map((b) => b.p50), fill: CHART.amberFill },
                  { name: "P25", color: CHART.steel, values: result.bands.map((b) => b.p25) },
                  { name: "P10", color: CHART.muted, values: result.bands.map((b) => b.p10), dashed: true },
                ]}
              />
              <div className="mt-3 flex flex-wrap gap-4">
                <LegendItem color={CHART.amber} label="Median (P50)" />
                <LegendItem color={CHART.steel} label="25th–75th percentile" />
                <LegendItem color={CHART.muted} label="10th–90th percentile" />
              </div>
            </Panel>

            <MethodologyNote>
              <p>
                A seeded Monte-Carlo simulation of 1,000 paths over {years} years, starting from the amount you set. The
                simulated portfolio is your basket, {base.useWeighting === "custom" ? "weighted by the mix you set above (normalized to 100%, so only relative sizes matter)" : "equal-weighted"};
                it&apos;s built from each ticker&apos;s own ~2-year daily history, so it works no matter how long you&apos;ve held them.
                It is deterministic — <span className="text-foreground">Resample</span> re-runs with a new seed.
              </p>
              <p>
                <span className="text-foreground">Bootstrap</span> resamples the basket&apos;s own daily returns with replacement
                (keeping real fat tails); <span className="text-foreground">Normal</span> draws from a distribution set by the basket&apos;s
                annualized return ({formatPercent(base.annRet * 100)}) and volatility ({formatPercent(base.annVol * 100, false)}).
                Contributions are added monthly. Past returns are not a promise of the future — projections widen quickly and are a range, not a forecast.
              </p>
            </MethodologyNote>
          </div>
        )}
      </div>
    </ToolShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.08em]" style={{ color: CHART.muted }}>{label}</span>
      {children}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[12.5px] transition-colors duration-150",
        active
          ? "border-[oklch(0.72_0.14_74_/_0.5)] bg-[oklch(0.72_0.14_74_/_0.13)] text-primary"
          : "border-border bg-card text-muted-foreground hover:border-[oklch(0.28_0_0)] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function MoneyInput({ value, onChange, placeholder }: { value: number; onChange: (n: number) => void; placeholder?: string }) {
  return (
    <div className="flex items-center rounded-sm border border-border bg-card focus-within:border-[oklch(0.72_0.14_74_/_0.5)]">
      <span className="pl-2.5 pr-1 text-[12px]" style={{ color: CHART.muted }}>$</span>
      <input
        type="number"
        min={0}
        value={value === 0 ? "" : value}
        placeholder={placeholder ?? "0"}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) && n >= 0 ? n : 0);
        }}
        className="w-24 bg-transparent py-2 pr-2.5 text-right font-mono text-[12px] tabular-nums text-foreground outline-none placeholder:text-[oklch(0.50_0.006_74)]"
      />
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: CHART.muted }}>
      <span className="h-2 w-4 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
