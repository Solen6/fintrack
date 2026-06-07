"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import {
  BUDGET_CATEGORIES,
  computeMonthTotals,
} from "@/lib/budget-data";
import type { MonthData, BudgetCategoryId } from "@/lib/budget-data";

interface Props {
  month: MonthData;
  hoveredCategory: BudgetCategoryId | null;
  onHover: (id: BudgetCategoryId | null) => void;
}

export function CategoryBreakdown({ month, hoveredCategory, onHover }: Props) {
  const [expanded, setExpanded] = useState<BudgetCategoryId | null>(null);
  const { byCategory } = computeMonthTotals(month);

  const toggleExpand = (id: BudgetCategoryId) => {
    setExpanded((prev) => (prev === id ? null : id));
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Income row */}
      <div className="flex items-center px-6 py-3 border-b border-border">
        <div
          className="w-2 h-2 rounded-full mr-3 shrink-0"
          style={{ background: "oklch(0.72 0.14 74)" }}
          aria-hidden
        />
        <span className="text-sm font-medium flex-1">Income</span>
        <span className="text-sm font-mono" style={{ color: "oklch(0.72 0.14 74)" }}>
          +{formatCurrency(month.income)}
        </span>
      </div>

      {/* Expense categories */}
      {BUDGET_CATEGORIES.map((cat) => {
        const spent = byCategory[cat.id] ?? 0;
        const over = spent > cat.budget;
        const isExpanded = expanded === cat.id;
        const isHovered = hoveredCategory === cat.id;
        const transactions = month.transactions.filter(
          (t) => t.category === cat.id
        );

        return (
          <div key={cat.id}>
            <button
              className={cn(
                "w-full flex items-center px-6 py-3 border-b border-border text-left transition-colors duration-150",
                isHovered || isExpanded
                  ? "bg-card"
                  : "hover:bg-card/60"
              )}
              onClick={() => toggleExpand(cat.id)}
              onMouseEnter={() => onHover(cat.id)}
              onMouseLeave={() => onHover(null)}
              aria-expanded={isExpanded}
            >
              {/* Color swatch */}
              <div
                className="w-2 h-2 rounded-full mr-3 shrink-0 transition-transform duration-150"
                style={{
                  background: cat.color,
                  transform: isHovered ? "scale(1.4)" : "scale(1)",
                }}
                aria-hidden
              />

              <span className="text-sm flex-1 text-foreground">{cat.label}</span>

              {/* Over-budget indicator */}
              {over && (
                <span
                  className="text-xs mr-3"
                  style={{ color: "oklch(0.64 0.16 28)" }}
                  title={`$${(spent - cat.budget).toFixed(0)} over budget`}
                >
                  ↑
                </span>
              )}

              <span
                className="text-sm font-mono"
                style={{ color: over ? "oklch(0.64 0.16 28)" : "oklch(0.64 0.008 74)" }}
              >
                {formatCurrency(spent)}
              </span>

              {/* Expand chevron */}
              <span
                className="ml-3 text-xs text-muted-foreground transition-transform duration-150"
                style={{
                  transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                  display: "inline-block",
                }}
                aria-hidden
              >
                ›
              </span>
            </button>

            {/* Expanded transactions */}
            {isExpanded && (
              <div className="border-b border-border" style={{ background: "oklch(0.10 0 0)" }}>
                {transactions.length === 0 ? (
                  <p className="px-10 py-3 text-xs text-muted-foreground">
                    No transactions this month.
                  </p>
                ) : (
                  transactions.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center px-10 py-2 border-b border-border/40 last:border-0"
                    >
                      <span className="text-xs text-muted-foreground w-20 shrink-0 font-mono">
                        {new Date(t.date + "T00:00:00Z").toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        })}
                      </span>
                      <span className="text-xs text-muted-foreground flex-1">
                        {t.description}
                      </span>
                      <span className="text-xs font-mono text-foreground">
                        {formatCurrency(t.amount)}
                      </span>
                    </div>
                  ))
                )}

                {/* Budget vs actual footer */}
                <div className="flex items-center justify-between px-10 py-2 border-t border-border/40">
                  <span className="text-xs text-muted-foreground">
                    Budget: {formatCurrency(cat.budget)}
                  </span>
                  <span
                    className="text-xs font-mono"
                    style={{
                      color: over
                        ? "oklch(0.64 0.16 28)"
                        : "oklch(0.72 0.14 74)",
                    }}
                  >
                    {over ? "+" : "-"}
                    {formatCurrency(Math.abs((byCategory[cat.id] ?? 0) - cat.budget))}
                    {over ? " over" : " under"}
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
