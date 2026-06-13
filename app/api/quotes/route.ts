import { NextResponse, type NextRequest } from "next/server";
import { fetchQuotes, type FinnhubQuote } from "@/lib/finnhub";

export type Quote = FinnhubQuote;

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("tickers") ?? "";
  const tickers = raw.split(",").map(t => t.trim().toUpperCase()).filter(Boolean);

  if (tickers.length === 0) {
    return NextResponse.json({ error: "No tickers provided" }, { status: 400 });
  }

  const quotes = await fetchQuotes(tickers);
  return NextResponse.json({ quotes });
}
