"use client";

import { useState } from "react";
import { CHART, ChartTooltip, useMeasure } from "../charts";
import type { McBand } from "@/lib/analytics";

/* ──────────────────────────────────────────────────────────────────────────
   The projection fan: nested percentile bands, optional individual paths, an
   optional benchmark, and a goal line.

   Separate from the shared LineChart because filled bands between paired
   series, a log axis and a spaghetti overlay would contort a primitive that
   eight other tools depend on.
   ────────────────────────────────────────────────────────────────────────── */

export interface FanChartProps {
  bands: McBand[];
  /** Trading-day offset per band, converted to years for the axis. */
  horizonDays: number;
  height?: number;
  format: (n: number) => string;
  /** Individual paths over the same sample days — the fan is smooth, no real
      future is. */
  samplePaths?: number[][];
  /** Median line of a comparison series (a benchmark, or scenario B). */
  compare?: { values: number[]; color: string; label: string } | null;
  goal?: number;
  logScale?: boolean;
  /** Drawn at the starting value so "am I above water" is readable at a glance. */
  startValue?: number;
}

const TRADING_DAYS = 252;

export function FanChart({
  bands,
  horizonDays,
  height = 320,
  format,
  samplePaths = [],
  compare = null,
  goal = 0,
  logScale = false,
  startValue,
}: FanChartProps) {
  const [ref, w] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const padL = 58;
  const padR = 14;
  const padT = 10;
  const padB = 30;
  const innerW = Math.max(0, w - padL - padR);
  const innerH = height - padT - padB;
  const n = bands.length;

  if (n === 0) return <div ref={ref} className="w-full" style={{ height }} />;

  /* A log axis can't show a path that reached zero, which is exactly what
     happens under withdrawals — floor at a small positive value and say so via
     the axis labels rather than dropping the series. */
  const floor = Math.max(1e-9, Math.min(...bands.map((b) => b.p5).filter((v) => v > 0), 1));
  const tx = (v: number) => (logScale ? Math.log(Math.max(floor, v)) : v);

  const candidates = [
    ...bands.map((b) => b.p95),
    ...bands.map((b) => b.p5),
    ...(compare?.values ?? []),
    ...samplePaths.flat(),
    ...(goal > 0 ? [goal] : []),
    ...(startValue != null ? [startValue] : []),
  ].filter((v) => Number.isFinite(v));

  let minV = Math.min(...candidates);
  let maxV = Math.max(...candidates);
  if (logScale) minV = Math.max(floor, minV);
  if (minV === maxV) {
    minV = minV * 0.9 || 0;
    maxV = maxV * 1.1 || 1;
  }
  /* Deliberately NOT forcing zero into the domain. Over a long horizon the
     upside runs to many multiples of the start, so anchoring at zero squashes
     the starting value and the goal line into the bottom pixel — the two
     reference points that make the chart readable. */
  const lo = tx(minV);
  const hi = tx(maxV);
  const pad = (hi - lo) * 0.05;

  const X = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const Y = (v: number) => padT + innerH - ((tx(v) - lo + pad) / (hi - lo + 2 * pad)) * innerH;

  /** Y-axis ticks: even in value space, or per decade-ish in log space. */
  const ticks: number[] = [];
  if (logScale) {
    const decLo = Math.floor(Math.log10(Math.max(1e-9, minV)));
    const decHi = Math.ceil(Math.log10(maxV));
    for (let d = decLo; d <= decHi; d++) {
      for (const m of [1, 2, 5]) {
        const v = m * Math.pow(10, d);
        if (v >= minV && v <= maxV) ticks.push(v);
      }
    }
    if (ticks.length > 8) ticks.splice(0, ticks.length, ...ticks.filter((_, i) => i % 2 === 0));
  } else {
    for (let i = 0; i <= 4; i++) ticks.push(minV + ((maxV - minV) * i) / 4);
  }

  const years = horizonDays / TRADING_DAYS;
  const xTickIdx = [0, Math.floor((n - 1) / 4), Math.floor((n - 1) / 2), Math.floor((3 * (n - 1)) / 4), n - 1];

  const area = (loVals: number[], hiVals: number[]) =>
    `M ${loVals.map((v, i) => `${X(i)},${Y(v)}`).join(" L ")} L ${hiVals
      .map((v, i) => `${X(hiVals.length - 1 - i)},${Y(hiVals[hiVals.length - 1 - i])}`)
      .join(" L ")} Z`;

  const p5 = bands.map((b) => b.p5);
  const p10 = bands.map((b) => b.p10);
  const p25 = bands.map((b) => b.p25);
  const p50 = bands.map((b) => b.p50);
  const p75 = bands.map((b) => b.p75);
  const p90 = bands.map((b) => b.p90);
  const p95 = bands.map((b) => b.p95);

  const hb = hover != null ? bands[hover] : null;

  return (
    <div
      ref={ref}
      className="relative w-full"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (innerW <= 0) return;
        const i = Math.round(((x - padL) / innerW) * (n - 1));
        setHover(i >= 0 && i < n ? i : null);
      }}
      onMouseLeave={() => setHover(null)}
    >
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={`Projected value over ${years.toFixed(0)} years, percentile bands`}>
          {ticks.map((t, i) => (
            <g key={`y${i}`}>
              <line x1={padL} y1={Y(t)} x2={w - padR} y2={Y(t)} stroke={CHART.grid} strokeWidth="1" />
              <text x={padL - 8} y={Y(t) + 3} textAnchor="end" fontSize="10" fontFamily="ui-monospace, monospace" fill={CHART.muted}>
                {format(t)}
              </text>
            </g>
          ))}

          <path d={area(p5, p95)} fill={CHART.muted} opacity={0.13} />
          <path d={area(p10, p90)} fill={CHART.steel} opacity={0.16} />
          <path d={area(p25, p75)} fill={CHART.steel} opacity={0.22} />

          {samplePaths.map((p, i) => (
            <polyline key={`sp${i}`} points={p.map((v, j) => `${X(j)},${Y(v)}`).join(" ")} fill="none" stroke={CHART.amber} strokeWidth="0.8" opacity={0.3} />
          ))}

          {compare && (
            <polyline
              points={compare.values.map((v, i) => `${X(i)},${Y(v)}`).join(" ")}
              fill="none"
              stroke={compare.color}
              strokeWidth="1.75"
              strokeDasharray="5 4"
              strokeLinejoin="round"
            />
          )}

          <polyline points={p50.map((v, i) => `${X(i)},${Y(v)}`).join(" ")} fill="none" stroke={CHART.amber} strokeWidth="2" strokeLinejoin="round" />

          {startValue != null && startValue > 0 && (
            <line x1={padL} y1={Y(startValue)} x2={w - padR} y2={Y(startValue)} stroke={CHART.border} strokeWidth="1" strokeDasharray="2 3" />
          )}
          {goal > 0 && goal >= minV && goal <= maxV && (
            <g>
              <line x1={padL} y1={Y(goal)} x2={w - padR} y2={Y(goal)} stroke={CHART.positive} strokeWidth="1.5" strokeDasharray="6 3" />
              <text x={w - padR} y={Y(goal) - 5} textAnchor="end" fontSize="10" fontFamily="ui-monospace, monospace" fill={CHART.positive}>
                goal {format(goal)}
              </text>
            </g>
          )}

          {hb && (
            <line x1={X(hover!)} y1={padT} x2={X(hover!)} y2={padT + innerH} stroke={CHART.border} strokeWidth="1" strokeDasharray="3 3" />
          )}

          {xTickIdx.map((i, k) => (
            <text key={`x${k}`} x={X(i)} y={height - 10} textAnchor={k === 0 ? "start" : k === xTickIdx.length - 1 ? "end" : "middle"} fontSize="10" fontFamily="ui-monospace, monospace" fill={CHART.muted}>
              {(() => {
                const y = bands[i].day / TRADING_DAYS;
                // Float division rarely lands exactly on an integer, so round.
                return Math.abs(y - Math.round(y)) < 0.05 ? `${Math.round(y)}y` : `${y.toFixed(1)}y`;
              })()}
            </text>
          ))}
        </svg>
      )}

      {hb && (
        <ChartTooltip
          x={X(hover!)}
          y={Y(hb.p50)}
          containerW={w}
          containerH={height}
          color={CHART.amber}
          title={`Year ${(hb.day / TRADING_DAYS).toFixed(1)}`}
          rows={[
            { label: "P90", value: format(hb.p90) },
            { label: "P75", value: format(hb.p75) },
            { label: "Median", value: format(hb.p50) },
            { label: "P25", value: format(hb.p25) },
            { label: "P10", value: format(hb.p10) },
            ...(compare ? [{ label: compare.label, value: format(compare.values[hover!] ?? 0) }] : []),
          ]}
        />
      )}
    </div>
  );
}
