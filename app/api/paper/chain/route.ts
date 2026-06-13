import { NextResponse, type NextRequest } from "next/server";
import { fetchOptionChain } from "@/lib/yahoo";
import { optionMark } from "@/lib/paper-pricing";

/**
 * Option-chain helper for the trade ticket.
 *  - ?underlying=AAPL                 → spot + list of expiries (ISO)
 *  - ?underlying=AAPL&expiry=YYYY-MM-DD → strikes (call/put marks + IV) for that expiry
 */
export async function GET(request: NextRequest) {
  const underlying = (request.nextUrl.searchParams.get("underlying") ?? "").trim().toUpperCase();
  const expiry = request.nextUrl.searchParams.get("expiry");
  if (!underlying) return NextResponse.json({ error: "underlying is required." }, { status: 400 });

  try {
    const base = await fetchOptionChain(underlying);
    const spot = base.quote.regularMarketPrice ?? 0;
    const expiries = base.expirationDates.map((u) => ({
      iso: new Date(u * 1000).toISOString().slice(0, 10),
      unix: u,
    }));

    if (!expiry) {
      return NextResponse.json({ underlying, spot, expiries });
    }

    const match = expiries.find((e) => e.iso === expiry);
    if (!match) return NextResponse.json({ error: "Expiry not available." }, { status: 404 });

    const chain = match.iso === expiries[0].iso ? base : await fetchOptionChain(underlying, match.unix);
    const map = (arr: typeof chain.calls, type: "CALL" | "PUT") =>
      arr.map((c) => ({
        strike: c.strike,
        type,
        mark: parseFloat(optionMark(c).toFixed(2)),
        iv: c.impliedVolatility ? parseFloat((c.impliedVolatility * 100).toFixed(1)) : null,
      })).filter((c) => c.mark > 0);

    return NextResponse.json({
      underlying,
      spot,
      expiry,
      calls: map(chain.calls, "CALL"),
      puts: map(chain.puts, "PUT"),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load chain." }, { status: 502 });
  }
}
