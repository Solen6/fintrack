import { formatCurrency, formatPercent } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";
import type { HoldingWithMetrics } from "@/lib/types";

interface CashBalance {
  account: string;
  label: string;
  balance: number;
}

interface Props {
  holdings: HoldingWithMetrics[];
  cash?: CashBalance[];
  account: string;
  /* Cumulative time-weighted return for this account (matches the dashboard).
     null until snapshots load or when there isn't enough history — then we fall
     back to the cost-basis unrealized figure. */
  cumReturn?: { pct: number; gain: number } | null;
}

export function SummaryStrip({ holdings, cash = [], account, cumReturn = null }: Props) {
  const filtered = account === "all"
    ? holdings
    : holdings.filter((h) => h.account === account);

  const cashTotal = (account === "all" ? cash : cash.filter((c) => c.account === account))
    .reduce((s, c) => s + c.balance, 0);

  const positionsValue = filtered.reduce((s, h) => s + h.value, 0);
  const totalValue = positionsValue + cashTotal;
  const totalCost  = filtered.reduce((s, h) => s + h.costTotal, 0);
  const unrealized = positionsValue - totalCost;
  const unrealizedPct = totalCost > 0 ? (unrealized / totalCost) * 100 : 0;

  // A position acquired today is measured from cost (your entry), not yesterday's
  // close it never held through — matching the broker on same-day buys.
  const todayStrET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const acquiredToday = (h: HoldingWithMetrics) =>
    h.acquiredAt != null &&
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(h.acquiredAt)) === todayStrET;
  const todayChange = filtered.reduce((s, h) => {
    if (acquiredToday(h)) return s + (h.value - h.costTotal);
    const pct = h.todayChangePct / 100;
    return s + (h.value / (1 + pct)) * pct;
  }, 0);
  const todayPct = positionsValue > 0 ? (todayChange / (positionsValue - todayChange)) * 100 : 0;

  return (
    <div className="flex items-center gap-8 px-6 py-4 border-b border-border text-sm shrink-0 overflow-x-auto">
      <Metric label="Portfolio Value" value={<Sensitive>{formatCurrency(totalValue)}</Sensitive>} large />
      <div className="w-px h-8 bg-border shrink-0" aria-hidden />
      <Metric label="Today" value={<Sensitive>{formatCurrency(todayChange)}</Sensitive>} change={todayPct} showSign />
      <Metric
        label="Total Return"
        value={<Sensitive>{formatCurrency(cumReturn ? cumReturn.gain : unrealized)}</Sensitive>}
        change={cumReturn ? cumReturn.pct : unrealizedPct}
        showSign
      />
      {cashTotal > 0 && <Metric label="Cash" value={<Sensitive>{formatCurrency(cashTotal)}</Sensitive>} muted />}
      {account === "all" && filtered.length > 0 && (
        <>
          <div className="w-px h-8 bg-border shrink-0" aria-hidden />
          <Metric label="Cost Basis" value={<Sensitive>{formatCurrency(totalCost)}</Sensitive>} muted />
          <Metric label="Positions" value={String(filtered.length)} muted />
        </>
      )}
    </div>
  );
}

interface MetricProps {
  label: string;
  value: React.ReactNode;
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
              ? { color: "var(--positive)" }
              : isNegative
              ? { color: "var(--negative)" }
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
                ? { color: "var(--positive)" }
                : { color: "var(--negative)" }
            }
          >
            <Sensitive>{formatPercent(change, showSign)}</Sensitive>
          </span>
        )}
      </div>
    </div>
  );
}
