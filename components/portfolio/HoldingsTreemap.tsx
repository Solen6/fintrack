"use client";

import { Treemap, ResponsiveContainer } from "recharts";
import { formatCurrency } from "@/lib/format";
import type { HoldingWithMetrics } from "@/lib/types";

const BG = "oklch(0.08 0 0)";
const EMERALD = "0.72 0.15 152";
const RUBY = "0.66 0.19 25";

interface TreemapNode {
  name: string;
  ticker: string;
  value: number;
  changePct: number;
  size: number;
  [key: string]: string | number;
}

interface Props {
  holdings: HoldingWithMetrics[];
  colorBy: "daily" | "total";
}

export function HoldingsTreemap({ holdings, colorBy }: Props) {
  const data: TreemapNode[] = holdings.map((h) => ({
    name: h.name,
    ticker: h.ticker,
    value: h.value,
    changePct: colorBy === "daily" ? h.todayChangePct : h.gainPercent,
    // Size is the dollar value of the holding, floor at 1 to avoid zero size
    size: Math.max(h.value, 1),
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <Treemap
        data={data}
        dataKey="size"
        stroke={BG}
        isAnimationActive={false}
        content={<TreemapCell colorBy={colorBy} />}
      />
    </ResponsiveContainer>
  );
}

function TreemapCell(props: {
  colorBy?: "daily" | "total";
  depth?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  ticker?: string;
  value?: number;
  changePct?: number;
}) {
  const { colorBy, depth = 0, x = 0, y = 0, width = 0, height = 0, name, ticker, value, changePct } = props;

  if (depth === 0 || width <= 0 || height <= 0 || changePct === undefined) return null;

  // Scale of full color intensity
  const scale = colorBy === "daily" ? 3 : 20; // 3% for daily, 20% for total return
  const intensity = Math.min(1, Math.abs(changePct) / scale);
  const alpha = (0.12 + intensity * 0.6).toFixed(3);
  
  // If changePct is exactly 0, use a neutral color
  const isNeutral = changePct === 0;
  const hue = isNeutral ? "0.30 0 0" : changePct >= 0 ? EMERALD : RUBY;
  const bgFill = isNeutral ? `oklch(0.16 0 0)` : `oklch(${hue} / ${alpha})`;
  
  const showTicker = width > 35 && height > 24;
  const showPct = width > 45 && height > 38;
  const pctLabel = `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%`;

  return (
    <g>
      <title>{`${name ?? ""} (${ticker ?? ""})\nValue: ${value !== undefined ? formatCurrency(value) : ""}\nChange: ${pctLabel}`}</title>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={2}
        fill={bgFill}
        stroke={BG}
        strokeWidth={1}
      />
      {showTicker && (
        <text
          x={x + 6}
          y={y + 16}
          fontSize={11}
          fontWeight={600}
          fontFamily="var(--font-mono)"
          fill="oklch(0.96 0.005 74)"
        >
          {ticker}
        </text>
      )}
      {showPct && (
        <text
          x={x + 6}
          y={y + 30}
          fontSize={10}
          fontFamily="var(--font-mono)"
          fill="oklch(0.70 0.005 74)"
        >
          {pctLabel}
        </text>
      )}
      {width > 60 && height > 50 && value !== undefined && (
        <text
          x={x + 6}
          y={y + 44}
          fontSize={10}
          fontFamily="var(--font-mono)"
          fill="oklch(0.52 0.008 74)"
        >
          {formatCurrency(value)}
        </text>
      )}
    </g>
  );
}
