import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { yahooDailyHistory } from "@/lib/yahoo";
import { SP_SECTORS } from "@/lib/analytics/sectors-bench";

export const dynamic = "force-dynamic";

export interface SectorBenchmarkRow {
  name: string;
  etf: string;
  benchWeight: number;
  /** Cumulative simple return of the sector ETF over the window (fraction). */
  benchReturn: number;
}

export interface SectorBenchmarkResponse {
  asOf: string;
  days: number;
  sectors: SectorBenchmarkRow[];
  /** Cumulative SPY return over the same window (fraction). */
  spyReturn: number;
}

function cumReturn(closes: { close: number }[]): number {
  if (closes.length < 2) return 0;
  return closes[closes.length - 1].close / closes[0].close - 1;
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

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const days = Math.min(2000, Math.max(30, Number(request.nextUrl.searchParams.get("days")) || 365));
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 86400;

  const symbols = [...SP_SECTORS.map((s) => s.etf), "SPY"];
  const histories = await pMap(symbols, 6, (s) => yahooDailyHistory(s, from, to));
  const bySym = new Map(symbols.map((s, i) => [s, histories[i]]));

  const sectors: SectorBenchmarkRow[] = SP_SECTORS.map((s) => ({
    name: s.name,
    etf: s.etf,
    benchWeight: s.weight,
    benchReturn: cumReturn(bySym.get(s.etf) ?? []),
  }));
  const spyHist = bySym.get("SPY") ?? [];
  const asOf = spyHist[spyHist.length - 1]?.date ?? new Date().toISOString().slice(0, 10);

  const payload: SectorBenchmarkResponse = {
    asOf,
    days,
    sectors,
    spyReturn: cumReturn(spyHist),
  };
  return NextResponse.json(payload);
}
