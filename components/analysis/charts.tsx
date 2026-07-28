"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/* ──────────────────────────────────────────────────────────────────────────
   Dependency-free SVG chart primitives shared by the Analysis tools (no
   Recharts → no SSR gymnastics). Each measures its container so strokes and
   dots stay crisp instead of stretching. Colors come from the app tokens.
   ────────────────────────────────────────────────────────────────────────── */

export const CHART = {
  amber: "oklch(0.72 0.14 74)",
  amberFill: "oklch(0.72 0.14 74 / 0.14)",
  steel: "oklch(0.64 0.07 240)",
  steelFill: "oklch(0.64 0.07 240 / 0.12)",
  positive: "oklch(0.72 0.15 152)",
  negative: "oklch(0.66 0.19 25)",
  muted: "oklch(0.50 0.006 74)",
  grid: "oklch(0.20 0 0)",
  border: "oklch(0.28 0 0)",
};

/** Measure a container's width (ResizeObserver). Returns [ref, width]. */
export function useMeasure<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const update = () => setW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export interface Series {
  name: string;
  color: string;
  values: number[];
  /** Draw a soft area fill under this series. */
  fill?: string;
  dashed?: boolean;
}

/** Multi-series line chart. All series share the same x-index domain. */
export function LineChart({
  series,
  height = 240,
  yFormat = (n) => n.toFixed(0),
  baseline,
  gridLines = 4,
  showEndDot = true,
}: {
  series: Series[];
  height?: number;
  yFormat?: (n: number) => string;
  baseline?: number;
  gridLines?: number;
  showEndDot?: boolean;
}) {
  const [ref, w] = useMeasure<HTMLDivElement>();
  const padL = 48;
  const padR = 12;
  const padT = 10;
  const padB = 22;
  const innerW = Math.max(0, w - padL - padR);
  const innerH = height - padT - padB;

  const all = series.flatMap((s) => s.values);
  let min = all.length ? Math.min(...all) : 0;
  let max = all.length ? Math.max(...all) : 1;
  if (baseline != null) {
    min = Math.min(min, baseline);
    max = Math.max(max, baseline);
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.06;
  min -= pad;
  max += pad;

  const n = Math.max(...series.map((s) => s.values.length), 1);
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - ((v - min) / (max - min)) * innerH;

  const ticks = Array.from({ length: gridLines + 1 }, (_, i) => min + ((max - min) * i) / gridLines);

  return (
    <div ref={ref} className="w-full">
      {w > 0 && (
        <svg width={w} height={height} role="img">
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={padL} y1={y(t)} x2={w - padR} y2={y(t)} stroke={CHART.grid} strokeWidth="1" />
              <text x={padL - 8} y={y(t) + 3} textAnchor="end" fontSize="10" fontFamily="ui-monospace, monospace" fill={CHART.muted}>
                {yFormat(t)}
              </text>
            </g>
          ))}
          {baseline != null && (
            <line x1={padL} y1={y(baseline)} x2={w - padR} y2={y(baseline)} stroke={CHART.border} strokeWidth="1" strokeDasharray="3 3" />
          )}
          {series.map((s, si) => {
            if (s.values.length === 0) return null;
            const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
            const areaPath =
              s.fill != null
                ? `M ${x(0)},${y(min)} L ${s.values.map((v, i) => `${x(i)},${y(v)}`).join(" L ")} L ${x(s.values.length - 1)},${y(min)} Z`
                : null;
            return (
              <g key={si}>
                {areaPath && <path d={areaPath} fill={s.fill} stroke="none" />}
                <polyline
                  points={pts}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="1.75"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={s.dashed ? "5 4" : undefined}
                />
                {showEndDot && (
                  <circle cx={x(s.values.length - 1)} cy={y(s.values[s.values.length - 1])} r="3" fill={s.color} />
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** Horizontal labelled bars (weights, contributions, drift, income…). */
export function HBarList({
  items,
  formatValue = (n) => n.toFixed(1),
  height = 22,
  signed = false,
}: {
  items: { label: string; value: number; color?: string; sub?: ReactNode }[];
  formatValue?: (n: number) => string;
  height?: number;
  /** When true, bars grow from a centered zero line (for +/- values like drift). */
  signed?: boolean;
}) {
  const maxAbs = Math.max(1e-9, ...items.map((it) => Math.abs(it.value)));
  return (
    <div className="flex flex-col gap-2">
      {items.map((it, i) => {
        const frac = Math.abs(it.value) / maxAbs;
        const color = it.color ?? CHART.amber;
        return (
          <div key={i} className="flex items-center gap-3">
            <span className="w-[92px] shrink-0 truncate text-[12px] text-foreground" title={it.label}>
              {it.label}
            </span>
            <div className="relative h-[var(--h)] flex-1 overflow-hidden rounded-[3px] bg-[oklch(0.16_0_0)]" style={{ ["--h" as string]: `${height}px` }}>
              {signed ? (
                <div
                  className="absolute top-0 h-full rounded-[3px]"
                  style={{
                    background: color,
                    left: it.value >= 0 ? "50%" : `${50 - frac * 50}%`,
                    width: `${frac * 50}%`,
                  }}
                />
              ) : (
                <div className="absolute left-0 top-0 h-full rounded-[3px]" style={{ background: color, width: `${frac * 100}%` }} />
              )}
              {signed && <div className="absolute left-1/2 top-0 h-full w-px bg-[oklch(0.28_0_0)]" />}
            </div>
            <span className="w-[74px] shrink-0 text-right font-mono text-[11.5px] tabular-nums text-foreground">
              {formatValue(it.value)}
            </span>
            {it.sub != null && <span className="w-[56px] shrink-0 text-right font-mono text-[11px] tabular-nums" style={{ color: CHART.muted }}>{it.sub}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Correlation-style heat grid. `colorFor(value)` returns a fill. */
export function HeatGrid({
  labels,
  matrix,
  colorFor,
  cellLabel,
}: {
  labels: string[];
  matrix: number[][];
  colorFor: (v: number) => string;
  cellLabel?: (v: number) => string;
}) {
  const n = labels.length;
  const cell = 34;
  const gutter = 44;
  const size = gutter + n * cell;
  return (
    <div className="overflow-x-auto">
      <svg width={size} height={size} role="img" style={{ minWidth: size }}>
        {labels.map((lab, j) => (
          <text key={`c${j}`} x={gutter + j * cell + cell / 2} y={gutter - 8} textAnchor="middle" fontSize="10" fontFamily="ui-monospace, monospace" fill={CHART.muted}>
            {lab}
          </text>
        ))}
        {labels.map((lab, i) => (
          <text key={`r${i}`} x={gutter - 8} y={gutter + i * cell + cell / 2 + 3} textAnchor="end" fontSize="10" fontFamily="ui-monospace, monospace" fill={CHART.muted}>
            {lab}
          </text>
        ))}
        {matrix.map((row, i) =>
          row.map((v, j) => (
            <g key={`${i}-${j}`}>
              <rect x={gutter + j * cell} y={gutter + i * cell} width={cell - 2} height={cell - 2} rx="2" fill={colorFor(v)} />
              {cellLabel && (
                <text x={gutter + j * cell + (cell - 2) / 2} y={gutter + i * cell + (cell - 2) / 2 + 3} textAnchor="middle" fontSize="9" fontFamily="ui-monospace, monospace" fill="oklch(0.08 0 0)" opacity={Math.abs(v) > 0.35 ? 0.85 : 0}>
                  {cellLabel(v)}
                </text>
              )}
            </g>
          )),
        )}
      </svg>
    </div>
  );
}

export interface ScatterPoint {
  x: number;
  y: number;
  color: string;
  r?: number;
  label?: string;
  ring?: boolean;
  /** Tooltip heading. Falls back to `label`. */
  name?: string;
  /** Tooltip body rows, rendered as a small key/value list. */
  meta?: { label: string; value: string }[];
  /** Excluded from hover hit-testing (e.g. the random-portfolio cloud). */
  noHover?: boolean;
  /** Reports clicks through `onPointClick` and shows a pointer cursor. */
  clickable?: boolean;
  /** Drawn with an extra outer ring — marks the currently pinned point. */
  emphasis?: boolean;
  /** Vertical nudge for `label`, to stagger clusters of close labels apart. */
  labelDy?: number;
  /** Put `label` to the left of the point instead of the right. */
  labelLeft?: boolean;
  /** Caller-defined identity, echoed back by `onPointClick` so the owner can
      route a click without depending on this point's index in the array. */
  pointId?: string;
  /** Footer text on the tooltip; defaults to "Click to pin" when clickable. */
  hint?: string;
}

export interface ScatterLine {
  points: { x: number; y: number }[];
  color?: string;
  dashed?: boolean;
}

/** How close (in px) the cursor must get to a point to hover it. */
const HOVER_RADIUS = 20;

/** Scatter with one or more line overlays — used for the efficient frontier
    (e.g. holdings-only vs. with-candidates). Points carrying `meta` are
    hoverable: the nearest one within `HOVER_RADIUS` gets a crosshair and a
    tooltip, and fires `onPointClick` when marked `clickable`. */
export function ScatterPlot({
  points,
  line,
  lines,
  height = 300,
  xFormat = (n) => n.toFixed(0),
  yFormat = (n) => n.toFixed(0),
  xLabel,
  yLabel,
  onPointClick,
  ariaLabel,
}: {
  points: ScatterPoint[];
  line?: { x: number; y: number }[];
  lines?: ScatterLine[];
  height?: number;
  xFormat?: (n: number) => string;
  yFormat?: (n: number) => string;
  xLabel?: string;
  yLabel?: string;
  onPointClick?: (point: ScatterPoint, index: number) => void;
  ariaLabel?: string;
}) {
  const [ref, w] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 52;
  const padR = 14;
  const padT = 12;
  const padB = 34;
  const innerW = Math.max(0, w - padL - padR);
  const innerH = height - padT - padB;

  const allLines: ScatterLine[] = [
    ...(lines ?? []),
    ...(line ? [{ points: line, color: CHART.amber }] : []),
  ];
  const linePts = allLines.flatMap((l) => l.points);
  const xs = [...points.map((p) => p.x), ...linePts.map((p) => p.x)];
  const ys = [...points.map((p) => p.y), ...linePts.map((p) => p.y)];
  let minX = Math.min(...xs, 0), maxX = Math.max(...xs, 0.01);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  const px = (maxX - minX) * 0.08 || 0.01;
  const py = (maxY - minY) * 0.08 || 0.01;
  minX -= px; maxX += px; minY -= py; maxY += py;

  const X = (v: number) => padL + ((v - minX) / (maxX - minX)) * innerW;
  const Y = (v: number) => padT + innerH - ((v - minY) / (maxY - minY)) * innerH;

  const xticks = Array.from({ length: 5 }, (_, i) => minX + ((maxX - minX) * i) / 4);
  const yticks = Array.from({ length: 5 }, (_, i) => minY + ((maxY - minY) * i) / 4);

  /** Nearest hoverable point to a cursor position, in pixel space. */
  function hitTest(cx: number, cy: number): number | null {
    let best: number | null = null;
    let bestD = HOVER_RADIUS * HOVER_RADIUS;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.noHover) continue;
      const dx = X(p.x) - cx;
      const dy = Y(p.y) - cy;
      const d = dx * dx + dy * dy;
      // Ties go to the later point, which is drawn on top.
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(hitTest(e.clientX - rect.left, e.clientY - rect.top));
  }

  const hp = hover != null ? points[hover] : null;
  const canClick = !!(hp?.clickable && onPointClick);

  return (
    <div
      ref={ref}
      className="relative w-full"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      onClick={() => {
        if (hover != null && canClick) onPointClick!(points[hover], hover);
      }}
      style={{ cursor: canClick ? "pointer" : "default" }}
    >
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label={ariaLabel}>
          {yticks.map((t, i) => (
            <g key={`y${i}`}>
              <line x1={padL} y1={Y(t)} x2={w - padR} y2={Y(t)} stroke={CHART.grid} strokeWidth="1" />
              <text x={padL - 8} y={Y(t) + 3} textAnchor="end" fontSize="10" fontFamily="ui-monospace, monospace" fill={CHART.muted}>{yFormat(t)}</text>
            </g>
          ))}
          {xticks.map((t, i) => (
            <text key={`x${i}`} x={X(t)} y={height - padB + 15} textAnchor="middle" fontSize="10" fontFamily="ui-monospace, monospace" fill={CHART.muted}>{xFormat(t)}</text>
          ))}
          {allLines.map((l, li) =>
            l.points.length > 1 ? (
              <polyline
                key={li}
                points={l.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ")}
                fill="none"
                stroke={l.color ?? CHART.amber}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={l.dashed ? "5 4" : undefined}
              />
            ) : null,
          )}
          {hp && (
            <g pointerEvents="none">
              <line x1={padL} y1={Y(hp.y)} x2={X(hp.x)} y2={Y(hp.y)} stroke={hp.color} strokeWidth="1" strokeDasharray="3 3" opacity="0.55" />
              <line x1={X(hp.x)} y1={Y(hp.y)} x2={X(hp.x)} y2={height - padB} stroke={hp.color} strokeWidth="1" strokeDasharray="3 3" opacity="0.55" />
              <circle cx={X(hp.x)} cy={Y(hp.y)} r={(hp.r ?? 4) + 6} fill={hp.color} opacity="0.16" />
            </g>
          )}
          {points.map((p, i) => (
            <g key={i}>
              {p.emphasis && (
                <circle cx={X(p.x)} cy={Y(p.y)} r={(p.r ?? 4) + 4} fill="none" stroke={p.color} strokeWidth="1.5" opacity="0.55" />
              )}
              {p.ring ? (
                <circle cx={X(p.x)} cy={Y(p.y)} r={p.r ?? 5} fill="none" stroke={p.color} strokeWidth="2" />
              ) : (
                <circle cx={X(p.x)} cy={Y(p.y)} r={(p.r ?? 3) + (i === hover ? 1.5 : 0)} fill={p.color} />
              )}
              {p.label && (
                <text
                  x={X(p.x) + (p.labelLeft ? -((p.r ?? 4) + 4) : (p.r ?? 4) + 3)}
                  y={Y(p.y) + 3 + (p.labelDy ?? 0)}
                  textAnchor={p.labelLeft ? "end" : "start"}
                  fontSize="10"
                  fontFamily="ui-monospace, monospace"
                  fill={p.color}
                >
                  {p.label}
                </text>
              )}
            </g>
          ))}
          {xLabel && <text x={padL + innerW / 2} y={height - 4} textAnchor="middle" fontSize="10.5" fill={CHART.muted}>{xLabel}</text>}
          {yLabel && <text x={14} y={padT + innerH / 2} textAnchor="middle" fontSize="10.5" fill={CHART.muted} transform={`rotate(-90 14 ${padT + innerH / 2})`}>{yLabel}</text>}
        </svg>
      )}
      {hp && (hp.name || hp.label || hp.meta) && (
        <ChartTooltip
          x={X(hp.x)}
          y={Y(hp.y)}
          containerW={w}
          containerH={height}
          color={hp.color}
          title={hp.name ?? hp.label ?? ""}
          rows={hp.meta ?? []}
          footer={hp.hint ?? (canClick ? "Click to pin" : undefined)}
        />
      )}
    </div>
  );
}

/** Floating HTML tooltip for the SVG charts — HTML rather than <text> so it can
    wrap, use the app's fonts, and sit above everything. Flips side/vertical
    placement so it never runs off the plot. */
export function ChartTooltip({
  x,
  y,
  containerW,
  containerH,
  color,
  title,
  rows,
  footer,
}: {
  x: number;
  y: number;
  containerW: number;
  containerH: number;
  color: string;
  title: string;
  rows: { label: string; value: string }[];
  footer?: string;
}) {
  const W = 180;
  const estH = 30 + rows.length * 17 + (footer ? 16 : 0);
  const flipX = x + W + 18 > containerW;
  const flipY = y + estH + 18 > containerH;
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-md border border-border bg-popover px-2.5 py-2 shadow-lg"
      style={{
        width: W,
        left: Math.max(2, Math.min(containerW - W - 2, flipX ? x - W - 12 : x + 12)),
        top: Math.max(2, flipY ? y - estH - 10 : y + 10),
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate text-[11.5px] font-medium text-foreground">{title}</span>
      </div>
      {rows.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-0.5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-2">
              <span className="text-[10.5px]" style={{ color: CHART.muted }}>{r.label}</span>
              <span className="font-mono text-[11px] tabular-nums text-foreground">{r.value}</span>
            </div>
          ))}
        </div>
      )}
      {footer && (
        <div className="mt-1.5 text-[10px]" style={{ color: CHART.muted }}>{footer}</div>
      )}
    </div>
  );
}
