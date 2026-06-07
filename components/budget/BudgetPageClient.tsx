"use client";

import { useState } from "react";
import nextDynamic from "next/dynamic";
import { BudgetSummaryStrip } from "./BudgetSummaryStrip";
import { CategoryBreakdown } from "./CategoryBreakdown";
import { BUDGET_MONTHS } from "@/lib/budget-data";
import type { BudgetCategoryId } from "@/lib/budget-data";

const SpendingPie = nextDynamic(
  () => import("./SpendingPie").then((m) => m.SpendingPie),
  {
    ssr: false,
    loading: () => <div className="flex-1" />,
  }
);

export function BudgetPageClient() {
  const [monthIndex, setMonthIndex] = useState(0); // 0 = most recent
  const [hoveredCategory, setHoveredCategory] = useState<BudgetCategoryId | null>(null);

  const month = BUDGET_MONTHS[monthIndex];
  const hasPrev = monthIndex < BUDGET_MONTHS.length - 1;
  const hasNext = monthIndex > 0;

  return (
    <>
      <BudgetSummaryStrip
        month={month}
        onPrev={() => setMonthIndex((i) => i + 1)}
        onNext={() => setMonthIndex((i) => i - 1)}
        hasPrev={hasPrev}
        hasNext={hasNext}
      />

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left: category breakdown */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-border min-w-0">
          <CategoryBreakdown
            month={month}
            hoveredCategory={hoveredCategory}
            onHover={setHoveredCategory}
          />
        </div>

        {/* Right: 3D pie chart */}
        <div className="w-80 shrink-0 overflow-y-auto">
          <SpendingPie
            month={month}
            hoveredCategory={hoveredCategory}
            onHover={setHoveredCategory}
          />
        </div>
      </div>
    </>
  );
}
