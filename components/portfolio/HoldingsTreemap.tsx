"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatCurrencyCompact } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";
import { isFaceValueBond } from "@/lib/types";
import type { HoldingWithMetrics } from "@/lib/types";
import type { HeatmapGroup } from "@/app/api/heatmap-views/route";

/* ──────────────────────────────────────────────────────────────────────────
   Holdings heatmap — the same "Quiet Quilt" squarified engine as the Paper-tab
   S&P 500 heatmap (components/stocks/StockTreemap.tsx), adapted to the user's
   own portfolio:
     · OUTER pass squarifies the sectors into 2D macro-blocks that fill the
       measured container (ResizeObserver px — never a fixed viewBox).
     · INNER pass squarifies each sector's holdings by POSITION VALUE.
   Tile AREA = position value; COLOR = daily or total return (per `colorBy`).
   DOM-div tiles → crisp Geist Mono numerals, native CSS hover/focus/ellipsis.
   color-not-only: every legible tile carries the SIGNED % (the +/− sign is a
   non-color direction cue) or a ▲/▼ glyph; the hover tooltip + aria-label cover
   the sub-glyph tiles. Cash tiles render in brand amber (no gain coloring).
   Below ~640px the outer pass falls back to a vertical stack of sector bands.
   ────────────────────────────────────────────────────────────────────────── */

const EMERALD = "0.72 0.15 152";
const RUBY = "0.66 0.19 25";
const AMBER = "0.72 0.14 74";

const LABEL_H = 20;      // reserved label strip atop each sector block
const MIN_BAND_H = 120;  // floor for the narrow vertical-stack fallback

interface HCell {
  id: string;          // holding id — stable, unique layout & ordering identity
  symbol: string;      // ticker — selection identity
  label: string;       // tile text (compact for options: "SPY 510C")
  name: string;
  sector: string;
  value: number;       // |position value| → tile area (shorts sized by exposure)
  signedValue: number; // real market value for display (negative = short liability)
  changePct: number;   // daily or total return, per colorBy
  price: number;
  isCash: boolean;
}

function fmtPrice(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
/** "Iron Condor — SPY" → "IC"; unrecognized "4-leg strategy" → "×4". */
function strategyAbbrev(name: string): string {
  const strat = name.split(" — ")[0];
  const legs = strat.match(/^(\d+)-leg/);
  if (legs) return `×${legs[1]}`;
  return (strat.match(/\b[A-Za-z]/g) ?? []).join("").toUpperCase();
}
function signedPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/* ─── Color: alpha scales with move magnitude, normalized by `scale` ─── */
function tileColor(pct: number, scale: number) {
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
   Squarified treemap (Bruls/Huizing/van Wijk). Lays each committed row along
   the SHORT edge so tiles trend toward squares. Used for BOTH levels.
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

/* ──────────────────────────────────────────────────────────────────────────
   Strip treemap (Bederson/Shneiderman/Wattenberg) — the ORDER-PRESERVING layout
   used by custom views. Unlike squarify (which sorts by area), this walks nodes
   in the given order and greedily packs left-to-right rows, closing a row when
   the next tile would worsen its average aspect ratio. Reading order (row-major)
   equals the user's dragged order, while tiles stay sized by value.
   ────────────────────────────────────────────────────────────────────────── */
function rowAvgAspect<T>(row: SqNode<T>[], width: number): number {
  const area = row.reduce((s, r) => s + r.area, 0);
  if (area <= 0) return Infinity;
  const rowH = area / width;
  let sum = 0;
  for (const r of row) {
    const tileW = r.area / rowH;
    if (tileW <= 0 || rowH <= 0) return Infinity;
    sum += Math.max(tileW / rowH, rowH / tileW);
  }
  return sum / row.length;
}

function stripTreemap<T>(
  nodes: SqNode<T>[],
  x: number,
  y: number,
  width: number,
  height: number,
): Placed<T>[] {
  const out: Placed<T>[] = [];
  if (width <= 0 || height <= 0 || nodes.length === 0) return out;
  const total = nodes.reduce((s, n) => s + n.area, 0);
  if (total <= 0) return out;

  const scale = (width * height) / total;
  const items = nodes.map((n) => ({ item: n.item, area: Math.max(n.area * scale, 1e-6) }));

  let i = 0;
  let cy = y;
  const n = items.length;
  while (i < n) {
    let row: SqNode<T>[] = [items[i]];
    let next = i + 1;
    while (next < n) {
      const candidate = row.concat(items[next]);
      // Add the next tile only while it keeps the row closer to square.
      if (rowAvgAspect(candidate, width) <= rowAvgAspect(row, width)) {
        row = candidate;
        next++;
      } else break;
    }
    const rowArea = row.reduce((s, r) => s + r.area, 0);
    const rowH = rowArea / width;
    let cx = x;
    for (const r of row) {
      const tileW = r.area / rowH;
      out.push({ item: r.item, x: cx, y: cy, w: tileW, h: rowH });
      cx += tileW;
    }
    cy += rowH;
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
  items: HCell[];
  value: number;
  aggPct: number;   // value-weighted mean % change (priced holdings only)
  priced: number;   // # of non-cash holdings (drives whether the agg % shows)
  up: number;
  down: number;
}
interface SectorBlock extends Placed<SectorGroup> {
  tiles: Placed<{ cell: HCell }>[];
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

export function HoldingsTreemap({
  holdings,
  colorBy,
  onSelect,
  selected,
  layout = "sector",
  groups,
  editable = false,
  onGroupsChange,
}: {
  holdings: HoldingWithMetrics[];
  colorBy: "daily" | "total";
  onSelect?: (ticker: string) => void;
  selected?: string;
  /** "sector" = traditional squarified (Auto view); "custom" = user-defined
   *  named sectors + order-preserving tiles (custom views). */
  layout?: "sector" | "custom";
  /** User's named sectors (custom layout). A single group with an empty name
   *  renders flat (no label). Holdings not in any group fall to an "Unsorted"
   *  trailing group; unknown ids are ignored — so a view survives buys/sells. */
  groups?: HeatmapGroup[];
  /** Enable pointer drag (move tiles within/between sectors) + label editing. */
  editable?: boolean;
  /** Fired on any layout change (drag, rename, delete) with the full groups. */
  onGroupsChange?: (groups: HeatmapGroup[]) => void;
}) {
  const scale = colorBy === "daily" ? 3 : 20;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<HoverState | null>(null);
  const reduce = usePrefersReducedMotion();
  const custom = layout === "custom";

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setDims({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cells = useMemo<HCell[]>(
    () =>
      holdings.map((h) => {
        const isCash = h.ticker === "CASH" && (h.sector || "").toLowerCase() === "cash";
        const sector = isCash
          ? "Cash"
          : (h.sector ?? "").trim() && h.sector !== "Other"
            ? h.sector
            : "Other";
        const isOption = h.instrumentType === "option";
        // Merged strategy rows (one tile per combo) come in with a synthetic
        // "combo-" id and a "Iron Condor — SPY" name → label "SPY IC".
        const isComboTile = isOption && h.comboId != null && h.id.startsWith("combo-");
        return {
          id: h.id,
          symbol: h.ticker,
          // Option tickers ("SPY 2026-08-21 510 CALL") never fit a tile.
          label: isComboTile
            ? `${h.underlying} ${strategyAbbrev(h.name)}`
            : isOption && h.underlying && h.strike != null
              ? `${h.underlying} ${h.strike}${(h.optionType ?? "C")[0]}`
              : h.ticker,
          name: h.name,
          sector,
          // Shorts carry negative market value — size the tile by exposure,
          // display the signed value.
          value: Math.max(Math.abs(h.value), 1),
          signedValue: h.value,
          changePct: colorBy === "daily" ? h.todayChangePct : h.gainPercent,
          // Bonds show a clean price (98.50), not currentPrice (0.985).
          price: isFaceValueBond(h) ? h.currentPrice * 100 : h.currentPrice,
          isCash,
        };
      }),
    [holdings, colorBy],
  );

  const sectorGroups = useMemo<SectorGroup[]>(() => {
    const map = new Map<string, HCell[]>();
    for (const c of cells) {
      if (!map.has(c.sector)) map.set(c.sector, []);
      map.get(c.sector)!.push(c);
    }
    return [...map.entries()]
      .map(([sector, items]) => {
        items.sort((a, b) => b.value - a.value || a.symbol.localeCompare(b.symbol));
        const value = items.reduce((s, c) => s + c.value, 0);
        const priced = items.filter((c) => !c.isCash);
        const wsum = priced.reduce((s, c) => s + c.value, 0) || 1;
        const aggPct = priced.reduce((s, c) => s + c.value * c.changePct, 0) / wsum;
        const up = priced.filter((c) => c.changePct >= 0).length;
        return { sector, items, value, aggPct, priced: priced.length, up, down: priced.length - up };
      })
      .sort((a, b) => b.value - a.value);
  }, [cells]);

  const narrow = dims.w > 0 && dims.w < 640;

  const { blocks, contentH } = useMemo<{ blocks: SectorBlock[]; contentH: number }>(() => {
    if (dims.w <= 0 || sectorGroups.length === 0) return { blocks: [], contentH: 0 };

    let sectorRects: Placed<SectorGroup>[];
    let totalH: number;

    if (narrow) {
      totalH = Math.max(dims.h, sectorGroups.length * MIN_BAND_H);
      const heights = solveBandHeights(sectorGroups.map((g) => g.value), totalH, MIN_BAND_H);
      let y = 0;
      sectorRects = sectorGroups.map((g, i) => {
        const r = { item: g, x: 0, y, w: dims.w, h: heights[i] };
        y += heights[i];
        return r;
      });
    } else {
      totalH = dims.h;
      sectorRects = squarify(
        sectorGroups.map((g) => ({ item: g, area: g.value })),
        0, 0, dims.w, dims.h
      );
    }

    const blocks: SectorBlock[] = sectorRects.map((r) => {
      const tiles = squarify(
        r.item.items.map((cell) => ({ item: { cell }, area: cell.value })),
        r.x, r.y + LABEL_H, r.w, Math.max(1, r.h - LABEL_H)
      );
      return { ...r, tiles };
    });

    return { blocks, contentH: totalH };
  }, [sectorGroups, dims, narrow]);

  /* ─── Custom-view layout (user-named sectors) + drag ─── */
  const [dragId, setDragId] = useState<string | null>(null);
  // Working groups (ids) during a drag; null when idle → derived from props.
  const [dragGroups, setDragGroups] = useState<HeatmapGroup[] | null>(null);

  // Normalize props → concrete groups of live cells, in stored order. Unknown
  // ids drop out; unassigned holdings gather into a trailing "Unsorted" group.
  // While editing, empty groups are kept as droppable placeholders.
  const customGroups = useMemo<{ name: string; cells: HCell[] }[]>(() => {
    if (!custom) return [];
    const byId = new Map(cells.map((c) => [c.id, c]));
    const assigned = new Set<string>();
    const src = dragGroups ?? groups ?? [];
    const gs = src.map((g) => {
      const gc: HCell[] = [];
      for (const id of g.ids) {
        const c = byId.get(id);
        if (c && !assigned.has(id)) { assigned.add(id); gc.push(c); }
      }
      return { name: g.name ?? "", cells: gc };
    });
    const leftovers = cells
      .filter((c) => !assigned.has(c.id))
      .sort((a, b) => b.value - a.value || a.symbol.localeCompare(b.symbol));
    if (leftovers.length) gs.push({ name: gs.length ? "Unsorted" : "", cells: leftovers });
    return editable ? gs : gs.filter((g) => g.cells.length > 0);
  }, [custom, cells, dragGroups, groups, editable]);

  const groupTotal = (g: { cells: HCell[] }) => g.cells.reduce((s, c) => s + c.value, 0);

  // Two-level layout: sectors squarified by value (compact, like Auto), tiles
  // strip-treemapped inside each in the user's order. A single unnamed group
  // fills flat with no label.
  const customBlocks = useMemo(() => {
    if (!custom || dims.w <= 0 || customGroups.length === 0) return [];
    const grouped = customGroups.length > 1 || (customGroups[0]?.name ?? "") !== "";

    let outer: Placed<{ name: string; cells: HCell[] }>[];
    if (customGroups.length === 1) {
      outer = [{ item: customGroups[0], x: 0, y: 0, w: dims.w, h: dims.h }];
    } else {
      // While editing, floor each sector's weight so small/empty ones stay
      // easy to drop into; faithful areas resume once you're done.
      const sum = customGroups.reduce((s, g) => s + groupTotal(g), 0);
      const floor = editable ? sum * 0.06 : 0;
      outer = squarify(
        customGroups.map((g) => ({ item: g, area: Math.max(groupTotal(g), floor, 1) })),
        0, 0, dims.w, dims.h,
      );
    }

    return outer.map((o) => {
      const labeled = grouped;
      const top = o.y + (labeled ? LABEL_H : 0);
      const tiles = stripTreemap(
        o.item.cells.map((cell) => ({ item: { cell }, area: cell.value })),
        o.x, top, o.w, Math.max(1, o.h - (labeled ? LABEL_H : 0)),
      );
      return { x: o.x, y: o.y, w: o.w, h: o.h, name: o.item.name, labeled, tiles };
    });
  }, [custom, customGroups, dims, editable]);

  // Refs so the window drag listeners always see the latest layout.
  const blocksRef = useRef(customBlocks);
  blocksRef.current = customBlocks;
  // The working group structure (as ids) that a drag mutates.
  const workGroupsRef = useRef<HeatmapGroup[]>([]);
  workGroupsRef.current = customGroups.map((g) => ({ name: g.name, ids: g.cells.map((c) => c.id) }));
  const dragMeta = useRef<{ symbol: string; startX: number; startY: number; grabDX: number; grabDY: number; moved: boolean } | null>(null);
  const [chip, setChip] = useState<{ x: number; y: number; w: number; h: number; cell: HCell } | null>(null);

  const startTileDrag = useCallback((cell: HCell, e: React.PointerEvent<HTMLDivElement>) => {
    if (!editable || !custom) return;
    const r = e.currentTarget.getBoundingClientRect();
    dragMeta.current = {
      symbol: cell.symbol, startX: e.clientX, startY: e.clientY,
      grabDX: e.clientX - r.left, grabDY: e.clientY - r.top, moved: false,
    };
    setDragGroups(workGroupsRef.current.map((g) => ({ name: g.name, ids: g.ids.slice() })));
    setDragId(cell.id);
    setChip({ x: e.clientX, y: e.clientY, w: r.width, h: r.height, cell });
    setHover(null);
  }, [editable, custom]);

  useEffect(() => {
    if (!dragId) return;
    const onMove = (e: PointerEvent) => {
      const meta = dragMeta.current;
      if (meta && !meta.moved && Math.hypot(e.clientX - meta.startX, e.clientY - meta.startY) > 4) meta.moved = true;
      setChip((c) => (c ? { ...c, x: e.clientX, y: e.clientY } : c));
      const wrap = wrapRef.current;
      if (!wrap) return;
      const wr = wrap.getBoundingClientRect();
      const px = e.clientX - wr.left;
      const py = e.clientY - wr.top;

      // Which sector block is the cursor over?
      let gi = -1;
      for (let k = 0; k < blocksRef.current.length; k++) {
        const b = blocksRef.current[k];
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) { gi = k; break; }
      }
      if (gi < 0) return;
      // Which tile in that block sits under the cursor? (insert before it)
      let beforeId: string | null = null;
      for (const t of blocksRef.current[gi].tiles) {
        if (t.item.cell.id === dragId) continue;
        if (px >= t.x && px <= t.x + t.w && py >= t.y && py <= t.y + t.h) { beforeId = t.item.cell.id; break; }
      }

      setDragGroups((prev) => {
        const cur = prev ?? workGroupsRef.current;
        const next = cur.map((g) => ({ name: g.name, ids: g.ids.slice() }));
        const tg = next[gi];
        if (!tg) return cur;
        // no-op if already in place
        const inTarget = tg.ids.indexOf(dragId);
        const targetPos = beforeId ? tg.ids.indexOf(beforeId) : tg.ids.length;
        if (inTarget !== -1 && (inTarget === targetPos || inTarget + 1 === targetPos)) return cur;
        for (const g of next) { const i = g.ids.indexOf(dragId); if (i >= 0) g.ids.splice(i, 1); }
        let at = tg.ids.length;
        if (beforeId) { const bi = tg.ids.indexOf(beforeId); if (bi >= 0) at = bi; }
        tg.ids.splice(at, 0, dragId);
        return next;
      });
    };
    const onUp = () => {
      const meta = dragMeta.current;
      if (meta?.moved) {
        // Persist, dropping empty groups (but never below one group).
        const cleaned = workGroupsRef.current.filter((g) => g.ids.length > 0);
        onGroupsChange?.(cleaned.length ? cleaned : workGroupsRef.current);
      } else if (meta && onSelect) {
        // A click (no drag) still selects the holding to chart it.
        const cell = cells.find((c) => c.id === dragId);
        if (cell && !cell.isCash) onSelect(cell.symbol);
      }
      setDragId(null);
      setDragGroups(null);
      setChip(null);
      dragMeta.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragId, onGroupsChange, onSelect, cells]);

  // Rename / delete a sector (edit mode). Both emit the full materialized groups.
  const emitFromCurrent = useCallback((mutate: (gs: HeatmapGroup[]) => HeatmapGroup[]) => {
    const base = customGroups.map((g) => ({ name: g.name, ids: g.cells.map((c) => c.id) }));
    onGroupsChange?.(mutate(base));
  }, [customGroups, onGroupsChange]);

  const renameGroup = useCallback((idx: number) => {
    const cur = customGroups[idx];
    if (!cur) return;
    const name = window.prompt("Sector name", cur.name || "Sector")?.trim();
    if (name == null) return;
    emitFromCurrent((gs) => gs.map((g, i) => (i === idx ? { ...g, name } : g)));
  }, [customGroups, emitFromCurrent]);

  const deleteGroup = useCallback((idx: number) => {
    // Merge the removed sector's holdings into the previous one (or the next),
    // so nothing disappears; never drop below a single group.
    emitFromCurrent((gs) => {
      if (gs.length <= 1) return gs;
      const removed = gs[idx];
      const into = idx > 0 ? idx - 1 : 1;
      const next = gs.map((g, i) => (i === into ? { ...g, ids: [...g.ids, ...removed.ids] } : g));
      return next.filter((_, i) => i !== idx);
    });
  }, [emitFromCurrent]);

  const hoveredCell = hover && !dragId ? cells.find((c) => c.symbol === hover.symbol) ?? null : null;
  const transition = reduce ? "none" : "filter 150ms ease, border-color 150ms ease";

  // Stable handlers so the memoized Tile only re-renders the 1-2 tiles whose
  // hovered/selected state actually flips on each mouse event.
  const handleEnter = useCallback((symbol: string, cx: number, cy: number) => setHover({ symbol, cx, cy }), []);
  const handleLeave = useCallback((symbol: string) => setHover((h) => (h?.symbol === symbol ? null : h)), []);

  return (
    <div
      ref={wrapRef}
      className={`relative h-full w-full ${narrow ? "overflow-y-auto" : "overflow-hidden"}`}
      role="figure"
      aria-label={`Portfolio heatmap by sector, colored by ${colorBy === "daily" ? "daily change" : "total return"}`}
    >
      {/* Amber focus ring (single-lamp rule) on keyboard focus only — not on mouse hover. */}
      <style>{`.hmtile:focus-visible{outline:2px solid oklch(${AMBER});outline-offset:-2px;z-index:7;}`}</style>
      <div style={{ position: "relative", width: "100%", height: custom ? "100%" : (contentH || "100%") }}>
        {custom
          ? customBlocks.map((b, gi) => (
              <div key={`${b.name}-${gi}`}>
                {b.labeled && (
                  <div
                    className="absolute flex items-center gap-1.5 select-none"
                    style={{ left: b.x + 6, top: b.y + 3, maxWidth: b.w - 10, height: LABEL_H - 4 }}
                  >
                    <span
                      onClick={editable ? () => renameGroup(gi) : undefined}
                      className="font-sans"
                      style={{
                        fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
                        textTransform: "uppercase", color: b.name === "Unsorted" ? "oklch(0.5 0.006 74)" : "oklch(0.72 0.09 74)",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        cursor: editable ? "text" : "default",
                      }}
                      title={editable ? "Click to rename this sector" : b.name}
                    >
                      {b.name || (editable ? "＋ name this sector" : "")}
                    </span>
                    {editable && customGroups.length > 1 && (
                      <button
                        onClick={() => deleteGroup(gi)}
                        className="font-sans shrink-0"
                        style={{ fontSize: 12, lineHeight: 1, color: "oklch(0.5 0.02 74)" }}
                        title="Remove sector (its holdings move to a neighbor)"
                      >
                        ×
                      </button>
                    )}
                  </div>
                )}
                {b.tiles.map((t) => (
                  <Tile
                    key={t.item.cell.id}
                    placed={t}
                    scale={scale}
                    transition={dragId ? "none" : transition}
                    hovered={hover?.symbol === t.item.cell.symbol}
                    selected={selected === t.item.cell.symbol}
                    onSelect={onSelect}
                    onEnter={handleEnter}
                    onLeave={handleLeave}
                    maskPct={colorBy === "total"}
                    editable={editable}
                    dragging={dragId === t.item.cell.id}
                    onDragStart={startTileDrag}
                  />
                ))}
              </div>
            ))
          : blocks.map((b) => (
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
              {b.item.priced > 0 && (
                <span
                  className="font-mono tabular-nums shrink-0"
                  style={{ fontSize: 10, color: b.item.aggPct >= 0 ? "var(--positive)" : "var(--negative)" }}
                >
                  {colorBy === "total" ? <Sensitive>{signedPct(b.item.aggPct)}</Sensitive> : signedPct(b.item.aggPct)}
                </span>
              )}
              {b.w > 240 && b.item.priced > 0 && (
                <span className="font-mono tabular-nums shrink-0" style={{ fontSize: 9.5, color: "oklch(0.46 0.006 74)" }}>
                  {b.item.up}↑ {b.item.down}↓
                </span>
              )}
            </div>

            {/* Tiles */}
            {b.tiles.map((t) => (
              <Tile
                key={t.item.cell.id}
                placed={t}
                scale={scale}
                transition={transition}
                hovered={hover?.symbol === t.item.cell.symbol}
                selected={selected === t.item.cell.symbol}
                onSelect={onSelect}
                onEnter={handleEnter}
                onLeave={handleLeave}
                maskPct={colorBy === "total"}
              />
            ))}
          </div>
        ))}
      </div>

      {chip && dragMeta.current && (
        <div
          className="font-mono flex items-center justify-center"
          style={{
            position: "fixed",
            left: chip.x - dragMeta.current.grabDX,
            top: chip.y - dragMeta.current.grabDY,
            width: Math.max(48, Math.min(chip.w, 160)),
            height: Math.max(28, Math.min(chip.h, 90)),
            pointerEvents: "none",
            zIndex: 80,
            background: chip.cell.isCash ? "var(--primary)" : tileColor(chip.cell.changePct, scale).fill,
            border: `1px solid oklch(${AMBER})`,
            borderRadius: 4,
            boxShadow: "0 8px 24px oklch(0 0 0 / 0.55)",
            color: chip.cell.isCash ? "oklch(0.18 0.03 74)" : "oklch(0.99 0.005 74)",
            fontSize: 12, fontWeight: 700,
            transform: "rotate(-1.5deg)",
          }}
        >
          {chip.cell.isCash ? "CASH" : chip.cell.label}
        </div>
      )}

      {hoveredCell && hover && <Tooltip cell={hoveredCell} cx={hover.cx} cy={hover.cy} maskPct={colorBy === "total"} />}
    </div>
  );
}

/* ─── A single tile (memoized — only re-renders on hovered/selected flip) ─── */
const Tile = memo(function Tile({
  placed, scale, transition, hovered, selected, onSelect, onEnter, onLeave, maskPct,
  editable = false, dragging = false, onDragStart,
}: {
  placed: Placed<{ cell: HCell }>;
  scale: number;
  transition: string;
  hovered: boolean;
  selected?: boolean;
  onSelect?: (symbol: string) => void;
  onEnter: (symbol: string, cx: number, cy: number) => void;
  onLeave: (symbol: string) => void;
  maskPct?: boolean;
  editable?: boolean;
  dragging?: boolean;
  onDragStart?: (cell: HCell, e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  const { x, y, w, h } = placed;
  const cell = placed.item.cell;
  const { isCash } = cell;
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
  if (isCash) {
    // Cash renders in the exact theme amber (--primary), full strength.
    bg = "var(--primary)"; borderColor = "var(--primary)"; hoverBorder = "var(--primary)";
  } else {
    const c = tileColor(cell.changePct, scale);
    bg = c.fill; borderColor = c.border; hoverBorder = c.hoverBorder;
  }

  const ariaDir = isCash
    ? "cash"
    : `${positive ? "up" : "down"} ${Math.abs(cell.changePct).toFixed(2)} percent`;
  const textShadow = "0 1px 2px oklch(0.06 0 0 / 0.7)";
  const selectable = !!onSelect && !isCash;
  const labelColor = isCash ? "oklch(0.18 0.03 74)" : "oklch(0.99 0.005 74)";

  const handleEnter = (e: React.MouseEvent<HTMLDivElement> | React.FocusEvent<HTMLDivElement>) => {
    if (editable) return; // no tooltip while arranging
    const r = e.currentTarget.getBoundingClientRect();
    onEnter(cell.symbol, r.left + r.width / 2, r.top);
  };
  const handleLeave = () => { if (!editable) onLeave(cell.symbol); };
  // In edit mode the parent owns click-vs-drag (via pointer events); the tile's
  // own onClick is disabled so a drop doesn't also fire a select.
  const handleSelect = () => { if (!editable && selectable) onSelect!(cell.symbol); };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${cell.name}, ${cell.symbol}, ${cell.sector}, ${ariaDir}${editable ? ", drag to reorder" : selectable ? ", select to chart" : ""}`}
      aria-pressed={onSelect ? !!selected : undefined}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      onClick={handleSelect}
      onPointerDown={editable && onDragStart ? (e) => { e.preventDefault(); onDragStart(cell, e); } : undefined}
      onKeyDown={(e) => { if (!editable && selectable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); handleSelect(); } }}
      className={`hmtile absolute flex flex-col items-center justify-center overflow-hidden focus:outline-none ${editable ? "cursor-grab" : selectable ? "cursor-pointer" : "cursor-default"}`}
      style={{
        left: x, top: y, width: tw, height: th,
        background: bg,
        border: `1px solid ${dragging ? `oklch(${AMBER})` : selected ? `oklch(${AMBER})` : hovered ? hoverBorder : borderColor}`,
        borderStyle: dragging ? "dashed" : "solid",
        boxShadow: selected && !dragging ? `inset 0 0 0 2px oklch(${AMBER}), 0 0 0 1px oklch(${AMBER} / 0.5)` : "none",
        boxSizing: "border-box",
        opacity: dragging ? 0.32 : 1,
        filter: hovered && !isCash && !editable ? "brightness(1.12)" : "none",
        transition,
        touchAction: editable ? "none" : undefined,
        zIndex: dragging ? 8 : selected ? 6 : hovered ? 5 : 1,
      }}
    >
      {(xl || large || medium) && (
        <span
          className="font-mono px-0.5"
          style={{
            maxWidth: "96%", fontSize: xl ? 14 : large ? 12.5 : 11, fontWeight: 700,
            color: labelColor, whiteSpace: "nowrap", overflow: "hidden",
            textOverflow: "ellipsis", textShadow: isCash ? "none" : textShadow, lineHeight: 1.1, letterSpacing: "0.01em",
          }}
        >
          {isCash ? "CASH" : cell.label}
        </span>
      )}
      {!isCash && (xl || large || medium || small) && (
        <span
          className="font-mono tabular-nums"
          style={{
            fontSize: xl ? 12.5 : large ? 11.5 : medium ? 10 : 9.5,
            fontWeight: small ? 700 : 600,
            color: "oklch(0.98 0.005 74)", textShadow, marginTop: xl || large || medium ? 1 : 0,
          }}
        >
          {maskPct ? <Sensitive>{signedPct(cell.changePct)}</Sensitive> : signedPct(cell.changePct)}
        </span>
      )}
      {(xl || large) && (
        <span
          className="font-mono tabular-nums"
          style={{ fontSize: 10, color: isCash ? "oklch(0.20 0.03 74)" : "oklch(0.98 0.005 74 / 0.6)", textShadow: isCash ? "none" : textShadow, marginTop: 1 }}
        >
          <Sensitive>{formatCurrencyCompact(cell.signedValue)}</Sensitive>
        </span>
      )}
      {/* color-not-only fallback for the tiniest legible non-cash tiles */}
      {!isCash && micro && (
        <span
          aria-hidden
          className="font-sans"
          style={{ fontSize: 7.5, lineHeight: 1, color: "oklch(0.99 0.005 74 / 0.85)", textShadow }}
        >
          {positive ? "▲" : "▼"}
        </span>
      )}
    </div>
  );
});

/* ─── Crisp dark tooltip (the one allowed soft shadow — popover layer) ─── */
function Tooltip({ cell, cx, cy, maskPct }: { cell: HCell; cx: number; cy: number; maskPct?: boolean }) {
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
        {cell.isCash ? "Cash" : cell.label}{" "}
        <span style={{ fontWeight: 400, color: "oklch(0.7 0.008 74)" }}>{cell.name}</span>
      </div>
      <div style={{ fontSize: 10.5, color: "oklch(0.6 0.008 74)", marginTop: 1 }}>
        {cell.sector} · <Sensitive>{formatCurrencyCompact(cell.signedValue)}</Sensitive>
      </div>
      {cell.isCash ? (
        <div style={{ fontSize: 11, color: "oklch(0.78 0.12 74)", marginTop: 4 }}>cash balance</div>
      ) : (
        <div className="tabular-nums" style={{ marginTop: 4, display: "flex", gap: 10, alignItems: "baseline" }}>
          <span style={{ fontSize: 12, color: "oklch(0.92 0.005 74)" }}>{fmtPrice(cell.price)}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: positive ? "var(--positive)" : "var(--negative)" }}>
            {maskPct ? <Sensitive>{signedPct(cell.changePct)}</Sensitive> : signedPct(cell.changePct)}
          </span>
        </div>
      )}
    </div>
  );
}
