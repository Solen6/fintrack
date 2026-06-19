"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency, formatPercent, formatShares } from "@/lib/format";
import type { SortField, SortDir, HoldingWithMetrics } from "@/lib/types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  holdings: HoldingWithMetrics[];
  account: string;
  onEdit?: (holding: HoldingWithMetrics, updates: { shares?: number; cost_basis?: number; notes?: string | null; drip?: boolean }) => Promise<void>;
  onClose?: (holding: HoldingWithMetrics) => void;
  onDelete?: (holding: HoldingWithMetrics) => Promise<void>;
}

export function HoldingsTable({ holdings, account, onEdit, onClose, onDelete }: Props) {
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({
    field: "value",
    dir: "desc",
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const base = holdings.filter((h) =>
      account === "all" ? true : h.account === account
    );

    return [...base].sort((a, b) => {
      const mul = sort.dir === "asc" ? 1 : -1;
      switch (sort.field) {
        case "ticker":      return mul * a.ticker.localeCompare(b.ticker);
        case "name":        return mul * a.name.localeCompare(b.name);
        case "sector":      return mul * a.sector.localeCompare(b.sector);
        case "shares":      return mul * (a.shares - b.shares);
        case "value":       return mul * (a.value - b.value);
        case "gainDollar":  return mul * (a.gainDollar - b.gainDollar);
        case "gainPercent": return mul * (a.gainPercent - b.gainPercent);
        default:            return 0;
      }
    });
  }, [holdings, account, sort]);

  const totalValue = useMemo(
    () => filtered.reduce((sum, h) => sum + h.value, 0),
    [filtered]
  );

  const toggleSort = (field: SortField) => {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "desc" }
    );
  };

  if (filtered.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No holdings found in this account.</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse min-w-[760px]">
          <thead>
            <tr className="border-b border-border">
              <Th field="ticker" sort={sort} onSort={toggleSort} className="w-20">Ticker</Th>
              <Th field="name" sort={sort} onSort={toggleSort} className="min-w-[160px]">Name</Th>
              <Th field="sector" sort={sort} onSort={toggleSort} className="min-w-[120px]">Sector</Th>
              <Th field="shares" sort={sort} onSort={toggleSort} align="right" className="w-20">Shares</Th>
              <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right w-24">Avg Cost</th>
              <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right w-24">Price</th>
              <Th field="value" sort={sort} onSort={toggleSort} align="right" className="w-28">Value</Th>
              <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right w-20">% Acct</th>
              <Th field="gainDollar" sort={sort} onSort={toggleSort} align="right" className="w-28">Gain</Th>
              <Th field="gainPercent" sort={sort} onSort={toggleSort} align="right" className="w-20">Gain %</Th>
              <th className="px-4 py-3 text-xs text-muted-foreground font-medium w-24 text-center">Account</th>
              {(onEdit || onClose || onDelete) && (
                <th className="px-4 py-3 text-xs text-muted-foreground font-medium w-32 text-center">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((h) => (
              <HoldingRow
                key={h.id}
                holding={h}
                weight={totalValue > 0 ? (h.value / totalValue) * 100 : 0}
                expanded={expandedId === h.id}
                onToggle={() => setExpandedId((prev) => (prev === h.id ? null : h.id))}
                onEdit={onEdit}
                onClose={onClose}
                onDelete={onDelete}
              />
            ))}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}

/* ─── Table header cell ─── */
interface ThProps {
  field: SortField;
  sort: { field: SortField; dir: SortDir };
  onSort: (f: SortField) => void;
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}

function Th({ field, sort, onSort, align = "left", className, children }: ThProps) {
  const active = sort.field === field;
  const isRight = align === "right";

  return (
    <th className={cn("px-4 py-3 text-xs font-medium", isRight ? "text-right" : "text-left", className)}>
      <button
        onClick={() => onSort(field)}
        className={cn(
          "flex items-center gap-1 transition-colors duration-150",
          isRight && "ml-auto",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {children}
        <SortArrow active={active} dir={sort.dir} />
      </button>
    </th>
  );
}

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className="text-xs leading-none" style={{ opacity: active ? 0.7 : 0.25 }} aria-hidden>
      {!active || dir === "desc" ? "↓" : "↑"}
    </span>
  );
}

/* ─── Security name — slides on hover to reveal the full text ─── */
function HoldingName({ name }: { name: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const measure = () => {
      const c = containerRef.current;
      const t = textRef.current;
      if (!c || !t) return;
      setOverflow(Math.max(0, t.scrollWidth - c.clientWidth));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [name]);

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const shift = hovered && overflow > 0 ? overflow : 0;
  const duration = reduceMotion ? 0 : Math.max(0.3, overflow / 60); // ~60px/sec
  const fade = overflow > 0 && !hovered;
  const fadeMask = "linear-gradient(to right, #000 78%, transparent 100%)";

  return (
    <div
      ref={containerRef}
      className="overflow-hidden"
      style={{
        maxWidth: 220,
        maskImage: fade ? fadeMask : undefined,
        WebkitMaskImage: fade ? fadeMask : undefined,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={name}
    >
      <span
        ref={textRef}
        className="inline-block whitespace-nowrap"
        style={{
          transform: `translateX(-${shift}px)`,
          transition: `transform ${duration}s linear`,
        }}
      >
        {name}
      </span>
    </div>
  );
}

/* ─── Holding row ─── */
interface RowProps {
  holding: HoldingWithMetrics;
  weight: number;
  expanded: boolean;
  onToggle: () => void;
  onEdit?: (holding: HoldingWithMetrics, updates: { shares?: number; cost_basis?: number; notes?: string | null; drip?: boolean }) => Promise<void>;
  onClose?: (holding: HoldingWithMetrics) => void;
  onDelete?: (holding: HoldingWithMetrics) => Promise<void>;
}

function HoldingRow({ holding: h, weight, expanded, onToggle, onEdit, onClose, onDelete }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [editShares, setEditShares] = useState(String(h.shares));
  const [editCost, setEditCost] = useState(String(h.costBasis));
  const [editNotes, setEditNotes] = useState(h.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const positive = h.gainDollar >= 0;
  const todayPositive = h.todayChangePct >= 0;

  const gainColor = positive ? "var(--positive)" : "var(--negative)";
  const todayColor = todayPositive ? "var(--positive)" : "var(--negative)";

  const accountLabel: Record<string, string> = {
    brokerage: "Broker",
    roth:      "Roth",
  };

  return (
    <>
      <tr
        className={cn("holdings-row border-b border-border/50 select-none", expanded && "expanded")}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onToggle()}
      >
        <td className="px-4 py-3">
          <span className="font-mono text-sm font-semibold text-foreground">{h.ticker}</span>
        </td>
        <td className="px-4 py-3 text-muted-foreground">
          <HoldingName name={h.name} />
        </td>
        <td className="px-4 py-3">
          <span className="text-xs text-muted-foreground">{h.sector || "—"}</span>
        </td>
        <td className="px-4 py-3 text-right font-mono text-muted-foreground text-sm">
          {formatShares(h.shares)}
        </td>
        <td className="px-4 py-3 text-right font-mono text-muted-foreground text-sm">
          {formatCurrency(h.costBasis)}
        </td>
        <td className="px-4 py-3 text-right">
          <Tooltip>
            <TooltipTrigger>
              <span className="font-mono text-sm text-foreground cursor-default">
                {formatCurrency(h.currentPrice)}
              </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs font-mono bg-popover border-border">
              <span style={{ color: todayColor }}>
                {h.todayChangePct >= 0 ? "+" : ""}
                {h.todayChangePct.toFixed(2)}% today
              </span>
            </TooltipContent>
          </Tooltip>
        </td>
        <td className="px-4 py-3 text-right font-mono text-sm text-foreground">
          {formatCurrency(h.value)}
        </td>
        <td className="px-4 py-3 text-right font-mono text-sm text-muted-foreground">
          {weight.toFixed(1)}%
        </td>
        <td className="px-4 py-3 text-right font-mono text-sm" style={{ color: gainColor }}>
          {h.gainDollar >= 0 ? "+" : ""}{formatCurrency(h.gainDollar)}
        </td>
        <td className="px-4 py-3 text-right font-mono text-sm" style={{ color: gainColor }}>
          {formatPercent(h.gainPercent)}
        </td>
        <td className="px-4 py-3 text-center">
          <span
            className="inline-block text-xs px-2 py-0.5 rounded-sm"
            style={{ background: "oklch(0.16 0 0)", color: "oklch(0.52 0.008 74)" }}
          >
            {accountLabel[h.account] ?? h.account}
          </span>
        </td>
        {(onEdit || onClose || onDelete) && (
          <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-center gap-1">
              {onEdit && (
                <button
                  onClick={() => {
                    setEditShares(String(h.shares));
                    setEditCost(String(h.costBasis));
                    setEditNotes(h.notes ?? "");
                    setEditing(true);
                  }}
                  className="text-xs px-1.5 py-0.5 rounded-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="Edit position"
                >
                  Edit
                </button>
              )}
              {onClose && (
                <button
                  onClick={() => onClose(h)}
                  className="text-xs px-1.5 py-0.5 rounded-sm hover:bg-accent transition-colors"
                  style={{ color: "var(--negative)" }}
                  title="Close position"
                >
                  Close
                </button>
              )}
              {onDelete && (
                <button
                  onClick={async () => {
                    if (!confirmDelete) {
                      setConfirmDelete(true);
                      return;
                    }
                    setDeleting(true);
                    await onDelete(h);
                    // Component unmounts on reload; reset is defensive.
                    setDeleting(false);
                    setConfirmDelete(false);
                  }}
                  onMouseLeave={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="text-xs px-1.5 py-0.5 rounded-sm hover:bg-accent transition-colors disabled:opacity-50"
                  style={{ color: "var(--negative)" }}
                  title={confirmDelete ? "Click again to permanently delete" : "Delete position (no realized gain recorded)"}
                >
                  {deleting ? "…" : confirmDelete ? "Sure?" : "Delete"}
                </button>
              )}
            </div>
          </td>
        )}
      </tr>

      {editing && onEdit && (
        <tr className="border-b border-border/50">
          <td colSpan={12} className="px-4 py-3">
            <form
              className="flex items-center gap-3 flex-wrap"
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                await onEdit(h, {
                  shares: parseFloat(editShares),
                  cost_basis: parseFloat(editCost),
                  notes: editNotes.trim() || null,
                });
                setSaving(false);
                setEditing(false);
              }}
            >
              <label className="text-xs text-muted-foreground">
                Shares
                <input
                  type="number"
                  step="any"
                  min="0"
                  className="ml-1.5 w-20 px-2 py-1 text-xs font-mono rounded-sm border border-border bg-transparent text-foreground focus:outline-none focus:border-[var(--primary)]"
                  value={editShares}
                  onChange={(e) => setEditShares(e.target.value)}
                />
              </label>
              <label className="text-xs text-muted-foreground">
                Avg Cost
                <input
                  type="number"
                  step="any"
                  min="0"
                  className="ml-1.5 w-24 px-2 py-1 text-xs font-mono rounded-sm border border-border bg-transparent text-foreground focus:outline-none focus:border-[var(--primary)]"
                  value={editCost}
                  onChange={(e) => setEditCost(e.target.value)}
                />
              </label>
              <label className="text-xs text-muted-foreground">
                Notes
                <input
                  type="text"
                  className="ml-1.5 w-40 px-2 py-1 text-xs rounded-sm border border-border bg-transparent text-foreground focus:outline-none focus:border-[var(--primary)]"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Optional"
                />
              </label>
              <button
                type="submit"
                disabled={saving}
                className="text-xs px-2.5 py-1 rounded-sm font-medium disabled:opacity-50"
                style={{ background: "oklch(0.72 0.14 74)", color: "oklch(0.08 0 0)" }}
              >
                {saving ? "…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </form>
          </td>
        </tr>
      )}

      {expanded && !editing && (
        <tr className="border-b border-border/50">
          <td colSpan={12} className="px-4 py-3">
            <div
              className="text-xs rounded-sm px-3 py-2"
              style={{ background: "oklch(0.14 0 0)", color: "oklch(0.60 0.008 74)" }}
            >
              {h.notes ? (
                <>
                  <span className="font-medium text-muted-foreground mr-2">Notes:</span>
                  {h.notes}
                </>
              ) : (
                <span className="text-muted-foreground italic">No notes for {h.ticker}.</span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
