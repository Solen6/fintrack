import { NextResponse } from "next/server";
import { fetchCommodityCatalysts } from "@/lib/commodity-catalysts";

export const dynamic = "force-dynamic";

// Catalyst markers for one chart symbol — the past year's biggest moves, each
// with the headline that explains it (see lib/commodity-catalysts). Split from
// /api/commodities so the price lines never wait on news searches, and fetched
// only for the commodity actually being charted. Public, like its parent.

// Yahoo symbols: letters, digits and . = ^ - (BRK.B, PL=F, ^TNX).
const SYMBOL_RE = /^[A-Z0-9.=^-]{1,15}$/;

export async function GET(req: Request) {
  const symbol = (new URL(req.url).searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }
  try {
    return NextResponse.json({ symbol, catalysts: await fetchCommodityCatalysts(symbol) });
  } catch {
    // Price history didn't load. Fail loudly rather than returning an empty list
    // the chart would remember as "this symbol has no catalysts".
    return NextResponse.json({ error: "Catalysts unavailable" }, { status: 502 });
  }
}
