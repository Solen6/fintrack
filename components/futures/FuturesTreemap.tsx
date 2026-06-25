"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FutureCell, FuturesTimeframe } from "@/app/api/futures/route";

/* ──────────────────────────────────────────────────────────────────────────
   Quiet Quilt — a Finviz-style futures heatmap.
   Two-level squarified treemap (Bruls/Huizing/van Wijk), hand-rolled, no d3:
     · OUTER pass squarifies the 6 categories into 2D macro-blocks that fill the
       measured container (ResizeObserver px — never a fixed viewBox, never cropped).
     · INNER pass squarifies each category's contracts into square-ish tiles.
   Layout is a CONSTANT (sized by fixed importance weights) — only COLOR breathes,
   so the map is byte-identical on every refresh + timeframe switch.
   DOM-div tiles → crisp Geist Mono numerals, native CSS hover/focus/ellipsis.
   Below ~640px the outer pass falls back to a vertical stack of full-width bands.
   ────────────────────────────────────────────────────────────────────────── */

const FULL_SCALE: Record<FuturesTimeframe, number> = {
  "1D": 3,
  "1W": 6,
  "1M": 12,
  "YTD": 40,
};

const EMERALD = "0.72 0.15 152";
const RUBY = "0.66 0.19 25";

// Fixed display order (used for the narrow-stack fallback + grid view parity).
const CATEGORY_ORDER = ["Energy", "Metals", "Agriculture", "Indices", "Rates", "Currencies"];

// Per-contract importance / liquidity weight. Drives tile AREA only (never color),
// so the skeleton never twitches across refreshes. Tune freely.
const WEIGHTS: Record<string, number> = {
  // Energy
  "CL=F": 10, "BZ=F": 8, "NG=F": 7, "RB=F": 4, "HO=F": 3,
  // Metals
  "GC=F": 10, "SI=F": 6, "HG=F": 7, "PL=F": 3, "PA=F": 2,
  // Indices
  "ES=F": 10, "NQ=F": 9, "YM=F": 6, "RTY=F": 4,
  // Rates
  "ZN=F": 10, "ZB=F": 7, "ZF=F": 5, "ZT=F": 5,
  // Currencies
  "DX-Y.NYB": 8, "6E=F": 7, "6J=F": 6, "6B=F": 4,
  // Agriculture
  "ZC=F": 6, "ZS=F": 6, "ZW=F": 5, "KC=F": 4, "SB=F": 3, "CT=F": 3,
};
const DEFAULT_WEIGHT = 4;

const LABEL_H = 22;      // reserved label strip atop each macro-block
const MIN_BAND_H = 92;   // floor for the narrow vertical-stack fallback

function weightOf(symbol: string): number {
  return WEIGHTS[symbol] ?? DEFAULT_WEIGHT;
}
function shortSymbol(symbol: string): string {
  return symbol.replace("=F", "").replace("-Y.NYB", "");
}
function fmtPrice(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function signedPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/* ─── Color: alpha scales with move magnitude, normalized per timeframe ─── */
function tileColor(pct: number, tf: FuturesTimeframe) {
  const scale = FULL_SCALE[tf];
  const intensity = Math.min(1, Math.abs(pct) / scale) ** 0.7;
  const alpha = 0.2 + intensity * 0.62;
  const hue = pct >= 0 ? EMERALD : RUBY;
  return {
    fill: `oklch(${hue} / ${alpha.toFixed(3)})`,
    border: `oklch(${hue} / ${Math.min(1, alpha + 0.16).toFixed(3)})`,
    hoverBorder: `oklch(${hue} / 0.95)`,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
   Squarified treemap. Lays each committed row along the SHORT edge so tiles
   trend toward squares instead of slivers. Used for BOTH levels.
   ────────────────────────────────────────────────────────────────────────── */
interface SqNode<T> { item: T; area: number; }
interface Placed<T> { item: T; x: number; y: number; w: number; h: number; }

function worstRatio<T>(row: SqNode<T>[], shorter: number): number {
  let sum = 0, max = -Infinity, min = Infinity;
  for (const n of row) {
    sum += n.area;
    if (n.area > max) max = n.area;
    if (n.area < min) min = n.area;
  }
  const s2 = sum * sum;
  const w2 = shorter * shorter;
  return Math.max((w2 * max) / s2, s2 / (w2 * min));
}

function squarify<T>(
  nodes: SqNode<T>[],
  x: number,
  y: number,
  width: number,
  height: number
): Placed<T>[] {
  const out: Placed<T>[] = [];
  if (width <= 0 || height <= 0 || nodes.length === 0) return out;
  const total = nodes.reduce((s, n) => s + n.area, 0);
  if (total <= 0) return out;

  // Normalize areas to the exact rect area, and pack largest-first.
  const scale = (width * height) / total;
  const items = nodes
    .map((n) => ({ item: n.item, area: n.area * scale }))
    .sort((a, b) => b.area - a.area);

  const rect = { x, y, w: width, h: height };
  let i = 0;
  const n = items.length;

  while (i < n) {
    const shorter = Math.min(rect.w, rect.h);
    let row: SqNode<T>[] = [items[i]];
    let next = i + 1;
    while (next < n) {
      const candidate = row.concat(items[next]);
      if (worstRatio(candidate, shorter) <= worstRatio(row, shorter)) {
        row = candidate;
        next++;
      } else break;
    }
    const rowArea = row.reduce((s, r) => s + r.area, 0);
    if (rect.w >= rect.h) {
      const colW = rowArea / rect.h;
      let oy = rect.y;
      for (const r of row) {
        const tileH = r.area / colW;
        out.push({ item: r.item, x: rect.x, y: oy, w: colW, h: tileH });
        oy += tileH;
      }
      rect.x += colW;
      rect.w -= colW;
    } else {
      const rowH = rowArea / rect.w;
      let ox = rect.x;
      for (const r of row) {
        const tileW = r.area / rowH;
        out.push({ item: r.item, x: ox, y: rect.y, w: tileW, h: rowH });
        ox += tileW;
      }
      rect.y += rowH;
      rect.h -= rowH;
    }
    i = next;
  }
  return out;
}

/* ─── Band-height solver for the narrow vertical-stack fallback ─── */
function solveBandHeights(weights: number[], totalH: number, minH: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const heights = new Array(n).fill(0);
  const locked = new Array(n).fill(false);
  let remH = totalH;
  let remW = weights.reduce((s, w) => s + w, 0);
  for (let pass = 0; pass < n; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (locked[i]) continue;
      const h = remW > 0 ? (weights[i] / remW) * remH : 0;
      if (h < minH) {
        heights[i] = minH; locked[i] = true; remH -= minH; remW -= weights[i]; changed = true;
      }
    }
    if (!changed) break;
  }
  for (let i = 0; i < n; i++) {
    if (!locked[i]) heights[i] = remW > 0 ? Math.max(minH, (weights[i] / remW) * remH) : minH;
  }
  return heights;
}

/* ─── Grouping ─── */
interface CategoryGroup {
  category: string;
  items: FutureCell[];
  weight: number;
  aggPct: number;
  up: number;
  down: number;
}
interface CategoryBlock extends Placed<CategoryGroup> {
  tiles: Placed<{ cell: FutureCell }>[];
}

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

interface HoverState { symbol: string; cx: number; cy: number; }

export function FuturesTreemap({ cells, tf }: { cells: FutureCell[]; tf: FuturesTimeframe }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<HoverState | null>(null);
  const reduce = usePrefersReducedMotion();

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setDims({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const groups = useMemo<CategoryGroup[]>(() => {
    const map = new Map<string, FutureCell[]>();
    for (const c of cells) {
      if (!map.has(c.category)) map.set(c.category, []);
      map.get(c.category)!.push(c);
    }
    return CATEGORY_ORDER.filter((cat) => map.has(cat)).map((cat) => {
      const items = map.get(cat)!.slice();
      items.sort((a, b) => weightOf(b.symbol) - weightOf(a.symbol) || a.symbol.localeCompare(b.symbol));
      const weight = items.reduce((s, c) => s + weightOf(c.symbol), 0);
      const valid = items.filter((c) => !c.error);
      const wsum = valid.reduce((s, c) => s + weightOf(c.symbol), 0) || 1;
      const aggPct = valid.reduce((s, c) => s + weightOf(c.symbol) * c.changePct, 0) / wsum;
      const up = valid.filter((c) => c.changePct >= 0).length;
      return { category: cat, items, weight, aggPct, up, down: valid.length - up };
    });
  }, [cells]);

  const narrow = dims.w > 0 && dims.w < 640;

  // Layout: two-level squarify (wide) or vertical stacked bands (narrow).
  const { blocks, contentH } = useMemo<{ blocks: CategoryBlock[]; contentH: number }>(() => {
    if (dims.w <= 0 || groups.length === 0) return { blocks: [], contentH: 0 };

    let catRects: Placed<CategoryGroup>[];
    let totalH: number;

    if (narrow) {
      totalH = Math.max(dims.h, groups.length * MIN_BAND_H);
      const heights = solveBandHeights(groups.map((g) => g.weight), totalH, MIN_BAND_H);
      let y = 0;
      catRects = groups.map((g, i) => {
        const r = { item: g, x: 0, y, w: dims.w, h: heights[i] };
        y += heights[i];
        return r;
      });
    } else {
      totalH = dims.h;
      catRects = squarify(
        groups.map((g) => ({ item: g, area: g.weight })),
        0, 0, dims.w, dims.h
      );
    }

    const blocks: CategoryBlock[] = catRects.map((r) => {
      const tiles = squarify(
        r.item.items.map((cell) => ({ item: { cell }, area: weightOf(cell.symbol) })),
        r.x, r.y + LABEL_H, r.w, Math.max(1, r.h - LABEL_H)
      );
      return { ...r, tiles };
    });

    return { blocks, contentH: totalH };
  }, [groups, dims, narrow]);

  const hoveredCell = hover ? cells.find((c) => c.symbol === hover.symbol) ?? null : null;
  const transition = reduce ? "none" : "filter 150ms ease, border-color 150ms ease";

  return (
    <div
      ref={wrapRef}
      className={`relative h-full w-full ${narrow ? "overflow-y-auto" : "overflow-hidden"}`}
      role="figure"
      aria-label={`Futures heatmap, ${tf}, by category`}
    >
      {/* Amber focus ring (single-lamp rule) on keyboard focus only — not on mouse hover. */}
      <style>{`.ftile:focus-visible{outline:2px solid oklch(0.72 0.14 74);outline-offset:-2px;z-index:6;}`}</style>
      <div style={{ position: "relative", width: "100%", height: contentH || "100%" }}>
        {blocks.map((b) => (
          <div key={b.item.category}>
            {/* Macro-block label */}
            <div
              className="absolute flex items-baseline gap-2 select-none"
              style={{ left: b.x + 6, top: b.y + 5, maxWidth: b.w - 10, height: LABEL_H - 5, pointerEvents: "none" }}
            >
              <span
                className="font-sans"
                style={{
                  fontSize: 10.5, fontWeight: 600, letterSpacing: "0.07em",
                  textTransform: "uppercase", color: "oklch(0.62 0.008 74)", whiteSpace: "nowrap",
                }}
              >
                {b.item.category}
              </span>
              <span
                className="font-mono tabular-nums"
                style={{ fontSize: 10, color: b.item.aggPct >= 0 ? "var(--positive)" : "var(--negative)" }}
              >
                {signedPct(b.item.aggPct)}
              </span>
              {b.w > 220 && (
                <span className="font-mono tabular-nums" style={{ fontSize: 9.5, color: "oklch(0.44 0.006 74)" }}>
                  {b.item.up}↑ {b.item.down}↓
                </span>
              )}
            </div>

            {/* Tiles */}
            {b.tiles.map((t) => (
              <Tile
                key={t.item.cell.symbol}
                placed={t}
                tf={tf}
                transition={transition}
                hovered={hover?.symbol === t.item.cell.symbol}
                onEnter={(cx, cy) => setHover({ symbol: t.item.cell.symbol, cx, cy })}
                onLeave={() => setHover((h) => (h?.symbol === t.item.cell.symbol ? null : h))}
              />
            ))}
          </div>
        ))}
      </div>

      {hoveredCell && hover && <Tooltip cell={hoveredCell} cx={hover.cx} cy={hover.cy} />}
    </div>
  );
}

/* ─── A single tile ─── */
function Tile({
  placed, tf, transition, hovered, onEnter, onLeave,
}: {
  placed: Placed<{ cell: FutureCell }>;
  tf: FuturesTimeframe;
  transition: string;
  hovered: boolean;
  onEnter: (cx: number, cy: number) => void;
  onLeave: () => void;
}) {
  const { x, y, w, h } = placed;
  const cell = placed.item.cell;
  const errored = !!cell.error;
  const positive = cell.changePct >= 0;

  // Inset 1px on right/bottom → uniform 1px hairline trench between tiles.
  const tw = Math.max(0, w - 1);
  const th = Math.max(0, h - 1);

  const large = tw >= 104 && th >= 56;
  const medium = !large && tw >= 54 && th >= 32;
  const small = !large && !medium && tw >= 34 && th >= 20;

  let bg: string, borderColor: string, hoverBorder: string;
  if (errored) {
    bg = "oklch(0.105 0 0)"; borderColor = "oklch(0.18 0 0)"; hoverBorder = "oklch(0.3 0 0)";
  } else {
    const c = tileColor(cell.changePct, tf);
    bg = c.fill; borderColor = c.border; hoverBorder = c.hoverBorder;
  }

  const ariaDir = errored ? "no data" : `${positive ? "up" : "down"} ${Math.abs(cell.changePct).toFixed(2)} percent`;
  const textShadow = "0 1px 2px oklch(0.06 0 0 / 0.7)";

  const handleEnter = (e: React.MouseEvent<HTMLDivElement> | React.FocusEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onEnter(r.left + r.width / 2, r.top);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${cell.name}, ${cell.category}, ${ariaDir}`}
      onMouseEnter={handleEnter}
      onMouseLeave={onLeave}
      onFocus={handleEnter}
      onBlur={onLeave}
      className="ftile absolute flex flex-col items-center justify-center overflow-hidden cursor-pointer focus:outline-none"
      style={{
        left: x, top: y, width: tw, height: th,
        background: bg,
        border: `1px solid ${hovered ? hoverBorder : borderColor}`,
        boxSizing: "border-box",
        filter: hovered && !errored ? "brightness(1.12)" : "none",
        transition,
        zIndex: hovered ? 5 : 1,
        opacity: errored ? 0.55 : 1,
      }}
    >
      {large && !errored && (
        <span
          className="font-mono tabular-nums absolute"
          style={{ left: 6, top: 4, fontSize: 9, color: "oklch(0.98 0.005 74 / 0.6)", textShadow }}
        >
          {shortSymbol(cell.symbol)}
        </span>
      )}

      {errored ? (
        (small || medium || large) && (
          <span className="font-mono" style={{ fontSize: 11, color: "oklch(0.5 0.006 74)" }}>—</span>
        )
      ) : (
        <>
          {(large || medium) && (
            <span
              className="font-sans px-1"
              style={{
                maxWidth: "94%", fontSize: large ? 12.5 : 11, fontWeight: 600,
                color: "oklch(0.98 0.005 74)", whiteSpace: "nowrap", overflow: "hidden",
                textOverflow: "ellipsis", textShadow, lineHeight: 1.15,
              }}
            >
              {cell.name}
            </span>
          )}
          {(large || medium || small) && (
            <span
              className="font-mono tabular-nums"
              style={{
                fontSize: large ? 15 : medium ? 12.5 : 10.5, fontWeight: 700,
                color: "oklch(0.99 0.005 74)", textShadow, marginTop: large || medium ? 1 : 0,
              }}
            >
              {signedPct(cell.changePct)}
            </span>
          )}
          {large && (
            <span
              className="font-mono tabular-nums"
              style={{ fontSize: 10, color: "oklch(0.98 0.005 74 / 0.6)", textShadow, marginTop: 1 }}
            >
              {fmtPrice(cell.price)}
            </span>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Crisp dark tooltip (the one allowed soft shadow — popover layer) ─── */
function Tooltip({ cell, cx, cy }: { cell: FutureCell; cx: number; cy: number }) {
  const positive = cell.changePct >= 0;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
  const clampedX = Math.max(120, Math.min(cx, vw - 120));
  return (
    <div
      className="font-mono"
      style={{
        position: "fixed", left: clampedX, top: cy - 10,
        transform: "translate(-50%, -100%)", pointerEvents: "none", zIndex: 60,
        background: "oklch(0.14 0 0)", border: "1px solid oklch(0.22 0 0)",
        borderRadius: 4, padding: "8px 10px", whiteSpace: "nowrap",
        boxShadow: "0 6px 20px oklch(0 0 0 / 0.5)",
      }}
    >
      <div className="font-sans" style={{ fontSize: 12.5, fontWeight: 600, color: "oklch(0.98 0.005 74)" }}>
        {cell.name}
      </div>
      <div style={{ fontSize: 10.5, color: "oklch(0.6 0.008 74)", marginTop: 1 }}>
        {cell.symbol} · {cell.category}
      </div>
      {cell.error ? (
        <div style={{ fontSize: 11, color: "oklch(0.6 0.008 74)", marginTop: 4 }}>no data</div>
      ) : (
        <div className="tabular-nums" style={{ marginTop: 4, display: "flex", gap: 10, alignItems: "baseline" }}>
          <span style={{ fontSize: 12, color: "oklch(0.92 0.005 74)" }}>{fmtPrice(cell.price)}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: positive ? "var(--positive)" : "var(--negative)" }}>
            {signedPct(cell.changePct)}
          </span>
          <span style={{ fontSize: 11, color: positive ? "var(--positive)" : "var(--negative)" }}>
            ({cell.change >= 0 ? "+" : ""}{cell.change.toFixed(2)})
          </span>
        </div>
      )}
    </div>
  );
}
