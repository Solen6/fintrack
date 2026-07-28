"use client";

import { useMemo } from "react";
import { formatCurrencyCompact, formatPercent } from "@/lib/format";
import type { AnalysisHistoryResponse } from "@/lib/analytics/api-types";
import { herfindahl } from "@/lib/analytics";
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

const TOP_N = 12; // largest positions shown individually before rolling up "Others"

export function ConcentrationTool() {
  const { data, loading, error, retry } = useAnalysisData<AnalysisHistoryResponse>(
    "/api/analysis/history?days=365",
  );

  const model = useMemo(() => {
    if (!data || data.empty || data.assets.length === 0) return null;
    const assets = data.assets;

    // Denominators. Invested value drives sector shares; +cash drives the mix.
    const investedValue = assets.reduce((s, a) => s + a.value, 0);
    if (investedValue <= 0) return null;
    const cash = data.cash;
    const totalWithCash = data.riskyValue + cash;
    const cashWeight = totalWithCash > 0 ? cash / totalWithCash : 0;

    // Concentration of the invested (non-cash) sleeve.
    const hhi = herfindahl(assets.map((a) => a.value));
    const effectiveN = hhi > 0 ? 1 / hhi : assets.length;

    // Positions ranked by their share of the whole portfolio (cash included).
    const ranked = [...assets].sort((x, y) => y.weightWithCash - x.weightWithCash);
    const largest = ranked[0];
    if (!largest) return null;
    const top5 = ranked.slice(0, 5).reduce((s, a) => s + a.weightWithCash, 0);

    const shown = ranked.slice(0, TOP_N);
    const rest = ranked.slice(TOP_N);
    const positions: {
      label: string;
      weight: number; // percent
      dollars: number;
      kind: "asset" | "others" | "cash";
    }[] = shown.map((a) => ({
      label: a.ticker,
      weight: a.weightWithCash * 100,
      dollars: a.value,
      kind: "asset",
    }));
    if (rest.length > 0) {
      positions.push({
        label: `Others (${rest.length})`,
        weight: rest.reduce((s, a) => s + a.weightWithCash, 0) * 100,
        dollars: rest.reduce((s, a) => s + a.value, 0),
        kind: "others",
      });
    }
    if (cash > 0) {
      positions.push({ label: "Cash", weight: cashWeight * 100, dollars: cash, kind: "cash" });
    }

    // Sector rollup (invested sleeve only — cash is not a holding).
    const sectorMap = new Map<string, number>();
    for (const a of assets) {
      const sec = a.sector || "Unclassified";
      sectorMap.set(sec, (sectorMap.get(sec) ?? 0) + a.value);
    }
    const sectorEntries = [...sectorMap.entries()].sort((x, y) => y[1] - x[1]);
    const sectorHHI = herfindahl(sectorEntries.map(([, v]) => v));
    const sectors = sectorEntries.map(([label, v]) => ({
      label,
      weight: (v / investedValue) * 100,
      dollars: v,
    }));

    return {
      hhi,
      effectiveN,
      top5: top5 * 100,
      cashWeight: cashWeight * 100,
      cash,
      sectorHHI,
      largest: { ticker: largest.ticker, weight: largest.weightWithCash * 100 },
      holdings: assets.length,
      sectorCount: sectorEntries.length,
      positions,
      sectors,
    };
  }, [data]);

  return (
    <ToolShell
      category="Risk"
      title="Concentration"
      subtitle="How much of the portfolio rides on your largest positions and sectors — measured by top-5 weight, Herfindahl concentration, and the effective number of holdings."
      asOf={data?.asOf}
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={retry} />
      ) : !model ? (
        <EmptyBlock
          title="No priceable holdings to measure concentration."
          hint="Concentration needs at least one equity or ETF position with a market value. Cash-only accounts, options, futures, and individual bonds don't appear here."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <StatRow>
            <Stat
              label="Top 5 weight"
              value={formatPercent(model.top5, false)}
              sub="of the whole portfolio"
            />
            <Stat label="HHI" value={model.hhi.toFixed(3)} sub="0 = diffuse · 1 = one name" />
            <Stat
              label="Effective positions"
              value={model.effectiveN.toFixed(1)}
              sub={`across ${model.holdings} holdings`}
            />
            <Stat
              label="Largest position"
              value={model.largest.ticker}
              sub={`${formatPercent(model.largest.weight, false)} of portfolio`}
            />
            <Stat
              label="Cash"
              value={formatPercent(model.cashWeight, false)}
              sub={<Sensitive>{formatCurrencyCompact(model.cash)}</Sensitive>}
            />
            <Stat label="Sector HHI" value={model.sectorHHI.toFixed(3)} sub={`${model.sectorCount} sectors`} />
          </StatRow>

          <Panel title="By position">
            <HBarList
              formatValue={(v) => v.toFixed(1) + "%"}
              items={model.positions.map((p) => ({
                label: p.label,
                value: p.weight,
                color:
                  p.kind === "cash" ? CHART.steel : p.kind === "others" ? CHART.muted : CHART.amber,
                sub: <Sensitive>{formatCurrencyCompact(p.dollars)}</Sensitive>,
              }))}
            />
          </Panel>

          <Panel title="By sector">
            <HBarList
              formatValue={(v) => v.toFixed(1) + "%"}
              items={model.sectors.map((s) => ({
                label: s.label,
                value: s.weight,
                sub: <Sensitive>{formatCurrencyCompact(s.dollars)}</Sensitive>,
              }))}
            />
          </Panel>

          <MethodologyNote>
            <p>
              Snapshot as of the latest close. The Herfindahl-Hirschman Index (HHI) is Σ(weightᵢ²) over
              your invested (non-cash) holdings, where each weight is a holding&apos;s market value ÷ total
              invested value using absolute weights. It runs from ~0 (perfectly diffuse) to 1 (a single
              name). Effective positions = 1/HHI — the number of equal-sized holdings that would carry the
              same concentration. Top 5 weight sums the five largest positions&apos; weights of the whole
              portfolio, cash included; cash is shown as its own slice in the position mix, with weight =
              cash ÷ (invested value + cash). Sectors group each holding&apos;s sector field, and Sector HHI
              applies the same formula to sector value totals (invested sleeve only).
            </p>
            <p>
              Limitations: HHI is a count-based measure, not a risk-based one — it treats every ticker as
              independent and does <em>not</em> account for correlation, so two names that move together (or
              an ETF that overlaps your single-stock holdings) look more diversified than they are.
              Look-through is not modeled: a multi-sector company or a broad ETF is counted whole under one
              sector tag, which can over- or understate true sector exposure, and sector labels come from a
              single per-holding provider tag that can be coarse or misclassified. Only priceable equity and
              ETF positions are included; options, futures, and individual bonds are excluded, and leverage
              or short exposure is not reflected. Weights drift with prices, so this is a point-in-time view.
            </p>
          </MethodologyNote>
        </div>
      )}
    </ToolShell>
  );
}
