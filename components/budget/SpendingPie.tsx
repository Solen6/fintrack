"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { BUDGET_CATEGORIES, computeMonthTotals } from "@/lib/budget-data";
import type { MonthData, BudgetCategoryId } from "@/lib/budget-data";
import { formatCurrency } from "@/lib/format";

interface Props {
  month: MonthData;
  hoveredCategory: BudgetCategoryId | null;
  onHover: (id: BudgetCategoryId | null) => void;
}

export function SpendingPie({ month, hoveredCategory, onHover }: Props) {
  const { byCategory, totalExpenses } = computeMonthTotals(month);

  const data = BUDGET_CATEGORIES.map((cat) => ({
    id: cat.id,
    name: cat.label,
    value: byCategory[cat.id] ?? 0,
    color: cat.color,
  })).filter((d) => d.value > 0);

  return (
    <div className="flex flex-col h-full px-4 pt-4 pb-2">
      <p className="text-xs font-medium text-muted-foreground mb-4 px-2">
        Spending allocation · {month.label}
      </p>

      {/* 3D perspective container */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        {/* Outer 3D tilt wrapper */}
        <div
          style={{
            perspective: "600px",
            perspectiveOrigin: "50% 30%",
            width: "100%",
            maxWidth: 320,
          }}
        >
          {/* Chart disc with 3D rotation */}
          <div
            style={{
              transform: "rotateX(42deg)",
              transformStyle: "preserve-3d",
              position: "relative",
            }}
          >
            {/* Drop shadow disc — creates the 3D depth illusion */}
            <div
              style={{
                position: "absolute",
                inset: "4px 8px",
                borderRadius: "50%",
                background: "oklch(0.04 0 0)",
                filter: "blur(16px)",
                transform: "translateZ(-8px) translateY(14px)",
                opacity: 0.9,
              }}
              aria-hidden
            />

            {/* Pie chart */}
            <div style={{ height: 280, position: "relative" }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    outerRadius="85%"
                    innerRadius="30%"
                    dataKey="value"
                    strokeWidth={1}
                    stroke="oklch(0.08 0 0)"
                    isAnimationActive={false}
                    onMouseEnter={(_, index) => onHover(data[index]?.id as BudgetCategoryId)}
                    onMouseLeave={() => onHover(null)}
                  >
                    {data.map((entry) => (
                      <Cell
                        key={entry.id}
                        fill={entry.color}
                        opacity={
                          hoveredCategory === null || hoveredCategory === entry.id
                            ? 1
                            : 0.35
                        }
                        style={{ cursor: "pointer", transition: "opacity 150ms ease-out" }}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    content={<CustomTooltip total={totalExpenses} />}
                    wrapperStyle={{ zIndex: "var(--z-tooltip)" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 w-full max-w-xs">
          <div
            className="grid gap-x-4 gap-y-1.5"
            style={{ gridTemplateColumns: "1fr 1fr" }}
          >
            {data.map((entry) => {
              const pct =
                totalExpenses > 0
                  ? ((entry.value / totalExpenses) * 100).toFixed(1)
                  : "0.0";
              const dimmed =
                hoveredCategory !== null && hoveredCategory !== entry.id;

              return (
                <button
                  key={entry.id}
                  className="flex items-center gap-2 text-left transition-opacity duration-150"
                  style={{ opacity: dimmed ? 0.35 : 1 }}
                  onMouseEnter={() => onHover(entry.id as BudgetCategoryId)}
                  onMouseLeave={() => onHover(null)}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: entry.color }}
                    aria-hidden
                  />
                  <span className="text-xs text-muted-foreground truncate">
                    {entry.name}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground ml-auto shrink-0">
                    {pct}%
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Center total */}
        <p className="mt-3 text-xs text-muted-foreground text-center">
          Total:{" "}
          <span className="font-mono text-foreground">
            {formatCurrency(totalExpenses)}
          </span>
        </p>
      </div>
    </div>
  );
}

/* ─── Custom tooltip ─── */
function CustomTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { color: string } }>;
  total: number;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : "0";

  return (
    <div
      className="rounded-sm border border-border px-3 py-2 text-xs font-mono"
      style={{ background: "oklch(0.14 0 0)", zIndex: "var(--z-tooltip)" }}
    >
      <p className="flex items-center gap-1.5 mb-1">
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: item.payload.color }}
        />
        <span className="text-foreground">{item.name}</span>
      </p>
      <p style={{ color: item.payload.color }}>
        {formatCurrency(item.value)} · {pct}%
      </p>
    </div>
  );
}
