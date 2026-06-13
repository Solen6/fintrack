"use client";

import { Treemap, ResponsiveContainer } from "recharts";
import type { FutureCell, FuturesTimeframe } from "@/app/api/futures/route";

const FULL_SCALE: Record<FuturesTimeframe, number> = {
  "1D": 3,
  "1W": 6,
  "1M": 12,
  "YTD": 40,
};

const EMERALD = "0.72 0.15 152";
const RUBY = "0.66 0.19 25";
const BG = "oklch(0.08 0 0)";

interface TreemapNode {
  name: string;
  symbol: string;
  price: number;
  changePct: number;
  size: number;
  [key: string]: string | number;
}

export function FuturesTreemap({
  cells,
  tf,
}: {
  cells: FutureCell[];
  tf: FuturesTimeframe;
}) {
  const data: TreemapNode[] = cells
    .filter((c) => !c.error)
    .map((c) => ({
      name: c.name,
      symbol: c.symbol,
      price: c.price,
      changePct: c.changePct,
      // area scales with move magnitude; floor keeps flat names visible
      size: Math.max(Math.abs(c.changePct), 0.25),
    }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <Treemap
        data={data}
        dataKey="size"
        stroke={BG}
        isAnimationActive={false}
        content={<TreemapCell tf={tf} />}
      />
    </ResponsiveContainer>
  );
}

/* Recharts clones this element per node, spreading the node's fields in as props. */
function TreemapCell(props: {
  tf?: FuturesTimeframe;
  depth?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  symbol?: string;
  price?: number;
  changePct?: number;
}) {
  const { tf, depth = 0, x = 0, y = 0, width = 0, height = 0, name, changePct } = props;

  // depth 0 is the root container — skip it
  if (depth === 0 || width <= 0 || height <= 0 || changePct === undefined) return null;

  const scale = FULL_SCALE[tf ?? "1D"];
  const intensity = Math.min(1, Math.abs(changePct) / scale);
  const alpha = (0.12 + intensity * 0.6).toFixed(3);
  const hue = changePct >= 0 ? EMERALD : RUBY;

  const showName = width > 56 && height > 34;
  const showPct = width > 40 && height > 20;
  const pctLabel = `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={2}
        fill={`oklch(${hue} / ${alpha})`}
        stroke={BG}
        strokeWidth={1}
      />
      {showName && (
        <text
          x={x + 6}
          y={y + 16}
          fontSize={11}
          fontWeight={500}
          fill="oklch(0.96 0.005 74)"
        >
          {clip(name ?? "", width)}
        </text>
      )}
      {showPct && (
        <text
          x={x + 6}
          y={showName ? y + 31 : y + Math.min(height / 2 + 4, height - 6)}
          fontSize={11}
          fontFamily="var(--font-mono)"
          fill="oklch(0.96 0.005 74)"
        >
          {pctLabel}
        </text>
      )}
    </g>
  );
}

// crude truncation so long names don't overflow narrow tiles
function clip(text: string, width: number): string {
  const max = Math.max(3, Math.floor((width - 12) / 6.5));
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
