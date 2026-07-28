"use client";

import { useMemo } from "react";
import { formatPercent } from "@/lib/format";
import type {
  AnalysisFundamentalsResponse,
  AnalysisFundamental,
} from "@/lib/analytics/api-types";
import { mean, stdev } from "@/lib/analytics";
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

interface Holding extends AnalysisFundamental {
  /** Market-value weight within the priced sleeve (sums to 1). */
  weight: number;
}

/** One holding's contribution to a factor: its portfolio weight and the raw
    factor metric. Only holdings that actually have the metric appear here. */
type MetricPoint = { weight: number; x: number };

interface Factor {
  key: string;
  name: string;
  tilt: number;
  lean: string;
}

/**
 * Position-weighted cross-sectional z-score tilt for one factor.
 *
 * The metric is standardized across the holdings that have it —
 * z = (x − mean) / stdev — then the tilt is Σ(weightᵢ × zᵢ) with those weights
 * renormalized to sum to 1. A zero-spread metric (all holdings equal, or a
 * single holding) yields a 0 tilt via the stdev guard, as does no coverage.
 */
function factorTilt(points: MetricPoint[]): number {
  if (points.length === 0) return 0;
  const xs = points.map((p) => p.x);
  const m = mean(xs);
  const sd = stdev(xs, false); // population spread across this holding set
  if (sd === 0) return 0;
  const wSum = points.reduce((s, p) => s + p.weight, 0);
  if (wSum <= 0) return 0;
  return points.reduce((s, p) => s + (p.weight / wSum) * ((p.x - m) / sd), 0);
}

function makeFactor(
  key: string,
  name: string,
  points: MetricPoint[],
  pos: string,
  neg: string,
  flat: string,
): Factor {
  const tilt = factorTilt(points);
  const lean =
    points.length === 0
      ? "no data"
      : tilt > 1e-9
        ? pos
        : tilt < -1e-9
          ? neg
          : flat;
  return { key, name, tilt, lean };
}

export function FactorExposureTool() {
  const { data, loading, error, retry } =
    useAnalysisData<AnalysisFundamentalsResponse>("/api/analysis/fundamentals");

  const model = useMemo(() => {
    if (!data || data.empty || data.fundamentals.length === 0) return null;

    const priced = data.fundamentals.filter((f) => f.value > 0);
    if (priced.length < 3) return null;
    const totalValue = priced.reduce((s, f) => s + f.value, 0);
    if (totalValue <= 0) return null;

    const holdings: Holding[] = priced
      .map((f) => ({ ...f, weight: f.value / totalValue }))
      .sort((a, b) => b.weight - a.weight);

    // Metric point sets — holdings missing a metric are skipped (flatMap emits
    // an empty array), which also narrows the nullable fields to number.
    const valuePts = holdings.flatMap((h) =>
      h.trailingPE != null && h.trailingPE > 0
        ? [{ weight: h.weight, x: 1 / h.trailingPE }]
        : [],
    );
    const sizePts = holdings.flatMap((h) =>
      h.marketCap != null && h.marketCap > 0
        ? [{ weight: h.weight, x: -Math.log(h.marketCap) }]
        : [],
    );
    const momPts = holdings.flatMap((h) =>
      h.range52Pos != null ? [{ weight: h.weight, x: h.range52Pos }] : [],
    );
    const yieldPts: MetricPoint[] = holdings.map((h) => ({
      weight: h.weight,
      x: h.dividendYield ?? 0,
    }));

    const factors: Factor[] = [
      makeFactor("value", "Value", valuePts, "value-tilted", "growth-tilted", "style-neutral"),
      makeFactor("size", "Size", sizePts, "small-cap lean", "large-cap lean", "size-neutral"),
      makeFactor("momentum", "Momentum", momPts, "high-momentum", "low-momentum", "momentum-neutral"),
      makeFactor("yield", "Yield", yieldPts, "income-tilted", "low-yield", "yield-neutral"),
    ];

    return { holdings, factors };
  }, [data]);

  return (
    <ToolShell
      category="Allocation"
      title="Factor Exposure"
      subtitle="The style bets hiding under your tickers — how far your holdings lean toward value, small-cap, momentum, and yield relative to one another."
      asOf={data?.asOf}
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={retry} />
      ) : !model ? (
        <EmptyBlock
          title="Not enough fundamentals to size up factor tilts."
          hint="Factor exposure needs at least three priced equity or ETF holdings with fundamental data. Cash, options, and individual bonds are excluded."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <StatRow>
            {model.factors.map((f) => (
              <Stat key={f.key} label={f.name} value={f.tilt.toFixed(2)} sub={f.lean} />
            ))}
          </StatRow>

          <Panel title="Factor tilts">
            <HBarList
              signed
              formatValue={(v) => v.toFixed(2)}
              items={model.factors.map((f) => ({
                label: f.name,
                value: f.tilt,
                color: f.tilt >= 0 ? CHART.amber : CHART.steel,
              }))}
            />
          </Panel>

          <Panel title="By holding">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px] text-[12.5px]">
                <thead>
                  <tr className="text-left" style={{ color: CHART.muted }}>
                    <th className="pb-2 font-medium">Ticker</th>
                    <th className="pb-2 text-right font-medium">Weight</th>
                    <th className="pb-2 text-right font-medium">P/E</th>
                    <th className="pb-2 text-right font-medium">Div yield</th>
                    <th className="pb-2 text-right font-medium">52w range</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {model.holdings.map((h) => (
                    <tr key={h.ticker} className="border-t border-border">
                      <td className="py-1.5 font-sans font-medium">{h.ticker}</td>
                      <td className="py-1.5 text-right">{formatPercent(h.weight * 100, false)}</td>
                      <td className="py-1.5 text-right">
                        {h.trailingPE != null && h.trailingPE > 0 ? h.trailingPE.toFixed(1) : "—"}
                      </td>
                      <td className="py-1.5 text-right">
                        {h.dividendYield != null ? formatPercent(h.dividendYield * 100, false) : "—"}
                      </td>
                      <td className="py-1.5 text-right">
                        {h.range52Pos != null ? `${(h.range52Pos * 100).toFixed(0)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <MethodologyNote>
            <p>
              This is a <em>proxy</em> factor model, not a professional multi-factor risk
              model. Each holding is scored on four crude stand-ins: Value = earnings yield
              (1 ÷ trailing P/E), Size = −ln(market cap) so smaller companies score higher,
              Momentum = position within the 52-week range, and Yield = dividend yield. A
              holding missing a metric is simply left out of that factor.
            </p>
            <p>
              For each factor the metric is standardized into cross-sectional z-scores across
              your own holdings — z = (value − mean) ÷ stdev — and the tilt is the
              market-value-weighted average of those z-scores (weights renormalized over the
              holdings that have the metric; a factor with no spread or no data reads 0). Because
              the mean and spread come from <em>your</em> portfolio, every tilt is a directional
              read <em>relative to your own holdings</em>, not a market-relative factor loading:
              a positive Value tilt means the portfolio leans cheaper than its own average, not
              cheaper than the market. These single-ratio proxies ignore quality, growth,
              profitability, sector context, and true covariance-based factor risk; treat them as
              a rough style compass, not a risk decomposition.
            </p>
          </MethodologyNote>
        </div>
      )}
    </ToolShell>
  );
}
