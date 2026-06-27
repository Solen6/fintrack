"use client";

import { Treemap, ResponsiveContainer } from "recharts";
import { formatCurrency } from "@/lib/format";
import type { HoldingWithMetrics } from "@/lib/types";

const BG = "oklch(0.08 0 0)";
const EMERALD = "0.72 0.15 152";
const RUBY = "0.66 0.19 25";
const AMBER = "0.72 0.14 74"; // brand primary — cash tiles
const SECTOR_FRAME = "oklch(0.42 0 0)"; // graphite frame around each sector group

// Dark halo behind tile text so labels stay legible over any cell color.
const halo = (w: number) => ({
  stroke: "oklch(0.10 0 0)",
  strokeWidth: w,
  strokeLinejoin: "round" as const,
  style: { paintOrder: "stroke" as const },
});

interface LeafNode {
  name: string;
  ticker: string;
  changePct: number;
  size: number;
  isCash?: boolean; // cash tiles render in brand amber, no gain coloring
  groupLabel?: string; // sector name, set on the sector's largest holding
  [key: string]: string | number | boolean | undefined;
}

interface SectorNode {
  name: string;
  children: LeafNode[];
  [key: string]: unknown;
}

interface Props {
  holdings: HoldingWithMetrics[];
  colorBy: "daily" | "total";
  onSelect?: (ticker: string) => void;
  selected?: string;
}

export function HoldingsTreemap({ holdings, colorBy, onSelect, selected }: Props) {
  // Group holdings by sector → nested treemap. Sectors sized by their total
  // value and ordered largest-first; holdings within each sector likewise.
  const bySector = new Map<string, LeafNode[]>();
  for (const h of holdings) {
    const sector = (h.sector ?? "").trim() && h.sector !== "Other" ? h.sector : "Other";
    const leaf: LeafNode = {
      name: h.name,
      ticker: h.ticker,
      changePct: colorBy === "daily" ? h.todayChangePct : h.gainPercent,
      size: Math.max(h.value, 1),
      isCash: h.ticker === "CASH" && h.sector === "Cash",
    };
    const list = bySector.get(sector);
    if (list) list.push(leaf);
    else bySector.set(sector, [leaf]);
  }

  const data: SectorNode[] = [...bySector.entries()]
    .map(([name, leaves]) => {
      const children = leaves.sort((a, b) => b.size - a.size);
      children[0].groupLabel = name; // largest holding carries the sector label
      const total = children.reduce((s, c) => s + c.size, 0);
      return { name, children, total };
    })
    .sort((a, b) => b.total - a.total);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <Treemap
        data={data}
        dataKey="size"
        stroke={BG}
        isAnimationActive={false}
        content={<TreemapCell colorBy={colorBy} onSelect={onSelect} selected={selected} />}
      />
    </ResponsiveContainer>
  );
}

function TreemapCell(props: {
  colorBy?: "daily" | "total";
  onSelect?: (ticker: string) => void;
  selected?: string;
  depth?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  ticker?: string;
  value?: number;
  changePct?: number;
  isCash?: boolean;
  groupLabel?: string;
}) {
  const { colorBy, onSelect, selected, depth = 0, x = 0, y = 0, width = 0, height = 0, name, ticker, value, changePct, isCash, groupLabel } = props;

  if (width <= 0 || height <= 0) return null;

  // Depth 1 = sector container: a frame to bound the group (the holding cells
  // paint over its interior, so only the outer frame stroke shows).
  if (depth === 1) {
    return (
      <g>
        <title>{`${name ?? ""}${value !== undefined ? `\n${formatCurrency(value)}` : ""}`}</title>
        <rect x={x} y={y} width={width} height={height} rx={2} fill="none" stroke={SECTOR_FRAME} strokeWidth={2} />
      </g>
    );
  }

  // Depth 2 = holding leaf.
  if (depth !== 2 || changePct === undefined) return null;

  const scale = colorBy === "daily" ? 3 : 20; // 3% for daily, 20% for total return
  // Power curve + raised floor so even small moves read clearly as green/red,
  // and strong movers saturate harder. Floor 0.22, max 0.82.
  const intensity = Math.min(1, Math.abs(changePct) / scale) ** 0.7;
  const alpha = (0.22 + intensity * 0.6).toFixed(3);

  const isNeutral = changePct === 0;
  const hue = isNeutral ? "0.30 0 0" : changePct >= 0 ? EMERALD : RUBY;
  const bgFill = isCash
    ? `oklch(${AMBER} / 0.85)`
    : isNeutral
    ? `oklch(0.16 0 0)`
    : `oklch(${hue} / ${alpha})`;

  // Sector tag only on the group's largest cell, and only when it fits.
  const showSector = !!groupLabel && width > 42 && height > 46;
  const tickerY = showSector ? y + 27 : y + 16;
  const pctY = showSector ? y + 40 : y + 30;
  const valueY = showSector ? y + 53 : y + 44;

  const showTicker = width > 35 && height > (showSector ? 34 : 24);
  const showPct = !isCash && width > 45 && height > (showSector ? 48 : 38);
  const showValue = width > 60 && height > (showSector ? 60 : 50) && value !== undefined;
  const pctLabel = `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%`;

  // Non-cash leaves with a real ticker can be selected to drive the price chart.
  const selectable = !!onSelect && !!ticker && !isCash;
  const isSelected = !!selected && ticker === selected;
  const handleSelect = selectable ? () => onSelect!(ticker!) : undefined;

  return (
    <g
      className={selectable ? "hm-leaf" : undefined}
      onClick={handleSelect}
      onKeyDown={selectable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSelect!(); } } : undefined}
      tabIndex={selectable ? 0 : undefined}
      role={selectable ? "button" : undefined}
      aria-label={selectable ? `${name ?? ticker}, ${pctLabel}, select to chart` : undefined}
      aria-pressed={selectable ? isSelected : undefined}
      style={{ cursor: selectable ? "pointer" : "default", outline: "none" }}
    >
      <title>{`${name ?? ""} (${ticker ?? ""})\nSector: ${groupLabel ?? "—"}\nValue: ${value !== undefined ? formatCurrency(value) : ""}\nChange: ${pctLabel}`}</title>
      <rect
        x={x} y={y} width={width} height={height} rx={2}
        fill={bgFill}
        stroke={isSelected ? `oklch(${AMBER})` : BG}
        strokeWidth={isSelected ? 2.5 : 1}
      />
      {showSector && (
        <text
          x={x + 6}
          y={y + 13}
          fontSize={8.5}
          fontWeight={700}
          letterSpacing={0.4}
          fontFamily="var(--font-sans)"
          fill="oklch(0.97 0.005 74)"
          {...halo(2)}
        >
          {(groupLabel ?? "").toUpperCase()}
        </text>
      )}
      {showTicker && (
        <text x={x + 6} y={tickerY} fontSize={11} fontWeight={700} fontFamily="var(--font-mono)" fill="oklch(0.98 0.005 74)" {...halo(2.6)}>
          {/* When the % label is too small to fit, prepend a ▲/▼ shape so
              direction is never conveyed by color alone (color-not-only). */}
          {(!showPct && !isCash && !isNeutral ? `${changePct >= 0 ? "▲" : "▼"} ` : "") + (ticker ?? "")}
        </text>
      )}
      {showPct && (
        <text x={x + 6} y={pctY} fontSize={10} fontWeight={500} fontFamily="var(--font-mono)" fill="oklch(0.92 0.005 74)" {...halo(2.4)}>
          {pctLabel}
        </text>
      )}
      {showValue && (
        <text x={x + 6} y={valueY} fontSize={10} fontFamily="var(--font-mono)" fill="oklch(0.82 0.005 74)" {...halo(2.2)}>
          {formatCurrency(value as number)}
        </text>
      )}
    </g>
  );
}
