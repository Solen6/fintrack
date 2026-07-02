import { NextResponse, type NextRequest } from "next/server";
import { fetchSectors } from "@/lib/sectors";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("tickers") ?? "";
  const tickers = raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);

  if (tickers.length === 0) return NextResponse.json({ sectors: {} });

  const sectors = await fetchSectors(tickers, 30);
  return NextResponse.json({ sectors });
}
