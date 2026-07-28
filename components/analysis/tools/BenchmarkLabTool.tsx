"use client";

import { useMemo, useState } from "react";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AnalysisHistoryResponse } from "@/lib/analytics/api-types";
import {
  portfolioReturns,
  beta,
  annualizedGeoReturn,
  annualizedVol,
  stdev,
  equityCurve,
  mean,
  correlationMatrix,
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

const RF = 0.043; // ~1y T-bill, matches the app's risk-free assumption
const TRADING_DAYS = 252;

type Range = "3M" | "6M" | "1Y" | "2Y";
const RANGES: Range[] = ["3M", "6M", "1Y", "2Y"];
const RANGE_DAYS: Record<Range, number> = { "3M": 63, "6M": 126, "1Y": 252, "2Y": 504 };

/** Capture ratio (%) of the portfolio vs SPY on the days SPY moved in `dir`. */
function captureRatio(portS: number[], benchS: number[], dir: 1 | -1): number | null {
  const p: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < benchS.length; i++) {
    const up = benchS[i] > 0;
    const down = benchS[i] < 0;
    if (dir === 1 ? up : down) {
      p.push(portS[i]);
      b.push(benchS[i]);
    }
  }
  if (p.length === 0) return null;
  const denom = mean(b);
  if (denom === 0) return null;
  return (mean(p) / denom) * 100;
}

export function BenchmarkLabTool() {
  const { data, loading, error, retry } =
    useAnalysisData<AnalysisHistoryResponse>("/api/analysis/history?days=730");
  const [range, setRange] = useState<Range>("1Y");

  const model = useMemo(() => {
    if (!data || data.empty || data.assets.length === 0) return null;
    const assets = data.assets;
    const matrix = assets.map((a) => data.returns[a.ticker]);
    const weights = assets.map((a) => a.weight);
    const port = portfolioReturns(matrix, weights);
    const bench = data.benchmark.returns;
    if (port.length < 30 || bench.length < 30) return null;

    // Slice to the selected window's last k entries; fall back to full when shorter.
    const k = RANGE_DAYS[range];
    const take = Math.min(k, port.length, bench.length);
    const portSlice = port.slice(-take);
    const benchSlice = bench.slice(-take);

    const cumPort = equityCurve(portSlice).map((v) => (v - 1) * 100);
    const cumBench = equityCurve(benchSlice).map((v) => (v - 1) * 100);
    const finalExcess = cumPort[cumPort.length - 1] - cumBench[cumBench.length - 1];

    const annPort = annualizedGeoReturn(portSlice);
    const annBench = annualizedGeoReturn(benchSlice);
    const b = beta(portSlice, benchSlice);
    const alpha = annPort - (RF + b * (annBench - RF));

    const diff = portSlice.map((r, i) => r - benchSlice[i]);
    const trackingError = stdev(diff) * Math.sqrt(TRADING_DAYS);
    const infoRatio = trackingError !== 0 ? (annPort - annBench) / trackingError : 0;
    const correlation = correlationMatrix([portSlice, benchSlice])[0][1];

    const upCapture = captureRatio(portSlice, benchSlice, 1);
    const downCapture = captureRatio(portSlice, benchSlice, -1);

    return {
      days: take,
      cumPort,
      cumBench,
      finalExcess,
      annPort,
      annBench,
      volPort: annualizedVol(portSlice),
      volBench: annualizedVol(benchSlice),
      beta: b,
      alpha,
      trackingError,
      infoRatio,
      correlation,
      upCapture,
      downCapture,
    };
  }, [data, range]);

  return (
    <ToolShell
      category="Performance"
      title="Benchmark Lab"
      subtitle="Race the portfolio against SPY over a chosen window — cumulative return plus the relative stats (alpha, beta, capture, tracking error) that say whether you're beating the market or just riding it."
      asOf={data?.asOf}
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={retry} />
      ) : !model ? (
        <EmptyBlock
          title="Not enough price history to race against SPY."
          hint="Benchmark Lab needs equity or ETF holdings with at least ~30 trading days of aligned history. Cash, options, futures, and individual bonds are excluded."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[12.5px] text-muted-foreground">
              Portfolio vs SPY · buy-and-hold of current weights
            </span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Return window">
              {RANGES.map((r) => {
                const active = r === range;
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setRange(r)}
                    className={cn(
                      "inline-flex items-center rounded-full border px-3 py-1.5 text-[12.5px] tabular-nums transition-colors duration-150",
                      active
                        ? "border-[oklch(0.72_0.14_74_/_0.5)] bg-[oklch(0.72_0.14_74_/_0.13)] text-primary"
                        : "border-border bg-card text-muted-foreground hover:border-[oklch(0.28_0_0)] hover:text-foreground",
                    )}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </div>

          <StatRow>
            <Stat
              label="Excess return"
              value={formatPercent(model.finalExcess)}
              tone={model.finalExcess >= 0 ? "positive" : "negative"}
              sub={`over ~${model.days} trading days`}
            />
            <Stat
              label="Alpha (ann.)"
              value={formatPercent(model.alpha * 100)}
              tone={model.alpha >= 0 ? "positive" : "negative"}
              sub="Jensen's α vs SPY"
            />
            <Stat
              label="Beta"
              value={model.beta.toFixed(2)}
              sub={`vol ${formatPercent(model.volPort * 100, false)} vs SPY ${formatPercent(model.volBench * 100, false)}`}
            />
            <Stat
              label="Tracking error"
              value={formatPercent(model.trackingError * 100, false)}
              sub="active risk, ann."
            />
            <Stat
              label="Info ratio"
              value={model.infoRatio.toFixed(2)}
              tone={model.infoRatio >= 0 ? "positive" : "negative"}
              sub="excess ÷ tracking error"
            />
            <Stat
              label="Up capture"
              value={model.upCapture == null ? "—" : `${model.upCapture.toFixed(0)}%`}
              sub="on SPY up days"
            />
            <Stat
              label="Down capture"
              value={model.downCapture == null ? "—" : `${model.downCapture.toFixed(0)}%`}
              sub="on SPY down days"
            />
            <Stat
              label="Correlation"
              value={model.correlation.toFixed(2)}
              sub="daily returns, vs SPY"
            />
          </StatRow>

          <Panel
            title="Cumulative return"
            right={
              <span className="font-mono text-[11px] tabular-nums" style={{ color: CHART.muted }}>
                ann. {formatPercent(model.annPort * 100)} vs SPY {formatPercent(model.annBench * 100)}
              </span>
            }
          >
            <LineChart
              height={250}
              baseline={0}
              yFormat={(n) => `${n.toFixed(0)}%`}
              series={[
                { name: "Portfolio", color: CHART.amber, values: model.cumPort, fill: CHART.amberFill },
                { name: "SPY", color: CHART.steel, values: model.cumBench, dashed: true },
              ]}
            />
            <Legend
              items={[
                { label: "Portfolio", color: CHART.amber },
                { label: "SPY", color: CHART.steel },
              ]}
            />
          </Panel>

          <MethodologyNote>
            <p>
              This races a <strong>holdings-based</strong> series against SPY over the selected window: your
              current weights within the invested (non-cash) sleeve, held constant and applied to each
              asset&apos;s daily simple returns — a buy-and-hold approximation, <strong>not</strong> a
              flow-adjusted result. It ignores the timing of your actual deposits, withdrawals, and trades, so
              it will differ from your realized performance; for the authoritative time-weighted return see the
              Dashboard. Returns annualize with {TRADING_DAYS} trading days.
            </p>
            <p>
              Excess return is the gap between the two cumulative-return curves at the end of the window. Beta
              is cov(portfolio, SPY) / var(SPY), and alpha is Jensen&apos;s alpha — the portfolio&apos;s
              annualized return minus its CAPM-expected return at a {(RF * 100).toFixed(1)}% risk-free rate.
              Tracking error is the annualized standard deviation of the daily portfolio-minus-SPY difference,
              and the information ratio divides annualized excess return by it. Up/down capture compares the
              portfolio&apos;s average return to SPY&apos;s on the days SPY closed up (or down); they read as
              &quot;—&quot; when the window has no such days. Not modeled: dividends beyond what price returns
              capture, transaction costs and taxes, intraday risk, or any change in weights over the window.
            </p>
          </MethodologyNote>
        </div>
      )}
    </ToolShell>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-4">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: CHART.muted }}>
          <span className="h-2 w-4 rounded-full" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
