"use client";

import { useMemo } from "react";
import type { AnalysisHistoryResponse } from "@/lib/analytics/api-types";
import { correlationMatrix } from "@/lib/analytics";
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
import { HeatGrid, CHART } from "../charts";

const HEATMAP_LIMIT = 12; // heatmap gets crowded past a dozen holdings

export function CorrelationTool() {
  const { data, loading, error, retry } =
    useAnalysisData<AnalysisHistoryResponse>("/api/analysis/history?days=730");

  const model = useMemo(() => {
    if (!data || data.empty || data.assets.length < 2) return null;
    const assets = data.assets;
    const labels = assets.map((a) => a.ticker);
    const matrix = assets.map((a) => data.returns[a.ticker]);

    // Need a meaningful common window of daily returns to trust ρ.
    const obs = matrix[0].length;
    if (obs < 20) return null;

    const corr = correlationMatrix(matrix);
    const n = labels.length;

    // Average off-diagonal ρ and the extreme pairs, over ALL pairs (i < j).
    let sum = 0;
    let count = 0;
    let maxV = -Infinity;
    let minV = Infinity;
    let maxPair: [string, string] = [labels[0], labels[1]];
    let minPair: [string, string] = [labels[0], labels[1]];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const v = corr[i][j];
        sum += v;
        count += 1;
        if (v > maxV) {
          maxV = v;
          maxPair = [labels[i], labels[j]];
        }
        if (v < minV) {
          minV = v;
          minPair = [labels[i], labels[j]];
        }
      }
    }
    const avg = count > 0 ? sum / count : 0;

    // Heatmap truncates to the top-N holdings by weight when the grid gets big.
    // Correlation of a subset is just the sub-matrix of the full ρ matrix.
    const truncated = n > HEATMAP_LIMIT;
    const topIdx = assets
      .map((a, i) => ({ i, weight: a.weight }))
      .sort((x, y) => y.weight - x.weight)
      .slice(0, truncated ? HEATMAP_LIMIT : n)
      .map((o) => o.i);
    const topLabels = topIdx.map((i) => labels[i]);
    const topCorr = topIdx.map((i) => topIdx.map((j) => corr[i][j]));

    return {
      avg,
      maxV,
      minV,
      maxPair,
      minPair,
      n,
      truncated,
      shown: topLabels.length,
      topLabels,
      topCorr,
      years: (data.dates.length / 252).toFixed(1),
    };
  }, [data]);

  return (
    <ToolShell
      category="Risk"
      title="Correlation Matrix"
      subtitle="Which of your holdings actually move together — the hidden overlap that leaves a portfolio less diversified than it looks."
      asOf={data?.asOf}
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={retry} />
      ) : !model ? (
        <EmptyBlock
          title="Not enough overlapping price history to compute correlations."
          hint="Correlations need at least two equity or ETF holdings that share a few months of daily history. Cash, options, futures, and individual bonds are excluded."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <StatRow>
            <Stat
              label="Avg pairwise ρ"
              value={model.avg.toFixed(2)}
              tone={model.avg >= 0.6 ? "negative" : "default"}
              sub={
                model.avg >= 0.6
                  ? "crowded — moves as one"
                  : model.avg >= 0.3
                    ? "moderately diversified"
                    : "well diversified"
              }
            />
            <Stat
              label="Most correlated"
              value={model.maxV.toFixed(2)}
              tone={model.maxV >= 0.8 ? "negative" : "default"}
              sub={`${model.maxPair[0]} · ${model.maxPair[1]}`}
            />
            <Stat
              label="Least correlated"
              value={model.minV.toFixed(2)}
              tone={model.minV <= 0 ? "positive" : "default"}
              sub={`${model.minPair[0]} · ${model.minPair[1]}`}
            />
            <Stat
              label="Holdings"
              value={String(model.n)}
              sub={model.truncated ? `showing top ${model.shown}` : "in matrix"}
            />
          </StatRow>

          <Panel
            title="Correlation matrix"
            right={
              model.truncated ? (
                <span className="font-mono text-[11px] tabular-nums" style={{ color: CHART.muted }}>
                  top {model.shown} of {model.n} by weight
                </span>
              ) : undefined
            }
          >
            <HeatGrid
              labels={model.topLabels}
              matrix={model.topCorr}
              colorFor={(v) =>
                v >= 0
                  ? `oklch(0.72 0.14 74 / ${(0.15 + 0.8 * Math.max(0, v)).toFixed(3)})`
                  : `oklch(0.64 0.07 240 / ${(0.15 + 0.8 * Math.abs(v)).toFixed(3)})`
              }
              cellLabel={(v) => v.toFixed(2)}
            />
            <Legend
              items={[
                { label: "move together (ρ > 0)", color: CHART.amber },
                { label: "move opposite (ρ < 0)", color: CHART.steel },
              ]}
            />
          </Panel>

          <MethodologyNote>
            <p>
              Each cell is the Pearson correlation of two holdings&apos; daily simple
              returns over ~{model.years} years of overlapping closes ({model.n} equity
              and ETF holdings). ρ ranges from −1 (mirror opposites) through 0
              (unrelated) to +1 (move in lockstep). The diagonal is a holding&apos;s
              self-correlation, always 1. &quot;Avg pairwise ρ&quot; is the mean over all{" "}
              {(model.n * (model.n - 1)) / 2} distinct pairs; the extreme-pair tiles and
              that average are computed across every holding.
            </p>
            <p>
              A block of high ρ is false diversification — several positions that surge
              and sink as one, so the portfolio behaves like fewer, larger bets than the
              holdings count suggests.
              {model.truncated
                ? ` The heatmap shows only the top ${model.shown} holdings by weight to stay legible; the statistics above still cover all ${model.n}.`
                : ""}
            </p>
            <p>
              Limitations: correlation is a single number over the whole window — it
              assumes a stable, linear relationship and hides the fact that correlations
              tend to spike toward 1 in a crash, exactly when diversification matters
              most. It is not causation, says nothing about magnitude or beta, and
              excludes cash, options, futures, and individual bonds, which have no daily
              price series here.
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
        <span
          key={it.label}
          className="inline-flex items-center gap-1.5 text-[11.5px]"
          style={{ color: CHART.muted }}
        >
          <span className="h-2 w-4 rounded-full" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
