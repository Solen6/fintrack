import { formatCurrency, formatPercent } from "@/lib/format";
import type { MonthData } from "@/lib/budget-data";
import { computeMonthTotals } from "@/lib/budget-data";

interface Props {
  month: MonthData;
  onPrev: () => void;
  onNext: () => void;
  hasNext: boolean;
  hasPrev: boolean;
}

export function BudgetSummaryStrip({ month, onPrev, onNext, hasNext, hasPrev }: Props) {
  const { totalExpenses, net, savingsRate } = computeMonthTotals(month);
  const netPositive = net >= 0;

  return (
    <div className="flex items-center gap-6 px-6 py-4 border-b border-border shrink-0 text-sm">
      {/* Month nav */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={onPrev}
          disabled={!hasPrev}
          className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-25 transition-colors duration-150"
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="text-sm font-medium w-24 text-center">{month.label}</span>
        <button
          onClick={onNext}
          disabled={!hasNext}
          className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-25 transition-colors duration-150"
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className="w-px h-8 bg-border shrink-0" aria-hidden />

      <Metric label="Income" value={formatCurrency(month.income)} />
      <Metric label="Expenses" value={formatCurrency(totalExpenses)} />

      <div className="w-px h-8 bg-border shrink-0" aria-hidden />

      <Metric
        label="Saved"
        value={formatCurrency(net)}
        color={netPositive ? "oklch(0.72 0.14 74)" : "oklch(0.64 0.16 28)"}
      />
      <Metric
        label="Rate"
        value={formatPercent(savingsRate, false)}
        color={netPositive ? "oklch(0.72 0.14 74)" : "oklch(0.64 0.16 28)"}
      />
    </div>
  );
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 shrink-0">
      <span className="text-xs text-muted-foreground leading-none">{label}</span>
      <span
        className="text-sm font-mono font-medium leading-none"
        style={color ? { color } : {}}
      >
        {value}
      </span>
    </div>
  );
}
