import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { yahooStockStats, yahooNextDividend } from "@/lib/yahoo";
import type {
  AnalysisFundamental,
  AnalysisFundamentalsResponse,
} from "@/lib/analytics/api-types";

export const dynamic = "force-dynamic";

interface HoldingRow {
  ticker: string;
  name: string | null;
  sector: string | null;
  shares: number;
  instrument_type: string | null;
  bond_type: string | null;
}

async function pMap<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("holdings")
    .select("ticker,name,sector,shares,instrument_type,bond_type")
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let cash = 0;
  const { data: cashRows } = await supabase
    .from("cash_balances")
    .select("balance")
    .eq("user_id", user.id);
  if (cashRows) for (const r of cashRows) cash += Number(r.balance) || 0;

  const rows = (data ?? []) as HoldingRow[];
  const bySymbol = new Map<string, { name: string; sector: string; shares: number }>();
  for (const h of rows) {
    const it = h.instrument_type ?? "equity";
    if (it === "option" || it === "future") continue;
    if (it === "bond" && h.bond_type !== "etf") continue;
    const sym = h.ticker.trim().toUpperCase();
    if (!sym) continue;
    const prev = bySymbol.get(sym);
    if (prev) prev.shares += Number(h.shares) || 0;
    else bySymbol.set(sym, { name: h.name ?? sym, sector: h.sector ?? "—", shares: Number(h.shares) || 0 });
  }

  const symbols = [...bySymbol.keys()];
  if (symbols.length === 0) {
    const empty: AnalysisFundamentalsResponse = {
      asOf: new Date().toISOString().slice(0, 10),
      fundamentals: [], riskyValue: 0, cash, empty: true,
    };
    return NextResponse.json(empty);
  }

  const results = await pMap(symbols, 5, async (sym) => {
    const [stats, nextDiv] = await Promise.all([
      yahooStockStats(sym),
      yahooNextDividend(sym),
    ]);
    return { sym, stats, nextDiv };
  });

  let riskyValue = 0;
  const fundamentals: AnalysisFundamental[] = results.map(({ sym, stats, nextDiv }) => {
    const meta = bySymbol.get(sym)!;
    const price = stats?.price ?? null;
    const value = price != null ? meta.shares * price : 0;
    riskyValue += value;
    const lo = stats?.weekLow52 ?? null;
    const hi = stats?.weekHigh52 ?? null;
    let range52Pos: number | null = null;
    if (price != null && lo != null && hi != null && hi > lo) {
      range52Pos = Math.min(1, Math.max(0, (price - lo) / (hi - lo)));
    }
    return {
      ticker: sym,
      name: stats?.name ?? meta.name,
      sector: meta.sector,
      shares: meta.shares,
      value,
      price,
      marketCap: stats?.marketCap ?? null,
      trailingPE: stats?.trailingPE ?? null,
      dividendYield: stats?.dividendYield ?? null,
      week52Low: lo,
      week52High: hi,
      range52Pos,
      nextDividend: nextDiv
        ? { exDate: nextDiv.exDate, payDate: nextDiv.payDate, amountPerShare: nextDiv.amount }
        : null,
    };
  });
  fundamentals.sort((a, b) => b.value - a.value);

  const payload: AnalysisFundamentalsResponse = {
    asOf: new Date().toISOString().slice(0, 10),
    fundamentals,
    riskyValue,
    cash,
  };
  return NextResponse.json(payload);
}
