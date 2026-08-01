import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { yahooDailyHistory, type DailyClose } from "@/lib/yahoo";
import { dailyReturns } from "@/lib/analytics/stats";
import type {
  AnalysisAsset,
  AnalysisHistoryResponse,
} from "@/lib/analytics/api-types";

export const dynamic = "force-dynamic";

const BENCHMARK = "SPY";
/** Minimum aligned trading days a ticker needs to be included. */
const MIN_POINTS = 40;

interface HoldingRow {
  ticker: string;
  name: string | null;
  sector: string | null;
  shares: number;
  cost_basis: number | null;
  acquired_at: string | null;
  instrument_type: string | null;
  bond_type: string | null;
}

/** Small concurrency-limited map so we don't fan too many Yahoo calls at once. */
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

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const days = Math.min(
    2000,
    Math.max(120, Number(request.nextUrl.searchParams.get("days")) || 730),
  );
  // Optional account scope (Rebalancer's per-account sections). Every other
  // consumer of this route omits it and keeps today's whole-portfolio behavior.
  const account = request.nextUrl.searchParams.get("account")?.trim() || null;

  let holdingsQuery = supabase
    .from("holdings")
    .select("ticker,name,sector,shares,cost_basis,acquired_at,instrument_type,bond_type")
    .eq("user_id", user.id);
  if (account) holdingsQuery = holdingsQuery.eq("account", account);
  const { data: holdingsData, error } = await holdingsQuery;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Cash (best-effort; table may not be migrated).
  let cash = 0;
  let cashQuery = supabase
    .from("cash_balances")
    .select("balance")
    .eq("user_id", user.id);
  if (account) cashQuery = cashQuery.eq("account", account);
  const { data: cashRows } = await cashQuery;
  if (cashRows) for (const r of cashRows) cash += Number(r.balance) || 0;

  // Priceable = equities + bond ETFs (real quote symbols). Aggregate shares per ticker.
  const rows = (holdingsData ?? []) as HoldingRow[];
  interface Agg {
    name: string;
    sector: string;
    shares: number;
    costSum: number; // Σ shares×cost, for share-weighted average cost
    acquiredAt: string | null;
  }
  const bySymbol = new Map<string, Agg>();
  for (const h of rows) {
    const it = h.instrument_type ?? "equity";
    if (it === "option" || it === "future") continue;
    if (it === "bond" && h.bond_type !== "etf") continue;
    const sym = h.ticker.trim().toUpperCase();
    if (!sym) continue;
    const shares = Number(h.shares) || 0;
    const cost = Number(h.cost_basis) || 0;
    const prev = bySymbol.get(sym);
    if (prev) {
      prev.shares += shares;
      prev.costSum += shares * cost;
      if (h.acquired_at && (!prev.acquiredAt || h.acquired_at > prev.acquiredAt)) {
        prev.acquiredAt = h.acquired_at;
      }
    } else {
      bySymbol.set(sym, {
        name: h.name ?? sym,
        sector: h.sector ?? "—",
        shares,
        costSum: shares * cost,
        acquiredAt: h.acquired_at ?? null,
      });
    }
  }

  const symbols = [...bySymbol.keys()];
  if (symbols.length === 0) {
    const empty: AnalysisHistoryResponse = {
      asOf: "", dates: [], assets: [], closes: {}, returns: {},
      benchmark: { ticker: BENCHMARK, closes: [], returns: [] },
      candidates: [], heldWindowDays: 0, heldWindowStart: "", cash, riskyValue: 0, excluded: [], empty: true,
    };
    return NextResponse.json(empty);
  }

  // Candidate tickers to test-add (not currently held), via ?extra=NVDA,GLD.
  const candidateSyms = [
    ...new Set(
      (request.nextUrl.searchParams.get("extra") ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s) && !bySymbol.has(s)),
    ),
  ].slice(0, 8);

  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 86400;

  // Fetch histories (held assets + candidates + benchmark).
  const fetchSyms = [...symbols, ...candidateSyms, BENCHMARK];
  const histories = await pMap(fetchSyms, 6, (s) => yahooDailyHistory(s, from, to));
  const histBySym = new Map<string, DailyClose[]>();
  fetchSyms.forEach((s, idx) => histBySym.set(s, histories[idx]));

  // Build date→close maps; drop symbols with too little data.
  const excluded: { ticker: string; reason: string }[] = [];
  const maps = new Map<string, Map<string, number>>();
  for (const s of fetchSyms) {
    const h = histBySym.get(s) ?? [];
    if (s !== BENCHMARK && h.length < MIN_POINTS) {
      excluded.push({ ticker: s, reason: h.length === 0 ? "no price history" : "insufficient history" });
      continue;
    }
    const m = new Map<string, number>();
    for (const d of h) m.set(d.date, d.close);
    maps.set(s, m);
  }

  const benchMap = maps.get(BENCHMARK);
  const includedSyms = symbols.filter((s) => maps.has(s));
  const includedCandidates = candidateSyms.filter((s) => maps.has(s));
  if (!benchMap || includedSyms.length === 0) {
    const empty: AnalysisHistoryResponse = {
      asOf: "", dates: [], assets: [], closes: {}, returns: {},
      benchmark: { ticker: BENCHMARK, closes: [], returns: [] },
      candidates: [], heldWindowDays: 0, heldWindowStart: "", cash, riskyValue: 0, excluded, empty: true,
    };
    return NextResponse.json(empty);
  }

  // Intersection of dates present in every listed symbol, so return series
  // align to one window. Computed for holdings+candidates (the working window)
  // and holdings-only (to detect when a short-history candidate shortens it).
  const intersect = (syms: string[]): string[] => {
    let common: string[] | null = null;
    for (const s of syms) {
      const m = maps.get(s);
      if (!m) continue;
      if (common === null) common = [...m.keys()];
      else {
        const set = new Set(m.keys());
        common = common.filter((d) => set.has(d));
      }
    }
    return (common ?? []).sort();
  };
  const dates = intersect([...includedSyms, ...includedCandidates, BENCHMARK]);
  const heldDates = intersect([...includedSyms, BENCHMARK]);
  if (dates.length < MIN_POINTS) {
    const empty: AnalysisHistoryResponse = {
      asOf: dates[dates.length - 1] ?? "", dates: [], assets: [], closes: {}, returns: {},
      benchmark: { ticker: BENCHMARK, closes: [], returns: [] },
      candidates: [], heldWindowDays: 0, heldWindowStart: "", cash, riskyValue: 0, excluded, empty: true,
    };
    return NextResponse.json(empty);
  }

  const closes: Record<string, number[]> = {};
  const returns: Record<string, number[]> = {};
  for (const s of [...includedSyms, ...includedCandidates]) {
    const m = maps.get(s)!;
    const series = dates.map((d) => m.get(d)!);
    closes[s] = series;
    returns[s] = dailyReturns(series);
  }
  const benchCloses = dates.map((d) => benchMap.get(d)!);
  const candidates = includedCandidates.map((s) => {
    const keys = [...maps.get(s)!.keys()].sort();
    return { ticker: s, name: s, sector: "—", start: keys[0] ?? "" };
  });

  // Values & weights from the latest close.
  let riskyValue = 0;
  const rawAssets = includedSyms.map((s) => {
    const meta = bySymbol.get(s)!;
    const lastClose = closes[s][closes[s].length - 1];
    const value = meta.shares * lastClose;
    riskyValue += value;
    return { s, meta, lastClose, value };
  });
  const totalWithCash = riskyValue + cash;
  const assets: AnalysisAsset[] = rawAssets.map(({ s, meta, lastClose, value }) => {
    const costBasis = meta.shares !== 0 ? meta.costSum / meta.shares : 0;
    const costTotal = costBasis * meta.shares;
    const unrealizedPL = value - costTotal;
    return {
      ticker: s,
      name: meta.name,
      sector: meta.sector,
      shares: meta.shares,
      lastClose,
      value,
      weight: riskyValue > 0 ? value / riskyValue : 0,
      weightWithCash: totalWithCash > 0 ? value / totalWithCash : 0,
      costBasis,
      unrealizedPL,
      unrealizedPct: costTotal !== 0 ? unrealizedPL / Math.abs(costTotal) : 0,
      acquiredAt: meta.acquiredAt,
    };
  });
  assets.sort((a, b) => b.value - a.value);

  const payload: AnalysisHistoryResponse = {
    asOf: dates[dates.length - 1],
    dates,
    assets,
    closes,
    returns,
    benchmark: {
      ticker: BENCHMARK,
      closes: benchCloses,
      returns: dailyReturns(benchCloses),
    },
    candidates,
    heldWindowDays: heldDates.length,
    heldWindowStart: heldDates[0] ?? "",
    cash,
    riskyValue,
    excluded,
  };
  return NextResponse.json(payload);
}
