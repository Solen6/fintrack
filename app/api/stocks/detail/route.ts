import { NextResponse, type NextRequest } from "next/server";
import { yahooStockStats } from "@/lib/yahoo";

/* Headline stats for the selected S&P 500 stock (Stocks-deck detail panel).
   Thin wrapper over yahooStockStats (crumbed quoteSummary, 5-min cached). */

export async function GET(request: NextRequest) {
  const symbol = (request.nextUrl.searchParams.get("symbol") ?? "").trim();
  if (!symbol) return NextResponse.json({ error: "symbol is required." }, { status: 400 });

  const stats = await yahooStockStats(symbol);
  return NextResponse.json({ symbol: symbol.toUpperCase(), stats });
}
