"use client";

import { useMemo } from "react";
import { formatCurrencyCompact, formatPercent } from "@/lib/format";
import { usePrivacy, MONEY_MASK } from "@/lib/privacy";
import type { AnalysisHistoryResponse } from "@/lib/analytics/api-types";
import {
  portfolioReturns,
  annualizedVol,
  annualizedGeoReturn,
  sharpe,
  sortino,
  beta,
  maxDrawdownFromReturns,
  equityCurve,
  historicalVaR,
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

export function RiskMetricsTool() {
  const { data, loading, error, retry } =
    useAnalysisData<AnalysisHistoryResponse>("/api/analysis/history?days=730");
  const { hidden } = usePrivacy();

  const model = useMemo(() => {
    if (!data || data.empty || data.assets.length === 0) return null;
    const assets = data.assets;
    const matrix = assets.map((a) => data.returns[a.ticker]);
    const weights = assets.map((a) => a.weight);
    const port = portfolioReturns(matrix, weights);
    const bench = data.benchmark.returns;
    if (port.length < 20) return null;

    const eq = equityCurve(port, 1);
    const benchEq = equityCurve(bench, 1);
    let peak = eq[0];
    const underwater = eq.map((v) => {
      if (v > peak) peak = v;
      return (v / peak - 1) * 100;
    });

    const perHolding = assets
      .map((a) => ({
        ticker: a.ticker,
        weight: a.weight,
        beta: beta(data.returns[a.ticker], bench),
        vol: annualizedVol(data.returns[a.ticker]),
        ret: annualizedGeoReturn(data.returns[a.ticker]),
      }))
      .sort((x, y) => y.weight - x.weight);

    return {
      eq,
      benchEq,
      underwater,
      perHolding,
      annRet: annualizedGeoReturn(port),
      vol: annualizedVol(port),
      sharpe: sharpe(port, RF),
      sortino: sortino(port, RF),
      beta: beta(port, bench),
      maxDD: maxDrawdownFromReturns(port).maxDrawdown,
      var95: historicalVaR(port, 0.95).var,
      benchRet: annualizedGeoReturn(bench),
      benchVol: annualizedVol(bench),
      years: (data.dates.length / 252).toFixed(1),
    };
  }, [data]);

  return (
    <ToolShell
      category="Risk"
      title="Risk Metrics"
      subtitle="The portfolio's risk-adjusted ride quality — market sensitivity, volatility, reward-per-risk, and the deepest drawdown you'd have sat through."
      asOf={data?.asOf}
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={retry} />
      ) : !model ? (
        <EmptyBlock
          title="Not enough price history to compute risk metrics."
          hint="Risk metrics need equity or ETF holdings with at least a few months of history. Options, futures, and individual bonds are excluded."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <StatRow>
            <Stat label="Beta vs SPY" value={model.beta.toFixed(2)} sub={model.beta > 1 ? "more volatile than market" : "less volatile than market"} />
            <Stat label="Volatility (ann.)" value={formatPercent(model.vol * 100, false)} sub={`SPY ${formatPercent(model.benchVol * 100, false)}`} />
            <Stat label="Sharpe" value={model.sharpe.toFixed(2)} tone={model.sharpe >= 1 ? "positive" : "default"} sub="return per unit of risk" />
            <Stat label="Sortino" value={model.sortino.toFixed(2)} tone={model.sortino >= 1 ? "positive" : "default"} sub="downside-only risk" />
            <Stat label="Max drawdown" value={formatPercent(model.maxDD * 100, false)} tone="negative" sub={`over ${model.years}y`} />
            <Stat label="1-day VaR 95%" value={formatPercent(-model.var95 * 100, false)} tone="negative" sub="worst day in 20" />
          </StatRow>

          <Panel title={`Growth of $10,000 · ${model.years}y`}>
            <LineChart
              height={250}
              yFormat={(n) => (hidden ? MONEY_MASK : formatCurrencyCompact(n))}
              series={[
                { name: "Portfolio", color: CHART.amber, values: model.eq.map((v) => v * 10000), fill: CHART.amberFill },
                { name: "SPY", color: CHART.steel, values: model.benchEq.map((v) => v * 10000), dashed: true },
              ]}
            />
            <Legend items={[{ label: "Portfolio", color: CHART.amber }, { label: "SPY", color: CHART.steel }]} />
          </Panel>

          <Panel title="Drawdown (underwater)">
            <LineChart
              height={180}
              baseline={0}
              showEndDot={false}
              yFormat={(n) => `${n.toFixed(0)}%`}
              series={[{ name: "Drawdown", color: CHART.negative, values: model.underwater, fill: "oklch(0.66 0.19 25 / 0.12)" }]}
            />
          </Panel>

          <Panel title="By holding">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px] text-[12.5px]">
                <thead>
                  <tr className="text-left" style={{ color: CHART.muted }}>
                    <th className="pb-2 font-medium">Ticker</th>
                    <th className="pb-2 text-right font-medium">Weight</th>
                    <th className="pb-2 text-right font-medium">Beta</th>
                    <th className="pb-2 text-right font-medium">Vol (ann.)</th>
                    <th className="pb-2 text-right font-medium">Return (ann.)</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {model.perHolding.map((h) => (
                    <tr key={h.ticker} className="border-t border-border">
                      <td className="py-1.5 font-sans font-medium">{h.ticker}</td>
                      <td className="py-1.5 text-right">{formatPercent(h.weight * 100, false)}</td>
                      <td className="py-1.5 text-right">{h.beta.toFixed(2)}</td>
                      <td className="py-1.5 text-right">{formatPercent(h.vol * 100, false)}</td>
                      <td className="py-1.5 text-right" style={{ color: h.ret >= 0 ? CHART.positive : CHART.negative }}>
                        {formatPercent(h.ret * 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <MethodologyNote>
            <p>
              Computed from ~{model.years} years of daily closes for your equity and ETF holdings,
              weighted by current market value within the invested (non-cash) sleeve. Returns are simple
              daily returns; volatility and beta are annualized with 252 trading days.
            </p>
            <p>
              Beta is cov(portfolio, SPY) / var(SPY). Sharpe and Sortino use a {(RF * 100).toFixed(1)}%
              risk-free rate over the annualized return; Sortino divides by downside deviation only. Max
              drawdown is the deepest peak-to-trough decline of the growth curve. 1-day VaR 95% is the
              historical 5th-percentile daily loss. Cash, options, futures, and individual bonds are excluded.
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
