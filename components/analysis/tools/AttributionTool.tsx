"use client";

import { useCallback, useMemo } from "react";
import { formatPercent } from "@/lib/format";
import type { AnalysisHistoryResponse } from "@/lib/analytics/api-types";
import type { SectorBenchmarkResponse } from "@/app/api/analysis/sector-benchmark/route";
import { normalizeSector } from "@/lib/analytics/sectors-bench";
import { brinsonAttribution, type SectorInput } from "@/lib/analytics";
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

const signColor = (v: number) => (v >= 0 ? CHART.positive : CHART.negative);
const signTone = (v: number): "positive" | "negative" => (v >= 0 ? "positive" : "negative");

export function AttributionTool() {
  const hist = useAnalysisData<AnalysisHistoryResponse>("/api/analysis/history?days=365");
  const bench = useAnalysisData<SectorBenchmarkResponse>("/api/analysis/sector-benchmark?days=365");

  const loading = hist.loading || bench.loading;
  const error = hist.error ?? bench.error;

  const retry = useCallback(() => {
    hist.retry();
    bench.retry();
  }, [hist.retry, bench.retry]);

  const model = useMemo(() => {
    const histData = hist.data;
    const benchData = bench.data;
    if (!histData || histData.empty || histData.assets.length === 0) return null;
    if (!benchData || benchData.sectors.length === 0) return null;

    // Cumulative buy-and-hold return per asset, then roll up into the GICS
    // bucket the holding maps to. Sector portReturn is the weight-weighted mean
    // of its holdings' cumulative returns.
    const groups = new Map<string, { portWeight: number; weightedRet: number }>();
    for (const asset of histData.assets) {
      const rets = histData.returns[asset.ticker] ?? [];
      const cum = rets.reduce((acc, r) => acc * (1 + r), 1) - 1;
      const sec = normalizeSector(asset.sector);
      const g = groups.get(sec) ?? { portWeight: 0, weightedRet: 0 };
      g.portWeight += asset.weight;
      g.weightedRet += asset.weight * cum;
      groups.set(sec, g);
    }
    if (groups.size === 0) return null;

    const benchMap = new Map(benchData.sectors.map((s) => [s.name, s]));
    const spyReturn = benchData.spyReturn;

    const inputs: SectorInput[] = [...groups.entries()].map(([sector, g]) => ({
      sector,
      portWeight: g.portWeight,
      portReturn: g.portWeight > 0 ? g.weightedRet / g.portWeight : 0,
      benchWeight: benchMap.get(sector)?.benchWeight ?? 0,
      benchReturn: benchMap.get(sector)?.benchReturn ?? spyReturn,
    }));

    const res = brinsonAttribution(inputs, spyReturn);
    const sectors = [...res.sectors].sort((a, b) => b.portWeight - a.portWeight);

    return { res, sectors };
  }, [hist.data, bench.data]);

  return (
    <ToolShell
      category="Performance"
      title="Attribution"
      subtitle="Brinson decomposition of your active return versus the S&P 500 — how much came from tilting toward the right sectors (allocation) versus picking the right names inside them (selection)."
      asOf={hist.data?.asOf ?? bench.data?.asOf}
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={retry} />
      ) : !model ? (
        <EmptyBlock
          title="Not enough data to attribute performance."
          hint="Attribution needs priceable equity or ETF holdings with a full year of history plus the sector-benchmark feed. Cash, options, futures, and individual bonds are excluded."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <StatRow>
            <Stat
              label="Active return"
              value={formatPercent(model.res.totals.active * 100)}
              tone={signTone(model.res.totals.active)}
              sub="vs S&P 500"
            />
            <Stat
              label="Allocation effect"
              value={formatPercent(model.res.totals.allocation * 100)}
              tone={signTone(model.res.totals.allocation)}
              sub="sector weighting"
            />
            <Stat
              label="Selection effect"
              value={formatPercent(model.res.totals.selection * 100)}
              tone={signTone(model.res.totals.selection)}
              sub="stock picking"
            />
            <Stat
              label="Interaction"
              value={formatPercent(model.res.totals.interaction * 100)}
              tone={signTone(model.res.totals.interaction)}
              sub="weight × pick"
            />
          </StatRow>

          <Panel title="By sector">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-[12.5px]">
                <thead>
                  <tr className="text-left" style={{ color: CHART.muted }}>
                    <th className="pb-2 font-medium">Sector</th>
                    <th className="pb-2 text-right font-medium">Port wt</th>
                    <th className="pb-2 text-right font-medium">Bench wt</th>
                    <th className="pb-2 text-right font-medium">Port ret</th>
                    <th className="pb-2 text-right font-medium">Bench ret</th>
                    <th className="pb-2 text-right font-medium">Allocation</th>
                    <th className="pb-2 text-right font-medium">Selection</th>
                    <th className="pb-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {model.sectors.map((s) => (
                    <tr key={s.sector} className="border-t border-border">
                      <td className="py-1.5 font-sans font-medium">{s.sector}</td>
                      <td className="py-1.5 text-right">{formatPercent(s.portWeight * 100, false)}</td>
                      <td className="py-1.5 text-right">{formatPercent(s.benchWeight * 100, false)}</td>
                      <td className="py-1.5 text-right" style={{ color: signColor(s.portReturn) }}>
                        {formatPercent(s.portReturn * 100)}
                      </td>
                      <td className="py-1.5 text-right" style={{ color: signColor(s.benchReturn) }}>
                        {formatPercent(s.benchReturn * 100)}
                      </td>
                      <td className="py-1.5 text-right" style={{ color: signColor(s.allocation) }}>
                        {formatPercent(s.allocation * 100)}
                      </td>
                      <td className="py-1.5 text-right" style={{ color: signColor(s.selection) }}>
                        {formatPercent(s.selection * 100)}
                      </td>
                      <td className="py-1.5 text-right font-semibold" style={{ color: signColor(s.total) }}>
                        {formatPercent(s.total * 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Total effect by sector">
            <HBarList
              signed
              formatValue={(n) => formatPercent(n)}
              items={model.sectors.map((s) => ({
                label: s.sector,
                value: s.total * 100,
                color: signColor(s.total),
              }))}
            />
          </Panel>

          <MethodologyNote>
            <p>
              Single-period Brinson-Hood-Beebower attribution. Your active return (portfolio − S&amp;P
              500) is split, per sector, into <strong>allocation</strong> = (wP − wB)·(rB − rBench),{" "}
              <strong>selection</strong> = wB·(rP − rB), and <strong>interaction</strong> = (wP −
              wB)·(rP − rB), which sum to the sector total. Holdings are bucketed into the 11 GICS
              sectors; each sector&apos;s portfolio return is the weight-weighted mean of its
              holdings&apos; buy-and-hold cumulative returns over the trailing 365-day window.
            </p>
            <p>
              The benchmark is the S&amp;P 500 by sector, proxied by the SPDR Select Sector ETFs (XLK,
              XLF, XLV, …) with approximate <em>static</em> index weights that drift over time. Because
              only sectors you actually hold are shown, benchmark weights won&apos;t sum to 1 and the
              per-sector effects won&apos;t fully reconcile to a whole-universe decomposition. Holdings
              that don&apos;t map to a GICS sector fall into &quot;Other&quot; and are benchmarked
              against SPY with zero benchmark weight.
            </p>
            <p>
              Returns are buy-and-hold on current weights — not time-weighted — so intra-period trades,
              cash flows, and the timing of dividends are ignored. This is a directional proxy for where
              performance came from, not official GIPS-compliant attribution.
            </p>
          </MethodologyNote>
        </div>
      )}
    </ToolShell>
  );
}
