"use client";

import { Sensitive } from "@/lib/privacy";
import { formatPercent } from "@/lib/format";
import { mcPercentile, probAbove, type McRun } from "@/lib/analytics";
import { CHART, Histogram } from "../charts";
import { Panel } from "../ui";

/* Risk views the old tool had no answer for: how deep does the ride get, what
   does the spread of outcomes actually look like, and how much of the reported
   number is simulation noise. */

const DD_THRESHOLDS = [0.1, 0.2, 0.3, 0.5];

/** Fraction of paths whose worst drawdown was at least `depth` (a positive
    fraction). `maxDrawdowns` is sorted ascending, i.e. worst first. */
function fractionWorseThan(sorted: Float64Array, depth: number): number {
  // Count entries ≤ −depth. probAbove counts ≥, so flip the comparison.
  return 1 - probAbove(sorted, -depth);
}

export function DrawdownPanel({ run }: { run: McRun }) {
  const median = mcPercentile(run.maxDrawdowns, 0.5);
  const p95 = mcPercentile(run.maxDrawdowns, 0.05);
  const worst = run.maxDrawdowns[0];

  return (
    <Panel title="Worst drawdown along the way">
      <div className="mb-3 grid grid-cols-3 gap-3">
        <Tile label="Typical path" value={formatPercent(median * 100)} tone="negative" sub="median max drawdown" />
        <Tile label="Rough path" value={formatPercent(p95 * 100)} tone="negative" sub="1-in-20 worst" />
        <Tile label="Worst path" value={formatPercent(worst * 100)} tone="negative" sub={`of ${run.paths.toLocaleString()}`} />
      </div>

      <Histogram
        sorted={run.maxDrawdowns}
        height={150}
        color={CHART.negative}
        clipAt={1}
        xFormat={(v) => `${(v * 100).toFixed(0)}%`}
        markers={[{ value: median, color: CHART.amber, label: "median" }]}
      />

      <div className="mt-3 flex flex-col gap-1.5">
        {DD_THRESHOLDS.map((d) => {
          const f = fractionWorseThan(run.maxDrawdowns, d);
          return (
            <div key={d} className="flex items-center gap-3">
              <span className="w-[132px] shrink-0 text-[11.5px]" style={{ color: CHART.muted }}>
                Ever down {(d * 100).toFixed(0)}%+
              </span>
              <div className="relative h-[14px] flex-1 overflow-hidden rounded-[3px] bg-[oklch(0.16_0_0)]">
                <div className="absolute left-0 top-0 h-full rounded-[3px]" style={{ background: CHART.negative, width: `${f * 100}%` }} />
              </div>
              <span className="w-[46px] shrink-0 text-right font-mono text-[11.5px] tabular-nums text-foreground">
                {(f * 100).toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2.5 text-[11px] leading-relaxed" style={{ color: CHART.muted }}>
        Peak-to-trough decline measured on every day of every path, not just the sampled ones. This is the number that
        decides whether a plan gets abandoned halfway.
      </p>
    </Panel>
  );
}

const PERCENTILES = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99];

export function TerminalPanel({
  run,
  goal,
  format,
  startValue,
}: {
  run: McRun;
  goal: number;
  format: (n: number) => string;
  startValue: number;
}) {
  const median = run.median;
  return (
    <Panel title="Where it all ends up">
      <Histogram
        sorted={run.terminal}
        height={160}
        color={CHART.amber}
        xFormat={format}
        markers={[
          { value: median, color: CHART.steel, label: "median" },
          ...(goal > 0 ? [{ value: goal, color: CHART.positive, label: "goal" }] : []),
        ]}
      />
      <p className="mt-1.5 text-[11px]" style={{ color: CHART.muted }}>
        Top 1% of outcomes clipped so the bulk stays readable — compounding produces a very long right tail.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr style={{ color: CHART.muted }}>
              <th className="pb-1.5 text-left font-normal">Percentile</th>
              <th className="pb-1.5 text-right font-normal">Value</th>
              <th className="pb-1.5 text-right font-normal">vs start</th>
              <th className="pb-1.5 text-right font-normal">± MC error</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {PERCENTILES.map((q) => {
              const v = mcPercentile(run.terminal, q);
              const se = quantileSe(run, q);
              const mult = startValue > 0 ? v / startValue : 0;
              return (
                <tr key={q} className={q === 0.5 ? "text-foreground" : ""} style={q === 0.5 ? undefined : { color: "oklch(0.78 0.006 74)" }}>
                  <td className="py-[3px] text-left">P{(q * 100).toFixed(0).padStart(2, "0")}</td>
                  <td className="py-[3px] text-right">
                    <Sensitive>{format(v)}</Sensitive>
                  </td>
                  <td className="py-[3px] text-right" style={{ color: mult >= 1 ? CHART.positive : CHART.negative }}>
                    {mult.toFixed(2)}×
                  </td>
                  <td className="py-[3px] text-right" style={{ color: CHART.muted }}>
                    {se > 0 ? `±${format(se)}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed" style={{ color: CHART.muted }}>
        MC error is the sampling uncertainty of the percentile itself at {run.paths.toLocaleString()} paths — how much
        it would move on a re-run with a different seed. Raise the path count to shrink it; it falls as √paths.
      </p>
    </Panel>
  );
}

/** Standard error of a terminal percentile, re-derived here so the panel can
    show it per row without the engine returning nine extra numbers. */
function quantileSe(run: McRun, q: number): number {
  const n = run.terminal.length;
  if (n < 20) return 0;
  const h = Math.min(0.05, Math.max(1.5 / n, 0.005));
  const lo = mcPercentile(run.terminal, Math.max(0, q - h));
  const hi = mcPercentile(run.terminal, Math.min(1, q + h));
  const width = Math.min(1, q + h) - Math.max(0, q - h);
  if (hi - lo <= 0 || width <= 0) return 0;
  return Math.sqrt((q * (1 - q)) / n) * ((hi - lo) / width);
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "negative" }) {
  return (
    <div className="rounded-sm border border-border bg-[oklch(0.10_0_0)] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.07em]" style={{ color: CHART.muted }}>
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[15px] tabular-nums" style={{ color: tone === "negative" ? CHART.negative : undefined }}>
        {value}
      </div>
      <div className="text-[10.5px]" style={{ color: CHART.muted }}>
        {sub}
      </div>
    </div>
  );
}
