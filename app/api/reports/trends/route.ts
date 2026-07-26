import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PortfolioReport, CashFlowReport } from "@/lib/monthly-reports";

/* Compact cross-month series for the Monthly Reports trends charts. Pulls the
   portfolio + cash_flow payloads for one account scope across every stored
   period and projects out just the headline numbers — the full payloads stay
   behind /api/reports for the selected month. */

export interface ReportTrendPoint {
  period: string; // YYYY-MM
  monthReturnPct: number | null;
  benchmarkReturnPct: number | null;
  beta: number | null;
  alpha: number | null;
  sharpe: number | null;
  volatility: number | null;
  totalValue: number | null; // month-end net worth (sensitive)
  savingsRate: number | null;
  netCashFlow: number | null;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const account = request.nextUrl.searchParams.get("account") || "__all__";

  const { data: rows, error } = await supabase
    .from("monthly_reports")
    .select("period,report_type,payload")
    .eq("user_id", user.id)
    .eq("account", account)
    .in("report_type", ["portfolio", "cash_flow"])
    .order("period", { ascending: true });

  if (error) {
    const missingTable =
      error.code === "42P01" || error.code === "PGRST205" || /schema cache/i.test(error.message ?? "");
    if (missingTable) return NextResponse.json({ account, series: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Merge the two report types per period into one point.
  const byPeriod = new Map<string, ReportTrendPoint>();
  const point = (period: string): ReportTrendPoint => {
    let p = byPeriod.get(period);
    if (!p) {
      p = {
        period,
        monthReturnPct: null, benchmarkReturnPct: null,
        beta: null, alpha: null, sharpe: null, volatility: null,
        totalValue: null, savingsRate: null, netCashFlow: null,
      };
      byPeriod.set(period, p);
    }
    return p;
  };

  for (const r of rows ?? []) {
    const period = r.period as string;
    if (r.report_type === "portfolio") {
      const pl = r.payload as PortfolioReport;
      const p = point(period);
      p.monthReturnPct = pl.monthEnd?.monthReturnPct ?? null;
      p.totalValue = pl.monthEnd?.total ?? pl.totals?.totalValue ?? null;
      p.benchmarkReturnPct = pl.risk?.benchmarkReturn ?? null;
      p.beta = pl.risk?.beta ?? null;
      p.alpha = pl.risk?.alpha ?? null;
      p.sharpe = pl.risk?.sharpe ?? null;
      p.volatility = pl.risk?.volatility ?? null;
    } else if (r.report_type === "cash_flow") {
      const pl = r.payload as CashFlowReport;
      const p = point(period);
      p.savingsRate = pl.savingsRate ?? null;
      p.netCashFlow = pl.netCashFlow ?? null;
    }
  }

  const series = [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
  return NextResponse.json({ account, series });
}
