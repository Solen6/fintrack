"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { StockCell, Sp500Timeframe } from "@/app/api/sp500/route";

/* ──────────────────────────────────────────────────────────────────────────
   S&P 500 heatmap — the futures "Quiet Quilt" engine, scaled to ~500 names.
   Two-level squarified treemap (Bruls/Huizing/van Wijk), hand-rolled, no d3:
     · OUTER pass squarifies the 11 GICS sectors into 2D macro-blocks that fill
       the measured container (ResizeObserver px — never a fixed viewBox).
     · INNER pass squarifies each sector's constituents by MARKET CAP.
   Tile AREA = market cap (static, baked in lib/sp500.ts) → the layout is a
   CONSTANT; only COLOR (live % change) breathes across refreshes + timeframes.
   DOM-div tiles → crisp Geist Mono numerals, native CSS hover/focus/ellipsis.
   color-not-only: every legible tile carries the SIGNED % (the +/− sign is a
   non-color direction cue) or a ▲/▼ glyph; pure-color tiles are sub-glyph only
   and fully covered by the hover tooltip + aria-label.
   Below ~640px the outer pass falls back to a vertical stack of sector bands.
   ────────────────────────────────────────────────────────────────────────── */

// Per-timeframe color normalization (equities move less than futures).
const FULL_SCALE: Record<Sp500Timeframe, number> = {
  "1D": 2.5,
  "1W": 5,
  "1M": 10,
  "YTD": 30,
};

const EMERALD = "0.72 0.15 152";
const RUBY = "0.66 0.19 25";
const AMBER = "0.72 0.14 74";

const LABEL_H = 20;      // reserved label strip atop each sector block
const MIN_BAND_H = 120;  // floor for the narrow vertical-stack fallback

function fmtPrice(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function signedPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/* ─── Color: alpha scales with move magnitude, normalized per timeframe ─── */
function tileColor(pct: number, tf: Sp500Timeframe) {
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
interface SectorGroup {
  sector: string;
  items: StockCell[];
  cap: number;
  aggPct: number;  // cap-weighted mean % change
  up: number;
  down: number;
}
interface SectorBlock extends Placed<SectorGroup> {
  tiles: Placed<{ cell: StockCell }>[];
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

export function StockTreemap({
  cells,
  sectors,
  tf,
  onSelect,
  selected,
}: {
  cells: StockCell[];
  sectors: string[];        // display order (largest aggregate cap first)
  tf: Sp500Timeframe;
  onSelect?: (symbol: string) => void;
  selected?: string;
}) {
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

  const groups = useMemo<SectorGroup[]>(() => {
    const map = new Map<string, StockCell[]>();
    for (const c of cells) {
      if (!map.has(c.sector)) map.set(c.sector, []);
      map.get(c.sector)!.push(c);
    }
    const order = sectors.length ? sectors : [...map.keys()];
    return order.filter((s) => map.has(s)).map((sector) => {
      const items = map.get(sector)!.slice();
      items.sort((a, b) => b.capB - a.capB || a.symbol.localeCompare(b.symbol));
      const cap = items.reduce((s, c) => s + c.capB, 0);
      const valid = items.filter((c) => !c.error);
      const wsum = valid.reduce((s, c) => s + c.capB, 0) || 1;
      const aggPct = valid.reduce((s, c) => s + c.capB * c.changePct, 0) / wsum;
      const up = valid.filter((c) => c.changePct >= 0).length;
      return { sector, items, cap, aggPct, up, down: valid.length - up };
    });
  }, [cells, sectors]);

  const narrow = dims.w > 0 && dims.w < 640;

  const { blocks, contentH } = useMemo<{ blocks: SectorBlock[]; contentH: number }>(() => {
    if (dims.w <= 0 || groups.length === 0) return { blocks: [], contentH: 0 };

    let sectorRects: Placed<SectorGroup>[];
    let totalH: number;

    if (narrow) {
      totalH = Math.max(dims.h, groups.length * MIN_BAND_H);
      const heights = solveBandHeights(groups.map((g) => g.cap), totalH, MIN_BAND_H);
      let y = 0;
      sectorRects = groups.map((g, i) => {
        const r = { item: g, x: 0, y, w: dims.w, h: heights[i] };
        y += heights[i];
        return r;
      });
    } else {
      totalH = dims.h;
      sectorRects = squarify(
        groups.map((g) => ({ item: g, area: g.cap })),
        0, 0, dims.w, dims.h
      );
    }

    const blocks: SectorBlock[] = sectorRects.map((r) => {
      const tiles = squarify(
        r.item.items.map((cell) => ({ item: { cell }, area: cell.capB })),
        r.x, r.y + LABEL_H, r.w, Math.max(1, r.h - LABEL_H)
      );
      return { ...r, tiles };
    });

    return { blocks, contentH: totalH };
  }, [groups, dims, narrow]);

  const hoveredCell = hover ? cells.find((c) => c.symbol === hover.symbol) ?? null : null;
  const transition = reduce ? "none" : "filter 150ms ease, border-color 150ms ease";

  // Stable handlers so the memoized Tile only re-renders the 1-2 tiles whose
  // hovered/selected state actually flips (not all ~500) on each mouse event.
  const handleEnter = useCallback((symbol: string, cx: number, cy: number) => setHover({ symbol, cx, cy }), []);
  const handleLeave = useCallback((symbol: string) => setHover((h) => (h?.symbol === symbol ? null : h)), []);

  return (
    <div
      ref={wrapRef}
      className={`relative h-full w-full ${narrow ? "overflow-y-auto" : "overflow-hidden"}`}
      role="figure"
      aria-label={`S&P 500 heatmap, ${tf}, by GICS sector`}
    >
      {/* Amber focus ring (single-lamp rule) on keyboard focus only — not on mouse hover. */}
      <style>{`.stile:focus-visible{outline:2px solid oklch(${AMBER});outline-offset:-2px;z-index:7;}`}</style>
      <div style={{ position: "relative", width: "100%", height: contentH || "100%" }}>
        {blocks.map((b) => (
          <div key={b.item.sector}>
            {/* Sector macro-block label */}
            <div
              className="absolute flex items-baseline gap-2 select-none"
              style={{ left: b.x + 6, top: b.y + 4, maxWidth: b.w - 10, height: LABEL_H - 4, pointerEvents: "none" }}
            >
              <span
                className="font-sans"
                style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
                  textTransform: "uppercase", color: "oklch(0.66 0.008 74)", whiteSpace: "nowrap",
                  overflow: "hidden", textOverflow: "ellipsis",
                }}
              >
                {b.item.sector}
              </span>
              <span
                className="font-mono tabular-nums shrink-0"
                style={{ fontSize: 10, color: b.item.aggPct >= 0 ? "var(--positive)" : "var(--negative)" }}
              >
                {signedPct(b.item.aggPct)}
              </span>
              {b.w > 240 && (
                <span className="font-mono tabular-nums shrink-0" style={{ fontSize: 9.5, color: "oklch(0.46 0.006 74)" }}>
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
                selected={selected === t.item.cell.symbol}
                onSelect={onSelect}
                onEnter={handleEnter}
                onLeave={handleLeave}
              />
            ))}
          </div>
        ))}
      </div>

      {hoveredCell && hover && <Tooltip cell={hoveredCell} cx={hover.cx} cy={hover.cy} />}
    </div>
  );
}

/* ─── A single tile (memoized — only re-renders on hovered/selected flip) ─── */
const Tile = memo(function Tile({
  placed, tf, transition, hovered, selected, onSelect, onEnter, onLeave,
}: {
  placed: Placed<{ cell: StockCell }>;
  tf: Sp500Timeframe;
  transition: string;
  hovered: boolean;
  selected?: boolean;
  onSelect?: (symbol: string) => void;
  onEnter: (symbol: string, cx: number, cy: number) => void;
  onLeave: (symbol: string) => void;
}) {
  const { x, y, w, h } = placed;
  const cell = placed.item.cell;
  const errored = !!cell.error;
  const positive = cell.changePct >= 0;

  // Inset 1px on right/bottom → uniform 1px hairline trench between tiles.
  const tw = Math.max(0, w - 1);
  const th = Math.max(0, h - 1);

  // Size tiers (px). Each higher tier is a superset of what the one below shows.
  const xl = tw >= 100 && th >= 60;
  const large = !xl && tw >= 66 && th >= 44;
  const medium = !xl && !large && tw >= 46 && th >= 28;
  const small = !xl && !large && !medium && tw >= 30 && th >= 16;   // signed % (color-not-only)
  const micro = !xl && !large && !medium && !small && tw >= 15 && th >= 11; // ▲/▼ glyph

  let bg: string, borderColor: string, hoverBorder: string;
  if (errored) {
    bg = "oklch(0.105 0 0)"; borderColor = "oklch(0.18 0 0)"; hoverBorder = "oklch(0.3 0 0)";
  } else {
    const c = tileColor(cell.changePct, tf);
    bg = c.fill; borderColor = c.border; hoverBorder = c.hoverBorder;
  }

  const ariaDir = errored
    ? "no data"
    : `${positive ? "up" : "down"} ${Math.abs(cell.changePct).toFixed(2)} percent`;
  const textShadow = "0 1px 2px oklch(0.06 0 0 / 0.7)";
  const selectable = !!onSelect && !errored;

  const handleEnter = (e: React.MouseEvent<HTMLDivElement> | React.FocusEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onEnter(cell.symbol, r.left + r.width / 2, r.top);
  };
  const handleLeave = () => onLeave(cell.symbol);
  const handleSelect = () => { if (selectable) onSelect!(cell.symbol); };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${cell.name}, ${cell.symbol}, ${cell.sector}, ${ariaDir}${selectable ? ", select to trade" : ""}`}
      aria-pressed={onSelect ? !!selected : undefined}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      onClick={handleSelect}
      onKeyDown={(e) => { if (selectable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); handleSelect(); } }}
      className="stile absolute flex flex-col items-center justify-center overflow-hidden cursor-pointer focus:outline-none"
      style={{
        left: x, top: y, width: tw, height: th,
        background: bg,
        border: `1px solid ${selected ? `oklch(${AMBER})` : hovered ? hoverBorder : borderColor}`,
        boxShadow: selected ? `inset 0 0 0 2px oklch(${AMBER}), 0 0 0 1px oklch(${AMBER} / 0.5)` : "none",
        boxSizing: "border-box",
        filter: hovered && !errored ? "brightness(1.12)" : "none",
        transition,
        zIndex: selected ? 6 : hovered ? 5 : 1,
        opacity: errored ? 0.55 : 1,
      }}
    >
      {errored ? (
        (small || medium || large || xl) && (
          <span className="font-mono" style={{ fontSize: 10, color: "oklch(0.5 0.006 74)" }}>—</span>
        )
      ) : (
        <>
          {(xl || large || medium) && (
            <span
              className="font-mono px-0.5"
              style={{
                maxWidth: "96%", fontSize: xl ? 14 : large ? 12.5 : 11, fontWeight: 700,
                color: "oklch(0.99 0.005 74)", whiteSpace: "nowrap", overflow: "hidden",
                textOverflow: "ellipsis", textShadow, lineHeight: 1.1, letterSpacing: "0.01em",
              }}
            >
              {cell.symbol}
            </span>
          )}
          {(xl || large || medium || small) && (
            <span
              className="font-mono tabular-nums"
              style={{
                fontSize: xl ? 12.5 : large ? 11.5 : medium ? 10 : 9.5,
                fontWeight: small ? 700 : 600,
                color: "oklch(0.98 0.005 74)", textShadow, marginTop: xl || large || medium ? 1 : 0,
              }}
            >
              {signedPct(cell.changePct)}
            </span>
          )}
          {xl && (
            <span
              className="font-mono tabular-nums"
              style={{ fontSize: 10, color: "oklch(0.98 0.005 74 / 0.6)", textShadow, marginTop: 1 }}
            >
              {fmtPrice(cell.price)}
            </span>
          )}
          {/* color-not-only fallback for the tiniest legible tiles */}
          {micro && (
            <span
              aria-hidden
              className="font-sans"
              style={{ fontSize: 7.5, lineHeight: 1, color: "oklch(0.99 0.005 74 / 0.85)", textShadow }}
            >
              {positive ? "▲" : "▼"}
            </span>
          )}
        </>
      )}
    </div>
  );
});

/* ─── Crisp dark tooltip (the one allowed soft shadow — popover layer) ─── */
function Tooltip({ cell, cx, cy }: { cell: StockCell; cx: number; cy: number }) {
  const positive = cell.changePct >= 0;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
  const clampedX = Math.max(130, Math.min(cx, vw - 130));
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
        {cell.symbol} <span style={{ fontWeight: 400, color: "oklch(0.7 0.008 74)" }}>{cell.name}</span>
      </div>
      <div style={{ fontSize: 10.5, color: "oklch(0.6 0.008 74)", marginTop: 1 }}>
        {cell.sector} · ${cell.capB >= 1000 ? `${(cell.capB / 1000).toFixed(2)}T` : `${cell.capB.toFixed(0)}B`} cap
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
