"use client";

/**
 * Unified Positions tab for the Paper page (and Competitions "My positions").
 *
 * "Midnight Trading Desk" redesign:
 *  · Allocation donut (hover-synced with the row deck, click to jump)
 *  · High-density instrument row deck on a shared mono grid (no HTML tables)
 *  · Option strategies as cohesive packages: strategy badge, net debit/credit
 *    pill, ITM/OTM status vs live underlying spot, tree-connected legs
 *  · Expanded rows open an instrument console: price chart + stat cells +
 *    tactile trade panel (stepper / quick-fill / market submit); several rows
 *    can be open at once
 *  · Pending orders + realized log as a side-by-side terminal-tape HUD
 *
 * Paper money is play money — Private mode does NOT mask values here.
 */

import { useEffect, useId, useMemo, useState } from "react";
import nextDynamic from "next/dynamic";
import { formatCurrency, formatPercent } from "@/lib/format";
import { recognizeStrategy } from "@/lib/option-strategies";
import type { Leg } from "@/lib/options-math";
import type { AssetClass, PaperOrder, PaperPosition, RealizedTrade } from "@/lib/paper-types";
import type { SeriesRange } from "@/app/api/paper/series/route";

/* Recharts (SSR-disabled — project convention to avoid prerender errors) */
const AreaChart = nextDynamic(() => import("recharts").then((m) => m.AreaChart), { ssr: false });
const Area = nextDynamic(() => import("recharts").then((m) => m.Area), { ssr: false });
const XAxis = nextDynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = nextDynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const Tooltip = nextDynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const ResponsiveContainer = nextDynamic(() => import("recharts").then((m) => m.ResponsiveContainer), { ssr: false });
const PieChart = nextDynamic(() => import("recharts").then((m) => m.PieChart), { ssr: false });
const Pie = nextDynamic(() => import("recharts").then((m) => m.Pie), { ssr: false });
const Cell = nextDynamic(() => import("recharts").then((m) => m.Cell), { ssr: false });

const CHART_RANGES: SeriesRange[] = ["1D", "5D", "1M", "6M", "YTD"];
const CLASS_ORDER: AssetClass[] = ["STOCK", "OPTION", "FUTURE", "FOREX"];
const CLASS_LABEL: Record<AssetClass, string> = { STOCK: "Stocks", OPTION: "Options", FUTURE: "Futures", FOREX: "Forex" };

/* Shared row grid — header and rows must use the same template so the mono
   columns land on the exact same rails. Last 88px column is the action slot. */
const GRID_FULL = "minmax(210px,1.7fr) 62px 72px 96px 104px 112px 158px 64px 88px";
const GRID_READONLY = "minmax(210px,1.7fr) 62px 72px 96px 104px 112px 158px 64px";
const ROW_MIN_W = 880; // px — keeps the grid aligned inside overflow-x scroll

/* Tonal layers (Flat-Desk rule: hairlines + tone, no resting shadows) */
const SURFACE_SUNKEN = "oklch(0.10 0 0)";  // console wells, tape backgrounds
const SURFACE_HOVER = "oklch(0.145 0 0)";  // row hover / donut-sync brighten

/** Reconstruct a recognizable label for a combo from its position legs. */
export function comboLabel(rows: PaperPosition[]): string {
  const underlying = rows[0]?.underlying ?? rows[0]?.symbol ?? "";
  return `${underlying} · ${comboStrategyName(rows)}`;
}

/** Strategy name only (badge text) — shared with comboLabel. */
function comboStrategyName(rows: PaperPosition[]): string {
  const legs: Leg[] = rows.map((r) => ({
    type: r.assetClass === "STOCK" ? "stock" : r.optionType === "CALL" ? "call" : "put",
    side: r.direction === "LONG" ? "long" : "short",
    strike: r.strike ?? r.avgCost,
    expiry: 0,
    qty: r.qty,
    premium: r.avgCost,
    iv: 0,
  }));
  return recognizeStrategy(legs) ?? "Strategy";
}

/** Chart symbol for a position (options chart their underlying). */
function chartSymbol(p: PaperPosition): { symbol: string; note?: string } {
  switch (p.assetClass) {
    case "FOREX": return { symbol: `${p.symbol}=X` };
    case "OPTION": return { symbol: p.underlying ?? p.symbol, note: `Underlying · ${p.underlying}` };
    default: return { symbol: p.symbol };
  }
}

/** Signed money with explicit sign — color is never the only P/L indicator. */
function signed(v: number): string {
  return `${v >= 0 ? "+" : "−"}${formatCurrency(Math.abs(v))}`;
}
function plColor(v: number): string {
  return v >= 0 ? "var(--positive)" : "var(--negative)";
}

/** Slice fill: emerald gain / ruby loss (intensity scaled to unrealized %),
    amber for the cash slice. */
function sliceFill(unrealized: number | null, unrealizedPct: number): string {
  if (unrealized === null) return "var(--primary)"; // cash — brand amber
  const mag = Math.min(1, Math.abs(unrealizedPct) / 20);
  const alpha = 0.35 + 0.5 * Math.pow(mag, 0.7);
  return unrealized >= 0
    ? `oklch(0.68 0.13 152 / ${alpha.toFixed(2)})`
    : `oklch(0.62 0.15 28 / ${alpha.toFixed(2)})`;
}

/**
 * A position's contribution to account EQUITY (what the pie must sum to).
 * Leveraged assets (futures/forex) tie up only their margin plus open P/L —
 * NOT their full notional — so sizing by `exposure` overstates the account.
 * Cash-settled assets (stocks/long options) are worth their current mark.
 */
function equityValue(p: PaperPosition): number {
  if (p.assetClass === "FUTURE" || p.assetClass === "FOREX") {
    return Math.max(0, p.marginHeld + p.unrealized);
  }
  return Math.max(0, p.marketValue !== 0 ? p.marketValue : p.exposure);
}

/* Underlying spot cache — combo ITM/OTM badges share one fetch per symbol. */
const spotCache = new Map<string, number>();

interface Props {
  accountId: string;
  positions: PaperPosition[];
  realized: RealizedTrade[];
  orders: PaperOrder[];
  equity: number;
  cash: number;
  busy: boolean;
  onClose: (p: PaperPosition) => void;
  onCloseStrategy: (comboId: string, label: string) => void;
  onPlaced: () => void;
  /** Compact read-only variant (Competitions): no expand/trade/close actions. */
  readOnly?: boolean;
  /** Working orders for the HUD tape (Paper tab only). */
  pending?: PaperOrder[];
  onCancelOrder?: (id: string) => void;
}

export function PositionsDeck({
  accountId, positions, realized, orders, equity, cash, busy,
  onClose, onCloseStrategy, onPlaced, readOnly = false,
  pending = [], onCancelOrder,
}: Props) {
  // Several consoles can be open at once — expanding one never closes another.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  // Hover sync between the allocation donut and the row deck (position id).
  const [hovered, setHovered] = useState<string | null>(null);

  // First fill per symbol from the (recent) order history — best-effort entry date.
  const openedMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) {
      if (o.status !== "FILLED" || !o.filledAt) continue;
      const prev = m.get(o.symbol);
      if (!prev || o.filledAt < prev) m.set(o.symbol, o.filledAt);
    }
    return m;
  }, [orders]);

  const comboMap = new Map<string, PaperPosition[]>();
  const singles: PaperPosition[] = [];
  for (const p of positions) {
    if (p.comboId) {
      const arr = comboMap.get(p.comboId) ?? [];
      arr.push(p);
      comboMap.set(p.comboId, arr);
    } else {
      singles.push(p);
    }
  }
  const combos = [...comboMap.entries()].map(([id, rows]) => ({ id, rows }));
  const grouped = CLASS_ORDER
    .map((cls) => ({ cls, rows: singles.filter((p) => p.assetClass === cls) }))
    .filter((g) => g.rows.length > 0);

  const empty = combos.length === 0 && grouped.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {!empty && (
        <AllocationPie
          positions={positions}
          cash={cash}
          equity={equity}
          hovered={hovered}
          setHovered={setHovered}
          onJump={(id) => {
            setExpanded((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
            document.getElementById(`pos-row-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }}
        />
      )}

      <section className="rounded-md border border-border bg-card">
        <header className="flex items-baseline justify-between gap-2 px-4 pt-3.5 pb-2.5 border-b border-border/60">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Open Positions</h2>
          {!empty && (
            <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
              {positions.length} {positions.length === 1 ? "position" : "positions"}
            </span>
          )}
        </header>

        {empty ? (
          <p className="text-sm text-muted-foreground px-4 py-5">No open positions — place your first paper trade.</p>
        ) : (
          <div className="flex flex-col gap-4 p-3">
            {grouped.map((g) => (
              <ClassGroup
                key={g.cls}
                cls={g.cls}
                rows={g.rows}
                equity={equity}
                expanded={expanded}
                onToggleRow={toggleExpanded}
                hovered={hovered}
                setHovered={setHovered}
                openedMap={openedMap}
                accountId={accountId}
                busy={busy}
                onClose={onClose}
                onPlaced={onPlaced}
                readOnly={readOnly}
              />
            ))}

            {combos.length > 0 && (
              <div>
                <GroupRail
                  label="Option Strategies"
                  count={combos.length}
                  subtotal={combos.reduce((s, c) => s + c.rows.reduce((x, r) => x + r.unrealized, 0), 0)}
                />
                <div className="flex flex-col gap-2 mt-2">
                  {combos.map((c) => (
                    <StrategyPackage
                      key={c.id}
                      combo={c}
                      equity={equity}
                      expanded={expanded.has(`combo:${c.id}`)}
                      onToggle={() => toggleExpanded(`combo:${c.id}`)}
                      busy={busy}
                      onCloseStrategy={onCloseStrategy}
                      readOnly={readOnly}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {!readOnly && (
        <LedgerHud
          pending={pending}
          realized={realized}
          busy={busy}
          onCancelOrder={onCancelOrder}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════ Allocation donut ═══════════════════════════ */

interface Slice {
  id: string;
  label: string;
  name: string;
  value: number;      // exposure USD (drives the arc)
  pct: number;        // 0-100 of the account pie
  unrealized: number | null;  // null = the cash slice
  unrealizedPct: number;
  color: string;      // steel-ramp identity fill (cash = inert gray)
}

function AllocationPie({
  positions, cash, equity, hovered, setHovered, onJump,
}: {
  positions: PaperPosition[];
  cash: number;
  equity: number;
  hovered: string | null;
  setHovered: (id: string | null) => void;
  onJump: (id: string) => void;
}) {
  if (equity <= 0) return null;

  // Slices are sized by each position's contribution to EQUITY (not gross
  // exposure), and cash is the balancing slice, so the pie always sums to the
  // account's equity — matching the Equity KPI above.
  const positionsDeployed = positions.reduce((s, p) => s + equityValue(p), 0);
  const cashSlice = Math.max(0, equity - positionsDeployed);
  const denom = positionsDeployed + cashSlice; // ≈ equity; drives slice %

  const slices: Slice[] = [...positions]
    .map((p) => ({ p, val: equityValue(p) }))
    .sort((a, b) => b.val - a.val)
    .map(({ p, val }) => ({
      id: p.id,
      label: p.symbol,
      name: p.name,
      value: val,
      pct: denom > 0 ? (100 * val) / denom : 0,
      unrealized: p.unrealized,
      unrealizedPct: p.unrealizedPct,
      color: sliceFill(p.unrealized, p.unrealizedPct),
    }));
  if (cashSlice > 0) {
    slices.push({ id: "__cash", label: "CASH", name: "Cash", value: cashSlice, pct: denom > 0 ? (100 * cashSlice) / denom : 0, unrealized: null, unrealizedPct: 0, color: sliceFill(null, 0) });
  }

  const anyHot = hovered !== null && slices.some((s) => s.id === hovered);

  return (
    <div className="rounded-md border border-border bg-card px-4 pt-3.5 pb-4">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Allocation</h2>
        <span className="text-[11px] font-mono text-muted-foreground">green gain · red loss · amber cash</span>
      </div>

      <div className="flex flex-col items-center gap-4 sm:flex-row" onMouseLeave={() => setHovered(null)}>
        {/* donut */}
        <div className="relative h-52 w-52 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="label"
                innerRadius="62%"
                outerRadius="96%"
                paddingAngle={1.5}
                stroke="oklch(0.08 0 0)"
                strokeWidth={1}
                isAnimationActive={false}
                onMouseEnter={(_, i) => { const s = slices[i]; if (s && s.unrealized !== null) setHovered(s.id); }}
                onMouseLeave={() => setHovered(null)}
                onClick={(_, i) => { const s = slices[i]; if (s && s.unrealized !== null) onJump(s.id); }}
              >
                {slices.map((s) => (
                  <Cell
                    key={s.id}
                    fill={s.color}
                    fillOpacity={anyHot && hovered !== s.id ? 0.35 : 1}
                    cursor={s.unrealized !== null ? "pointer" : "default"}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: "var(--popover)", border: "1px solid oklch(0.20 0 0)", borderRadius: 4, fontSize: 12 }}
                itemStyle={{ color: "oklch(0.94 0.005 74)" }}
                formatter={(v, _name, entry) => {
                  const s = entry?.payload as Slice | undefined;
                  const money = formatCurrency(Number(v));
                  const pl = s && s.unrealized !== null ? ` · ${signed(s.unrealized)} (${formatPercent(s.unrealizedPct)})` : "";
                  return [`${money} · ${s?.pct.toFixed(1)}%${pl}`, s?.label];
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* center readout */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-sm tabular-nums text-foreground">{formatCurrency(equity)}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">equity</span>
          </div>
        </div>

        {/* legend — the mirror hover/click surface for the row deck */}
        <ul className="grid w-full flex-1 grid-cols-1 gap-x-4 sm:grid-cols-2" role="list">
          {slices.map((s) => {
            const isCash = s.unrealized === null;
            const isHot = hovered === s.id;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={isCash}
                  onMouseEnter={() => { if (!isCash) setHovered(s.id); }}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => { if (!isCash) setHovered(s.id); }}
                  onBlur={() => setHovered(null)}
                  onClick={() => { if (!isCash) onJump(s.id); }}
                  className="grid w-full items-center gap-x-2 rounded-sm px-1.5 py-1 text-left transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                  style={{ gridTemplateColumns: "10px 1fr 48px 90px", background: isHot ? SURFACE_HOVER : "transparent" }}
                  aria-label={`${s.name} — ${s.pct.toFixed(1)}% of account, ${formatCurrency(s.value)}${isCash ? "" : `, unrealized ${formatPercent(s.unrealizedPct)}`}`}
                >
                  <span aria-hidden className="h-2 w-2 rounded-[1px]" style={{ background: s.color }} />
                  <span className={`truncate font-mono text-[11px] ${isCash ? "text-muted-foreground" : "text-foreground"}`}>{s.label}</span>
                  <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">{s.pct.toFixed(1)}%</span>
                  <span className="text-right font-mono text-[11px] tabular-nums" style={isCash ? { color: "var(--muted-foreground)" } : { color: plColor(s.unrealized!) }}>
                    {isCash ? formatCurrency(s.value) : signed(s.unrealized!)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/* ═══════════════════════════ Row deck (per class) ═══════════════════════════ */

/** Group rail: class label + count + earned-color subtotal. */
function GroupRail({ label, count, subtotal }: { label: string; count: number; subtotal: number }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-border pb-1.5 px-1">
      <span className="text-xs font-medium uppercase tracking-[0.08em] text-foreground">{label}</span>
      <span className="text-[11px] font-mono text-muted-foreground tabular-nums">{count}</span>
      <span className="ml-auto text-xs font-mono tabular-nums" style={{ color: plColor(subtotal) }}>
        {signed(subtotal)}
      </span>
    </div>
  );
}

/** Bordered uppercase mono ticker chip. */
function SymbolBadge({ text }: { text: string }) {
  return (
    <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-foreground" style={{ background: SURFACE_SUNKEN }}>
      {text}
    </span>
  );
}

/** Direction micro-badge: solid dot + label, earned color (long gain / short risk). */
function SideBadge({ direction }: { direction: "LONG" | "SHORT" }) {
  const c = direction === "LONG" ? "var(--positive)" : "var(--negative)";
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-wide" style={{ color: c }}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {direction}
    </span>
  );
}

function ClassGroup({
  cls, rows, equity, expanded, onToggleRow, hovered, setHovered, openedMap, accountId, busy, onClose, onPlaced, readOnly,
}: {
  cls: AssetClass;
  rows: PaperPosition[];
  equity: number;
  expanded: Set<string>;
  onToggleRow: (id: string) => void;
  hovered: string | null;
  setHovered: (id: string | null) => void;
  openedMap: Map<string, string>;
  accountId: string;
  busy: boolean;
  onClose: (p: PaperPosition) => void;
  onPlaced: () => void;
  readOnly: boolean;
}) {
  const grid = readOnly ? GRID_READONLY : GRID_FULL;
  const subtotal = rows.reduce((s, r) => s + r.unrealized, 0);
  return (
    <div>
      <GroupRail label={CLASS_LABEL[cls]} count={rows.length} subtotal={subtotal} />
      <div className="overflow-x-auto">
        <div style={{ minWidth: ROW_MIN_W }}>
          {/* column header */}
          <div
            className="grid items-center gap-x-2 px-1 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground"
            style={{ gridTemplateColumns: grid }}
            aria-hidden
          >
            <span>Instrument</span>
            <span className="text-right">Side</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Avg</span>
            <span className="text-right">Last</span>
            <span className="text-right">Day P / L</span>
            <span className="text-right">Unreal. P / L</span>
            <span className="text-right">% Acct</span>
            {!readOnly && <span />}
          </div>

          {rows.map((r) => (
            <PositionRow
              key={r.id}
              r={r}
              grid={grid}
              pctAcct={equity > 0 ? (100 * r.exposure) / equity : 0}
              isOpen={expanded.has(r.id)}
              isHot={hovered === r.id}
              onHover={setHovered}
              onToggle={readOnly ? undefined : () => onToggleRow(r.id)}
              openedAt={openedMap.get(r.symbol)}
              accountId={accountId}
              busy={busy}
              onClose={onClose}
              onPlaced={onPlaced}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PositionRow({
  r, grid, pctAcct, isOpen, isHot, onHover, onToggle, openedAt, accountId, busy, onClose, onPlaced,
}: {
  r: PaperPosition;
  grid: string;
  pctAcct: number;
  isOpen: boolean;
  isHot: boolean;
  onHover: (id: string | null) => void;
  onToggle?: () => void;
  openedAt?: string;
  accountId: string;
  busy: boolean;
  onClose: (p: PaperPosition) => void;
  onPlaced: () => void;
}) {
  return (
    <div id={`pos-row-${r.id}`} className="border-b border-border/50 last:border-0">
      <div
        className={`grid items-center gap-x-2 rounded-sm px-1 py-2 transition-colors duration-150 ${onToggle ? "cursor-pointer" : ""}`}
        style={{
          gridTemplateColumns: grid,
          background: isHot || isOpen ? SURFACE_HOVER : "transparent",
          // Amber rail marks each open console.
          boxShadow: isOpen ? "inset 2px 0 0 var(--primary)" : undefined,
        }}
        onMouseEnter={() => onHover(r.id)}
        onMouseLeave={() => onHover(null)}
        onClick={onToggle}
        {...(onToggle ? {
          role: "button" as const,
          tabIndex: 0,
          "aria-expanded": isOpen,
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } },
        } : {})}
      >
        {/* instrument */}
        <span className="flex min-w-0 items-center gap-2">
          {onToggle && (
            <span aria-hidden className="inline-block w-3 shrink-0 text-[10px] text-muted-foreground transition-transform duration-150" style={{ transform: isOpen ? "rotate(90deg)" : "none" }}>▸</span>
          )}
          <SymbolBadge text={r.assetClass === "OPTION" ? (r.underlying ?? r.symbol) : r.symbol} />
          <span className="truncate font-mono text-xs text-muted-foreground">{r.name}</span>
        </span>

        <span className="text-right"><SideBadge direction={r.direction} /></span>
        <span className="text-right font-mono text-sm tabular-nums text-foreground">{r.qty}</span>
        <span className="text-right font-mono text-sm tabular-nums text-muted-foreground">{formatCurrency(r.avgCost)}</span>
        <span className="text-right font-mono text-sm tabular-nums text-foreground">
          {formatCurrency(r.price)}
          {!r.livePrice && <span className="text-xs text-muted-foreground" title="Live quote unavailable"> *</span>}
        </span>
        <span className="text-right font-mono text-sm tabular-nums" style={r.dayPL != null ? { color: plColor(r.dayPL) } : {}}>
          {r.dayPL != null ? signed(r.dayPL) : <span className="text-muted-foreground">—</span>}
        </span>
        <span className="text-right font-mono text-sm tabular-nums" style={{ color: plColor(r.unrealized) }}>
          {signed(r.unrealized)} <span className="text-[11px]">({formatPercent(r.unrealizedPct)})</span>
        </span>
        <span className="text-right font-mono text-sm tabular-nums text-muted-foreground">{pctAcct.toFixed(1)}%</span>

        {/* action slot (hidden in read-only via grid template) */}
        {grid === GRID_FULL && (
          <span className="text-right">
            <button
              onClick={(e) => { e.stopPropagation(); onClose(r); }}
              disabled={busy}
              className="rounded-sm border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors duration-150 hover:border-input hover:text-foreground disabled:opacity-40"
            >
              Close
            </button>
          </span>
        )}
      </div>

      {isOpen && (
        <div className="pb-3 pt-1">
          <InstrumentConsole r={r} openedAt={openedAt} accountId={accountId} busy={busy} onClose={onClose} onPlaced={onPlaced} />
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════ Expanded instrument console ═══════════════════════ */

function InstrumentConsole({
  r, openedAt, accountId, busy, onClose, onPlaced,
}: {
  r: PaperPosition;
  openedAt?: string;
  accountId: string;
  busy: boolean;
  onClose: (p: PaperPosition) => void;
  onPlaced: () => void;
}) {
  const { symbol, note } = chartSymbol(r);
  return (
    <div className="grid grid-cols-1 gap-4 rounded-sm border border-border/70 p-3.5 lg:grid-cols-5" style={{ background: SURFACE_SUNKEN }}>
      {/* chart */}
      <div className="flex flex-col gap-1 lg:col-span-3">
        {note && <span className="font-mono text-[11px] text-muted-foreground">{note}</span>}
        <PositionChart symbol={symbol} />
      </div>

      {/* stats + trade panel */}
      <div className="flex flex-col gap-3.5 lg:col-span-2">
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-border/70" style={{ background: "var(--border)" }}>
          <StatCell label="Opened" value={openedAt ? new Date(openedAt).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }) : "—"} />
          <StatCell label="Exposure" value={formatCurrency(r.exposure)} />
          <StatCell label="Mkt value" value={formatCurrency(Math.abs(r.marketValue !== 0 ? r.marketValue : r.exposure))} />
          <StatCell label="Margin held" value={r.marginHeld > 0 ? formatCurrency(r.marginHeld) : "—"} />
          <StatCell label="Multiplier" value={`×${r.multiplier}`} />
          <StatCell label="Quote" value={r.livePrice ? "Live" : "Stale"} />
          {r.assetClass === "OPTION" && (
            <>
              <StatCell label="Strike" value={r.strike != null ? formatCurrency(r.strike) : "—"} />
              <StatCell label="Expiry" value={r.expiry ?? "—"} />
              <StatCell label="Type" value={r.optionType ?? "—"} />
            </>
          )}
        </div>

        <TradeConsole r={r} accountId={accountId} busy={busy} onPlaced={onPlaced} />

        <button
          onClick={() => onClose(r)}
          disabled={busy}
          className="self-start rounded-sm border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors duration-150 hover:border-input hover:text-foreground disabled:opacity-40"
        >
          Close position
        </button>
      </div>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-2.5 py-2" style={{ background: SURFACE_SUNKEN }}>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-[13px] tabular-nums text-foreground">{value}</span>
    </div>
  );
}

/* ─── Trade panel: stepper + quick-fill + tactile market submit ─── */

const QUICK_FILLS = [1, 10, 50, 100];

function TradeConsole({ r, accountId, busy, onPlaced }: { r: PaperPosition; accountId: string; busy: boolean; onPlaced: () => void }) {
  const [qty, setQty] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const side = r.direction === "LONG" ? "BUY" : "SELL";
  const valid = qty > 0;
  const estCost = qty * r.price * r.multiplier;

  const bump = (n: number) => setQty((q) => Math.max(0, q + n));

  async function place() {
    if (!valid || placing) return;
    setPlacing(true);
    setMsg(null);
    try {
      const payload: Record<string, unknown> = { accountId, assetClass: r.assetClass, side, orderType: "MARKET", qty };
      if (r.assetClass === "OPTION") {
        payload.underlying = r.underlying; payload.expiry = r.expiry; payload.strike = r.strike; payload.optionType = r.optionType;
      } else {
        payload.symbol = r.symbol;
      }
      const res = await fetch("/api/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) { setMsg({ ok: false, text: json.error ?? "Order rejected." }); return; }
      setMsg({ ok: true, text: `Added ${qty} @ ${formatCurrency(json.filled?.price ?? r.price)}.` });
      setQty(0);
      onPlaced();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Order failed." });
    } finally {
      setPlacing(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-border/70 p-2.5" style={{ background: "var(--card)" }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Add to position</span>
        <span className="font-mono text-[10px] text-muted-foreground">{side} to add · fills at market</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* stepper */}
        <div className="flex items-stretch overflow-hidden rounded-sm border border-input">
          <button
            type="button"
            onClick={() => bump(-1)}
            disabled={qty <= 0}
            aria-label="Decrease quantity"
            className="px-2.5 font-mono text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-30"
            style={{ background: SURFACE_SUNKEN }}
          >
            −
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={qty === 0 ? "" : qty}
            onChange={(e) => {
              const n = Math.floor(Number(e.target.value));
              setQty(Number.isFinite(n) && n > 0 ? n : 0);
            }}
            onClick={(e) => e.stopPropagation()}
            placeholder="0"
            aria-label={`Quantity to add to ${r.name}`}
            className="w-16 border-x border-input bg-card px-2 py-1.5 text-center font-mono text-sm tabular-nums text-foreground outline-none focus:border-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            type="button"
            onClick={() => bump(1)}
            aria-label="Increase quantity"
            className="px-2.5 font-mono text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
            style={{ background: SURFACE_SUNKEN }}
          >
            +
          </button>
        </div>

        {/* quick fills */}
        <div className="flex items-center gap-1">
          {QUICK_FILLS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => bump(n)}
              className="rounded-sm border border-border px-1.5 py-1 font-mono text-[11px] tabular-nums text-muted-foreground transition-colors duration-150 hover:border-input hover:text-foreground"
            >
              +{n}
            </button>
          ))}
        </div>

        {/* tactile submit — the console's single lamp */}
        <button
          onClick={place}
          disabled={!valid || placing || busy}
          className="ml-auto rounded-sm px-3 py-1.5 font-mono text-xs font-semibold transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-0 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:hover:translate-y-0"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
        >
          {placing ? "PLACING…" : `${side} ${valid ? qty : ""} @ MKT`}
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          Est. {side === "BUY" ? "cost" : "credit"}: {valid ? formatCurrency(estCost) : "—"}
        </span>
        {msg && (
          <p className="font-mono text-[11px]" role="status" style={{ color: msg.ok ? "var(--positive)" : "var(--negative)" }}>{msg.text}</p>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════ Option strategy packages (combos) ═══════════════════ */

function StrategyPackage({
  combo, equity, expanded, onToggle, busy, onCloseStrategy, readOnly,
}: {
  combo: { id: string; rows: PaperPosition[] };
  equity: number;
  expanded: boolean;
  onToggle: () => void;
  busy: boolean;
  onCloseStrategy: (comboId: string, label: string) => void;
  readOnly: boolean;
}) {
  const label = comboLabel(combo.rows);
  const strategy = comboStrategyName(combo.rows);
  const underlying = combo.rows[0]?.underlying ?? combo.rows[0]?.symbol ?? "";
  const unreal = combo.rows.reduce((s, r) => s + r.unrealized, 0);
  const exposure = combo.rows.reduce((s, r) => s + r.exposure, 0);
  const pctAcct = equity > 0 ? (100 * exposure) / equity : 0;

  // Net entry cost of the package: + = debit paid, − = credit received.
  const netEntry = combo.rows.reduce(
    (s, r) => s + (r.direction === "LONG" ? 1 : -1) * r.avgCost * r.qty * r.multiplier,
    0,
  );

  const moneyness = useMoneyness(underlying, combo.rows);

  return (
    <div className="rounded-sm border border-border/70 transition-colors duration-150 hover:border-input" style={{ background: "oklch(0.11 0 0)" }}>
      {/* package header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/60 px-3 py-2">
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span aria-hidden className="inline-block w-3 shrink-0 text-[10px] text-muted-foreground transition-transform duration-150" style={{ transform: expanded ? "rotate(90deg)" : "none" }}>▸</span>
          <SymbolBadge text={underlying} />
          {/* strategy badge — steel = non-semantic indicator */}
          <span className="rounded-sm border px-1.5 py-0.5 text-[10px] font-medium tracking-wide" style={{ color: "var(--steel)", borderColor: "oklch(0.64 0.07 240 / 0.35)" }}>
            {strategy}
          </span>
          {moneyness && (
            <span
              className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] tracking-wide"
              style={moneyness === "ITM"
                ? { color: "var(--positive)", background: "oklch(0.16 0.04 152)" }   // intrinsic value exists — earned emerald
                : { color: "var(--muted-foreground)", background: "oklch(0.16 0 0)" }}
            >
              {moneyness}
            </span>
          )}
        </button>

        <span className="flex shrink-0 items-center gap-3">
          {/* net debit/credit pill */}
          <span className="rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground" style={{ background: SURFACE_SUNKEN }}>
            {netEntry >= 0 ? "Net Debit " : "Net Credit "}
            {formatCurrency(Math.abs(netEntry))}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{pctAcct.toFixed(1)}% acct</span>
          <span className="font-mono text-xs tabular-nums" style={{ color: plColor(unreal) }}>{signed(unreal)}</span>
          {!readOnly && (
            <button
              onClick={() => onCloseStrategy(combo.id, label)}
              disabled={busy}
              className="rounded-sm border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors duration-150 hover:border-input hover:text-foreground disabled:opacity-50"
            >
              Close strategy
            </button>
          )}
        </span>
      </div>

      {/* legs — structural tree with a vertical connector */}
      <div className="ml-3.5 border-l border-border/80 py-1.5">
        {combo.rows.map((r) => (
          <div key={r.id} className="grid items-center gap-x-2 py-1.5 pl-3 pr-3" style={{ gridTemplateColumns: "12px minmax(140px,1.6fr) 62px 60px 96px 104px 110px" }}>
            <span aria-hidden className="h-px w-3 -ml-3" style={{ background: "oklch(0.20 0 0 / 0.8)" }} />
            <span className="truncate font-mono text-xs text-foreground">{r.name}</span>
            <span className="text-right"><SideBadge direction={r.direction} /></span>
            <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">×{r.qty}</span>
            <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">{formatCurrency(r.avgCost)}</span>
            <span className="text-right font-mono text-xs tabular-nums text-foreground">
              {formatCurrency(r.price)}{!r.livePrice && <span className="text-[10px] text-muted-foreground" title="Live quote unavailable"> *</span>}
            </span>
            <span className="text-right font-mono text-xs tabular-nums" style={{ color: plColor(r.unrealized) }}>
              {signed(r.unrealized)}
            </span>
          </div>
        ))}
      </div>

      {expanded && underlying && (
        <div className="border-t border-border/60 p-3">
          <span className="font-mono text-[11px] text-muted-foreground">Underlying · {underlying}</span>
          <PositionChart symbol={underlying} />
        </div>
      )}
    </div>
  );
}

/**
 * ITM/OTM for the package: intrinsic value of the option legs at the live
 * underlying spot (long legs add, short legs subtract; stock legs ignored).
 */
function useMoneyness(underlying: string, rows: PaperPosition[]): "ITM" | "OTM" | null {
  const [spot, setSpot] = useState<number | null>(spotCache.get(underlying) ?? null);

  useEffect(() => {
    if (!underlying || spotCache.has(underlying)) return;
    let cancelled = false;
    fetch(`/api/paper/quote?assetClass=STOCK&symbol=${encodeURIComponent(underlying)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || typeof d.price !== "number") return;
        spotCache.set(underlying, d.price);
        setSpot(d.price);
      })
      .catch(() => { /* badge simply doesn't render */ });
    return () => { cancelled = true; };
  }, [underlying]);

  if (spot == null) return null;
  const optionLegs = rows.filter((r) => r.assetClass === "OPTION" && r.strike != null);
  if (optionLegs.length === 0) return null;
  const intrinsic = optionLegs.reduce((s, r) => {
    const iv = r.optionType === "CALL" ? Math.max(0, spot - r.strike!) : Math.max(0, r.strike! - spot);
    return s + (r.direction === "LONG" ? 1 : -1) * iv * r.qty;
  }, 0);
  return intrinsic > 0 ? "ITM" : "OTM";
}

/* ═══════════════════════════ Price chart ═══════════════════════════ */

function PositionChart({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<SeriesRange>("1M");
  const [series, setSeries] = useState<{ date: string; price: number }[] | null>(null);
  const [pct, setPct] = useState(0);
  // Several consoles can chart the same symbol at once — keep gradient ids unique.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    let cancelled = false;
    setSeries(null);
    fetch(`/api/paper/series?symbol=${encodeURIComponent(symbol)}&range=${range}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setSeries(d.data ?? []);
        setPct(d.changePct ?? 0);
      })
      .catch(() => { if (!cancelled) setSeries([]); });
    return () => { cancelled = true; };
  }, [symbol, range]);

  const color = pct >= 0 ? "var(--positive)" : "var(--negative)";
  const intraday = range === "1D" || range === "5D";
  const gid = `pos-${symbol.replace(/[^a-zA-Z0-9]/g, "")}-${uid}`;
  const fmtPx = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(4));

  return (
    <div className="flex flex-col gap-2">
      {/* range selector — active tab earns the amber lamp */}
      <div className="flex items-center gap-1 self-end rounded-sm p-0.5" style={{ background: SURFACE_SUNKEN }}>
        {CHART_RANGES.map((r) => {
          const on = range === r;
          return (
            <button
              key={r}
              onClick={(e) => { e.stopPropagation(); setRange(r); }}
              aria-pressed={on}
              className="rounded-sm px-2 py-0.5 font-mono text-[11px] transition-colors duration-150"
              style={{ background: on ? "var(--card)" : "transparent", color: on ? "var(--primary)" : "var(--muted-foreground)" }}
            >
              {r}
            </button>
          );
        })}
      </div>
      <div style={{ height: 200 }}>
        {series === null ? (
          <div className="skeleton h-full w-full rounded-md" />
        ) : series.length < 2 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-muted-foreground">No price data available.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "oklch(0.64 0.008 74)" }}
                tickFormatter={(d: string) => (intraday ? d.slice(11, 16) : d.slice(5))}
                minTickGap={32}
                stroke="oklch(0.20 0 0)"
              />
              <YAxis
                tick={{ fontSize: 10, fill: "oklch(0.64 0.008 74)" }}
                tickFormatter={(v: number) => fmtPx(v)}
                domain={["auto", "auto"]}
                width={52}
                stroke="oklch(0.20 0 0)"
              />
              <Tooltip
                contentStyle={{ background: "var(--popover)", border: "1px solid oklch(0.20 0 0)", borderRadius: 4, fontSize: 12 }}
                labelStyle={{ color: "oklch(0.64 0.008 74)" }}
                labelFormatter={(d) => (intraday ? String(d).slice(0, 16).replace("T", " ") : String(d))}
                formatter={(v) => [fmtPx(Number(v)), "Price"] as [string, string]}
              />
              <Area type="monotone" dataKey="price" stroke={color} strokeWidth={1.5} fill={`url(#${gid})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

/* ═══════════════ Ledger HUD: pending orders + realized tape ═══════════════ */

function LedgerHud({
  pending, realized, busy, onCancelOrder,
}: {
  pending: PaperOrder[];
  realized: RealizedTrade[];
  busy: boolean;
  onCancelOrder?: (id: string) => void;
}) {
  const totalRealized = realized.reduce((s, r) => s + r.realizedPl, 0);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* working orders tape */}
      <section className="flex flex-col rounded-md border border-border bg-card">
        <header className="flex items-baseline gap-2 border-b border-border/60 px-4 pt-3.5 pb-2.5">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Working Orders</h2>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{pending.length}</span>
        </header>
        <div className="max-h-56 overflow-y-auto px-2 py-1" style={{ background: SURFACE_SUNKEN }}>
          {pending.length === 0 ? (
            <p className="px-2 py-3 font-mono text-xs text-muted-foreground">No working orders.</p>
          ) : (
            pending.map((o) => (
              <div key={o.id} className="flex items-center gap-2.5 border-b border-border/40 px-2 py-1.5 font-mono text-xs last:border-0">
                <span className="w-9 shrink-0 text-[11px]" style={{ color: o.side === "BUY" ? "var(--positive)" : "var(--negative)" }}>{o.side}</span>
                <span className="min-w-0 flex-1 truncate text-foreground">{o.symbol}</span>
                <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{o.qty}</span>
                {/* trigger target */}
                <span className="w-32 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  <span aria-hidden style={{ color: "var(--steel)" }}>◎ </span>
                  {o.limitPrice != null ? `LIMIT @ ${formatCurrency(o.limitPrice)}` : o.stopPrice != null ? `STOP @ ${formatCurrency(o.stopPrice)}` : o.orderType}
                </span>
                <StatusLamp status="PENDING" />
                {onCancelOrder && (
                  <button
                    onClick={() => onCancelOrder(o.id)}
                    disabled={busy}
                    className="shrink-0 text-[11px] text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {/* realized tape */}
      <section className="flex flex-col rounded-md border border-border bg-card">
        <header className="flex items-baseline gap-2 border-b border-border/60 px-4 pt-3.5 pb-2.5">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Closed Positions</h2>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{realized.length}</span>
          <span className="ml-auto font-mono text-xs tabular-nums" style={{ color: plColor(totalRealized) }}>
            {signed(totalRealized)} <span className="text-muted-foreground">realized</span>
          </span>
        </header>
        <div className="max-h-56 overflow-y-auto px-2 py-1" style={{ background: SURFACE_SUNKEN }}>
          {realized.length === 0 ? (
            <p className="px-2 py-3 font-mono text-xs text-muted-foreground">No closed positions yet.</p>
          ) : (
            <>
              {realized.slice(0, 50).map((r) => (
                <div key={r.id} className="flex items-center gap-2.5 border-b border-border/40 px-2 py-1.5 font-mono text-xs last:border-0">
                  <span className="min-w-0 flex-1 truncate text-foreground">{r.symbol}</span>
                  <span className="shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] text-muted-foreground" style={{ background: "oklch(0.16 0 0)" }}>
                    {CLASS_LABEL[r.assetClass] ?? r.assetClass}
                  </span>
                  <span className="w-24 shrink-0 text-right tabular-nums" style={{ color: plColor(r.realizedPl) }}>
                    {signed(r.realizedPl)}
                  </span>
                  <span className="w-20 shrink-0 text-right text-[10px] text-muted-foreground">
                    {new Date(r.closedAt).toLocaleDateString("en-US", { month: "short", day: "2-digit" })}
                  </span>
                </div>
              ))}
              {realized.length > 50 && (
                <p className="px-2 py-2 text-[10px] text-muted-foreground">Showing the 50 most recent of {realized.length}.</p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/** Compact status pill (shared visual language with the order tape). */
function StatusLamp({ status }: { status: PaperOrder["status"] }) {
  const map: Record<string, { color: string; bg: string }> = {
    FILLED: { color: "var(--positive)", bg: "oklch(0.16 0.04 152)" },
    CANCELLED: { color: "oklch(0.64 0.008 74)", bg: "oklch(0.16 0 0)" },
    REJECTED: { color: "var(--negative)", bg: "oklch(0.16 0.05 25)" },
    PENDING: { color: "var(--primary)", bg: "oklch(0.16 0.04 74)" },
  };
  const c = map[status] ?? map.CANCELLED;
  return (
    <span className="w-[4.5rem] shrink-0 rounded-sm px-1.5 py-0.5 text-center text-[10px] font-medium" style={{ color: c.color, background: c.bg }}>
      {status}
    </span>
  );
}
