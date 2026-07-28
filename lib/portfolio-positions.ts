import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchQuotes } from "@/lib/finnhub";
import type { AnalysisPosition } from "@/lib/analytics/api-types";

/* The user's priceable positions with current weights — the shared basis for
   the Analysis tab's "autofill from portfolio" and for the yearly frontier
   snapshots, so the two can't drift apart on what counts as a position. */

export interface HoldingRow {
  ticker: string;
  shares: number;
  cost_basis: number | null;
  instrument_type: string | null;
  bond_type: string | null;
}

/** Priceable = equities + bond ETFs. Options, futures and non-ETF bonds have no
    usable daily price series for return/risk work. Single definition, shared by
    the tool's autofill and the yearly snapshot cron so they can't diverge. */
export function isPriceable(h: Pick<HoldingRow, "instrument_type" | "bond_type">): boolean {
  const it = h.instrument_type ?? "equity";
  if (it === "option" || it === "future") return false;
  if (it === "bond" && h.bond_type !== "etf") return false;
  return true;
}

/** Aggregate holdings into ticker -> percent of the invested sleeve. Falls back
    to average cost when a quote is missing, so weights still work offline. */
export function weightsFromHoldings(
  rows: HoldingRow[],
  quotes: Record<string, { price?: number } | undefined>,
): { weights: Record<string, number>; riskyValue: number } {
  const bySymbol = new Map<string, { shares: number; costSum: number }>();
  for (const h of rows) {
    if (!isPriceable(h)) continue;
    const sym = h.ticker.trim().toUpperCase();
    if (!sym) continue;
    const shares = Number(h.shares) || 0;
    const cost = Number(h.cost_basis) || 0;
    const prev = bySymbol.get(sym);
    if (prev) {
      prev.shares += shares;
      prev.costSum += shares * cost;
    } else {
      bySymbol.set(sym, { shares, costSum: shares * cost });
    }
  }

  let riskyValue = 0;
  const values = new Map<string, number>();
  for (const [sym, meta] of bySymbol) {
    const avgCost = meta.shares !== 0 ? meta.costSum / meta.shares : 0;
    const price = quotes[sym]?.price ?? avgCost;
    const value = meta.shares * price;
    values.set(sym, value);
    riskyValue += value;
  }

  const weights: Record<string, number> = {};
  if (riskyValue > 0) {
    for (const [sym, value] of values) {
      const pct = (value / riskyValue) * 100;
      if (pct > 0) weights[sym] = pct;
    }
  }
  return { weights, riskyValue };
}

export interface PriceablePositions {
  positions: AnalysisPosition[];
  cash: number;
  riskyValue: number;
  totalValue: number;
  pricesStale: boolean;
}

/** The signed-in user's priceable positions, valued at live quotes. */
export async function loadPriceablePositions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
): Promise<PriceablePositions> {
  const { data, error } = await supabase
    .from("holdings")
    .select("ticker,shares,cost_basis,instrument_type,bond_type")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  let cash = 0;
  const { data: cashRows } = await supabase
    .from("cash_balances")
    .select("balance")
    .eq("user_id", userId);
  if (cashRows) for (const r of cashRows) cash += Number(r.balance) || 0;

  const rows = (data ?? []) as HoldingRow[];
  const bySymbol = new Map<string, { shares: number; costSum: number }>();
  for (const h of rows) {
    if (!isPriceable(h)) continue;
    const sym = h.ticker.trim().toUpperCase();
    if (!sym) continue;
    const shares = Number(h.shares) || 0;
    const cost = Number(h.cost_basis) || 0;
    const prev = bySymbol.get(sym);
    if (prev) {
      prev.shares += shares;
      prev.costSum += shares * cost;
    } else {
      bySymbol.set(sym, { shares, costSum: shares * cost });
    }
  }

  const symbols = [...bySymbol.keys()];
  if (symbols.length === 0) {
    return { positions: [], cash, riskyValue: 0, totalValue: cash, pricesStale: false };
  }

  const quotes = await fetchQuotes(symbols);
  const pricesStale = symbols.some((s) => !quotes[s]?.price);

  let riskyValue = 0;
  const raw = symbols.map((sym) => {
    const meta = bySymbol.get(sym)!;
    // Prefer live price; fall back to average cost so weights still work offline.
    const avgCost = meta.shares !== 0 ? meta.costSum / meta.shares : 0;
    const price = quotes[sym]?.price ?? avgCost;
    const value = meta.shares * price;
    riskyValue += value;
    return { sym, shares: meta.shares, price, value };
  });

  const positions: AnalysisPosition[] = raw
    .map((r) => ({
      ticker: r.sym,
      shares: r.shares,
      price: r.price,
      value: r.value,
      weight: riskyValue > 0 ? r.value / riskyValue : 0,
    }))
    .sort((a, b) => b.value - a.value);

  return { positions, cash, riskyValue, totalValue: riskyValue + cash, pricesStale };
}
