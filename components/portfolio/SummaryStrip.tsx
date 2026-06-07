import { formatCurrency, formatPercent } from "@/lib/format";
import type { HoldingWithMetrics } from "@/lib/types";

interface Props {
  holdings: HoldingWithMetrics[];
  account: string;
}

export function SummaryStrip({ holdings, account }: Props) {
  const filtered = account === "all"
    ? holdings
    : holdings.filter((h) => h.account === account);

  const totalValue = filtered.reduce((s, h) => s + h.value, 0);
  const totalCost  = filtered.reduce((s, h) => s + h.costTotal, 0);
  const unrealized = totalValue - totalCost;
  const unrealizedPct = totalCost > 0 ? (unrealized / totalCost) * 100 : 0;

  const todayChange = filtered.reduce((s, h) => {
    const pct = h.todayChangePct / 100;
    return s + (h.value / (1 + pct)) * pct;
  }, 0);
  const todayPct = totalValue > 0 ? (todayChange / (totalValue - todayChange)) * 100 : 0;

  return (
    <div className="flex items-center gap-8 px-6 py-4 border-b border-border text-sm shrink-0 overflow-x-auto">
      <Metric label="Portfolio Value" value={formatCurrency(totalValue)} large />
      <div className="w-px h-8 bg-border shrink-0" aria-hidden />
      <Metric label="Today" value={formatCurrency(todayChange)} change={todayPct} showSign />
      <Metric label="Unrealized P&L" value={formatCurrency(unrealized)} change={unrealizedPct} showSign />
      {account === "all" && filtered.length > 0 && (
        <>
          <div className="w-px h-8 bg-border shrink-0" aria-hidden />
          <Metric label="Cost Basis" value={formatCurrency(totalCost)} muted />
          <Metric label="Positions" value={String(filtered.length)} muted />
        </>
      )}
    </div>
  );
}

interface MetricProps {
  label: string;
  value: string;
  change?: number;
  showSign?: boolean;
  large?: boolean;
  muted?: boolean;
}

function Metric({ label, value, change, showSign, large, muted }: MetricProps) {
  const isPositive = change !== undefined && change >= 0;
  const isNegative = change !== undefined && change < 0;

  return (
    <div className="flex flex-col gap-0.5 shrink-0">
      <span className="text-xs text-muted-foreground leading-none">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span
          className={`font-mono font-medium leading-none ${large ? "text-base" : "text-sm"}`}
          style={
            muted
              ? { color: "oklch(0.52 0.008 74)" }
              : isPositive
              ? { color: "oklch(0.72 0.14 74)" }
              : isNegative
              ? { color: "oklch(0.64 0.16 28)" }
              : {}
          }
        >
          {value}
        </span>
        {change !== undefined && (
          <span
            className="text-xs font-mono leading-none"
            style={
              isPositive
                ? { color: "oklch(0.72 0.14 74)" }
                : { color: "oklch(0.64 0.16 28)" }
            }
          >
            {formatPercent(change, showSign)}
          </span>
        )}
      </div>
    </div>
  );
}
