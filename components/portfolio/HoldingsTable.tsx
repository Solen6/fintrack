"use client";

import { useState, useMemo } from "react";
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
}

export function HoldingsTable({ holdings, account }: Props) {
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
        <table className="w-full text-sm border-collapse min-w-[700px]">
          <thead>
            <tr className="border-b border-border">
              <Th field="ticker" sort={sort} onSort={toggleSort} className="w-20">Ticker</Th>
              <Th field="name" sort={sort} onSort={toggleSort} className="min-w-[160px]">Name</Th>
              <Th field="sector" sort={sort} onSort={toggleSort} className="min-w-[120px]">Sector</Th>
              <Th field="shares" sort={sort} onSort={toggleSort} align="right" className="w-20">Shares</Th>
              <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right w-24">Avg Cost</th>
              <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right w-24">Price</th>
              <Th field="value" sort={sort} onSort={toggleSort} align="right" className="w-28">Value</Th>
              <Th field="gainDollar" sort={sort} onSort={toggleSort} align="right" className="w-28">Gain</Th>
              <Th field="gainPercent" sort={sort} onSort={toggleSort} align="right" className="w-20">Gain %</Th>
              <th className="px-4 py-3 text-xs text-muted-foreground font-medium w-24 text-center">Account</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((h) => (
              <HoldingRow
                key={h.id}
                holding={h}
                expanded={expandedId === h.id}
                onToggle={() => setExpandedId((prev) => (prev === h.id ? null : h.id))}
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

/* ─── Holding row ─── */
interface RowProps {
  holding: HoldingWithMetrics;
  expanded: boolean;
  onToggle: () => void;
}

function HoldingRow({ holding: h, expanded, onToggle }: RowProps) {
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
        <td className="px-4 py-3 text-muted-foreground max-w-[220px]">
          <span className="block truncate">{h.name}</span>
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
      </tr>

      {expanded && (
        <tr className="border-b border-border/50">
          <td colSpan={10} className="px-4 py-3">
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
