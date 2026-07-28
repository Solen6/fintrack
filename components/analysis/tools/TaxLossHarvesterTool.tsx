"use client";

import { useMemo, useState } from "react";
import { formatCurrency, formatPercent, formatShares } from "@/lib/format";
import type { AnalysisHistoryResponse } from "@/lib/analytics/api-types";
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
import { CHART } from "../charts";
import { Sensitive } from "@/lib/privacy";

const YEAR_MS = 365 * 86_400_000;
const MONTH_MS = 30 * 86_400_000;

export function TaxLossHarvesterTool() {
  const { data, loading, error, retry } =
    useAnalysisData<AnalysisHistoryResponse>("/api/analysis/history?days=365");

  // Assumed marginal tax rates (percent), user-editable.
  const [shortRate, setShortRate] = useState(35);
  const [longRate, setLongRate] = useState(15);

  const model = useMemo(() => {
    if (!data || data.empty || data.assets.length === 0) return null;
    const now = Date.now();

    const losers = data.assets
      .filter((a) => a.unrealizedPL < 0)
      .map((a) => {
        const ageMs = a.acquiredAt
          ? now - new Date(a.acquiredAt + "T00:00:00Z").getTime()
          : null;
        const isLong = ageMs != null ? ageMs >= YEAR_MS : true;
        const rate = (isLong ? longRate : shortRate) / 100;
        const loss = -a.unrealizedPL; // positive dollars of realizable loss
        const taxSaved = -a.unrealizedPL * rate;
        const washRisk = ageMs != null ? ageMs <= MONTH_MS : false;
        return {
          ticker: a.ticker,
          shares: a.shares,
          costBasis: a.costBasis,
          lastClose: a.lastClose,
          unrealizedPL: a.unrealizedPL,
          unrealizedPct: a.unrealizedPct,
          isLong,
          loss,
          taxSaved,
          washRisk,
        };
      })
      .sort((x, y) => y.loss - x.loss);

    const totalLoss = losers.reduce((s, l) => s + l.loss, 0);
    const totalTaxSaved = losers.reduce((s, l) => s + l.taxSaved, 0);
    const stCount = losers.filter((l) => !l.isLong).length;
    const ltCount = losers.filter((l) => l.isLong).length;

    return {
      losers,
      totalLoss,
      totalTaxSaved,
      count: losers.length,
      stCount,
      ltCount,
      totalHoldings: data.assets.length,
    };
  }, [data, shortRate, longRate]);

  return (
    <ToolShell
      category="Tax"
      title="Tax-Loss Harvester"
      subtitle="Holdings sitting below cost, ranked by the loss you could realize now to offset gains — with the estimated tax saved at your assumed rates."
      asOf={data?.asOf}
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={retry} />
      ) : !model ? (
        <EmptyBlock
          title="No priceable holdings to scan for tax-loss harvesting."
          hint="This tool needs equity or ETF positions with a cost basis. Cash accounts, options, futures, and individual bonds are excluded."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Toolbar — assumed marginal tax rates */}
          <div className="flex flex-wrap items-end gap-5 rounded-md border border-border bg-card p-4">
            <RateInput label="Short-term %" value={shortRate} onChange={setShortRate} />
            <RateInput label="Long-term %" value={longRate} onChange={setLongRate} />
            <p className="m-0 ml-auto max-w-[40ch] text-[11.5px] leading-relaxed text-muted-foreground">
              Enter your assumed marginal rates. Short-term applies to lots held under a year, long-term to
              those held a year or more.
            </p>
          </div>

          <StatRow>
            <Stat
              label="Harvestable loss"
              value={<Sensitive>{formatCurrency(model.totalLoss)}</Sensitive>}
              tone={model.count > 0 ? "negative" : "default"}
              sub="unrealized losses, summed"
            />
            <Stat
              label="Est. tax saved"
              value={<Sensitive>{formatCurrency(model.totalTaxSaved)}</Sensitive>}
              tone={model.totalTaxSaved > 0 ? "positive" : "default"}
              sub="loss × your assumed rate"
            />
            <Stat
              label="Positions underwater"
              value={model.count.toString()}
              sub={`of ${model.totalHoldings} holdings`}
            />
            <Stat
              label="Short / Long"
              value={`${model.stCount} / ${model.ltCount}`}
              sub="ST / LT losers"
            />
          </StatRow>

          <Panel title="Underwater positions">
            {model.count === 0 ? (
              <p className="px-5 py-8 text-center text-[12.5px] text-muted-foreground">
                Nothing is underwater — none of your holdings are currently showing an unrealized loss, so
                there is nothing to harvest right now.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-[12.5px]">
                  <thead>
                    <tr className="text-left" style={{ color: CHART.muted }}>
                      <th className="pb-2 font-medium">Ticker</th>
                      <th className="pb-2 text-right font-medium">Shares</th>
                      <th className="pb-2 text-right font-medium">Cost</th>
                      <th className="pb-2 text-right font-medium">Price</th>
                      <th className="pb-2 text-right font-medium">Unrealized</th>
                      <th className="pb-2 text-right font-medium">Unrealized %</th>
                      <th className="pb-2 text-center font-medium">Term</th>
                      <th className="pb-2 text-right font-medium">Est. tax saved</th>
                      <th className="pb-2 text-center font-medium">Wash-sale</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {model.losers.map((l) => (
                      <tr key={l.ticker} className="border-t border-border">
                        <td className="py-1.5 font-sans font-medium">{l.ticker}</td>
                        <td className="py-1.5 text-right">{formatShares(l.shares)}</td>
                        <td className="py-1.5 text-right">
                          <Sensitive>{formatCurrency(l.costBasis)}</Sensitive>
                        </td>
                        <td className="py-1.5 text-right">
                          <Sensitive>{formatCurrency(l.lastClose)}</Sensitive>
                        </td>
                        <td className="py-1.5 text-right" style={{ color: CHART.negative }}>
                          <Sensitive>{formatCurrency(l.unrealizedPL)}</Sensitive>
                        </td>
                        <td className="py-1.5 text-right" style={{ color: CHART.negative }}>
                          {formatPercent(l.unrealizedPct * 100)}
                        </td>
                        <td className="py-1.5 text-center" style={{ color: CHART.muted }}>
                          {l.isLong ? "LT" : "ST"}
                        </td>
                        <td className="py-1.5 text-right" style={{ color: CHART.positive }}>
                          <Sensitive>{formatCurrency(l.taxSaved)}</Sensitive>
                        </td>
                        <td className="py-1.5 text-center font-sans">
                          {l.washRisk ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[10.5px] font-medium"
                              style={{ background: "oklch(0.66 0.19 25 / 0.14)", color: CHART.negative }}
                            >
                              ⚠ Risk
                            </span>
                          ) : (
                            <span style={{ color: CHART.muted }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <MethodologyNote>
            <p>
              This is a <strong>position-level</strong> view using each holding&apos;s share-weighted average
              cost basis — it is <strong>not</strong> lot-level. A position with some lots up and some lots
              down nets to a single figure here and can&apos;t be split into its individual tax lots, so the
              real harvestable loss can differ from what your broker would let you sell lot by lot.
            </p>
            <p>
              Holding term is inferred from the most recent acquisition date: on or after 365 days is treated
              as long-term, otherwise short-term; a missing acquisition date is assumed long-term. Estimated
              tax saved is simply the unrealized loss × your assumed marginal rate ({longRate.toFixed(0)}%
              long-term, {shortRate.toFixed(0)}% short-term) — it ignores gain offsetting order, the
              $3,000 ordinary-income limit on net capital losses, carryforwards, state taxes, and NIIT.
            </p>
            <p>
              The wash-sale flag is informational: it marks positions added within the last 30 days. The
              actual wash-sale rule disallows a loss when you buy substantially identical securities within
              30 days before or after realizing it — something this tool can&apos;t fully see from position
              snapshots alone. This is not tax advice.
            </p>
          </MethodologyNote>
        </div>
      )}
    </ToolShell>
  );
}

function RateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.08em]" style={{ color: CHART.muted }}>
        {label}
      </span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          onChange(Number.isFinite(v) ? v : 0);
        }}
        aria-label={label}
        className="w-[110px] rounded-sm border border-border bg-background px-3 py-1.5 font-mono text-[13px] tabular-nums text-foreground outline-none transition-[border-color] duration-150 focus:border-[oklch(0.72_0.14_74_/_0.5)]"
      />
    </label>
  );
}
