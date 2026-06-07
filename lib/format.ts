const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCurrency(n: number): string {
  return usd.format(n);
}

export function formatCurrencyCompact(n: number): string {
  return usdCompact.format(n);
}

export function formatPercent(n: number, showSign = true): string {
  const sign = showSign && n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function formatShares(n: number): string {
  return n % 1 === 0 ? n.toString() : n.toFixed(4);
}

export function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
