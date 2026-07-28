"use client";

import { useMemo } from "react";
import { formatCurrencyCompact, formatPercent } from "@/lib/format";
import type { AnalysisHistoryResponse } from "@/lib/analytics/api-types";
import { portfolioReturns, beta, mean, stdev } from "@/lib/analytics";
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
import { HBarList, CHART } from "../charts";
import { Sensitive } from "@/lib/privacy";

/** Instantaneous S&P moves to translate through portfolio beta. */
const MARKET_SHOCKS = [-0.3, -0.2, -0.1, 0.1] as const;

interface Scenario {
  label: string;
  /** Portfolio return under the scenario, as a fraction (−0.22 = −22%). */
  pct: number;
}

export function StressTestTool() {
  const { data, loading, error, retry } =
    useAnalysisData<AnalysisHistoryResponse>("/api/analysis/history?days=730");

  const model = useMemo(() => {
    if (!data || data.empty || data.assets.length === 0) return null;
    const assets = data.assets;
    const matrix = assets.map((a) => data.returns[a.ticker]);
    const weights = assets.map((a) => a.weight);
    const port = portfolioReturns(matrix, weights);
    const bench = data.benchmark.returns;
    if (port.length < 20) return null;

    const portBeta = beta(port, bench);
    const riskyValue = data.riskyValue;

    // Beta-based market shocks, applied to the invested sleeve.
    const marketScenarios: Scenario[] = MARKET_SHOCKS.map((shock) => ({
      label: `S&P ${shock < 0 ? "−" : "+"}${Math.abs(shock * 100).toFixed(0)}%`,
      pct: portBeta * shock,
    }));

    // Historical shocks from our own 2y daily return series.
    const worstDay = Math.min(...port);

    const win = Math.min(21, port.length);
    let worstMonth = Infinity;
    for (let i = 0; i + win <= port.length; i++) {
      let growth = 1;
      for (let j = i; j < i + win; j++) growth *= 1 + port[j];
      worstMonth = Math.min(worstMonth, growth - 1);
    }

    const twoSigmaDay = mean(port) - 2 * stdev(port);

    const historicalScenarios: Scenario[] = [
      { label: "Worst month (2y)", pct: worstMonth },
      { label: "Worst day (2y)", pct: worstDay },
      { label: "2σ down day", pct: twoSigmaDay },
    ];

    // Most damaging first, so the worst case reads at the top.
    const scenarios = [...marketScenarios, ...historicalScenarios].sort(
      (a, b) => a.pct - b.pct,
    );

    return {
      portBeta,
      riskyValue,
      worstDay,
      worstMonth,
      sp20: portBeta * -0.2,
      scenarios,
      years: (data.dates.length / 252).toFixed(1),
    };
  }, [data]);

  return (
    <ToolShell
      category="Risk"
      title="Stress Test"
      subtitle="Shock the book against market crashes and your own worst historical days, and see the damage in dollars before it happens."
      asOf={data?.asOf}
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={retry} />
      ) : !model ? (
        <EmptyBlock
          title="Not enough price history to stress test."
          hint="Stress tests need equity or ETF holdings with at least a few months of history. Cash, options, futures, and individual bonds are excluded."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <StatRow>
            <Stat
              label="Portfolio beta"
              value={model.portBeta.toFixed(2)}
              sub={model.portBeta > 1 ? "amplifies market moves" : "dampens market moves"}
            />
            <Stat
              label="S&P −20% →"
              value={formatPercent(model.sp20 * 100, false)}
              tone="negative"
              sub={<Sensitive>{formatCurrencyCompact(model.sp20 * model.riskyValue)}</Sensitive>}
            />
            <Stat
              label="Worst day (2y)"
              value={formatPercent(model.worstDay * 100, false)}
              tone="negative"
              sub={<Sensitive>{formatCurrencyCompact(model.worstDay * model.riskyValue)}</Sensitive>}
            />
            <Stat
              label="Worst month (2y)"
              value={formatPercent(model.worstMonth * 100, false)}
              tone="negative"
              sub={<Sensitive>{formatCurrencyCompact(model.worstMonth * model.riskyValue)}</Sensitive>}
            />
          </StatRow>

          <Panel title="Scenarios">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px] text-[12.5px]">
                <thead>
                  <tr className="text-left" style={{ color: CHART.muted }}>
                    <th className="pb-2 font-medium">Scenario</th>
                    <th className="pb-2 text-right font-medium">Portfolio return</th>
                    <th className="pb-2 text-right font-medium">Impact</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {model.scenarios.map((s) => {
                    const color = s.pct < 0 ? CHART.negative : CHART.amber;
                    return (
                      <tr key={s.label} className="border-t border-border">
                        <td className="py-1.5 font-sans font-medium">{s.label}</td>
                        <td className="py-1.5 text-right" style={{ color }}>
                          {formatPercent(s.pct * 100)}
                        </td>
                        <td className="py-1.5 text-right" style={{ color }}>
                          <Sensitive>{formatCurrencyCompact(s.pct * model.riskyValue)}</Sensitive>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[11.5px]" style={{ color: CHART.muted }}>
              Impact is the scenario return applied to the invested sleeve only — cash is not shocked.
            </p>
          </Panel>

          <Panel title="Impact by scenario (% of invested sleeve)">
            <HBarList
              signed
              items={model.scenarios.map((s) => ({
                label: s.label,
                value: s.pct * 100,
                color: s.pct < 0 ? CHART.negative : CHART.amber,
              }))}
              formatValue={(n) => formatPercent(n)}
            />
          </Panel>

          <MethodologyNote>
            <p>
              Your portfolio&apos;s daily return series is rebuilt from ~{model.years} years of daily
              closes for your equity and ETF holdings, weighted by current market value within the
              invested (non-cash) sleeve. Portfolio beta is cov(portfolio, SPY) / var(SPY). Each market
              scenario translates an instantaneous S&amp;P move through that beta (return ≈ beta × shock)
              and applies it to the invested sleeve; the dollar impact is that percentage times your
              risky value. Because cash is not shocked, the hit to your <em>total</em> account is smaller
              than the figures shown. &quot;Worst day&quot; and &quot;Worst month&quot; are the minimum
              single-day and worst rolling 21-trading-day compounded returns actually observed in your 2-year
              series; &quot;2σ down day&quot; is the mean daily return minus two standard deviations.
            </p>
            <p>
              Limitations: beta is assumed stable and linear, but in real crashes correlations and beta
              tend to rise, so beta-based estimates can understate losses. Historical worst day/month only
              reflect what happened inside this two-year window, not tail events outside it. This does{" "}
              <strong>not</strong> model interest-rate, credit, currency, commodity, or sector-specific
              factor shocks, nor liquidity — no factor data is wired up for that yet. Cash, options,
              futures, and individual bonds are excluded from the return series.
            </p>
          </MethodologyNote>
        </div>
      )}
    </ToolShell>
  );
}
