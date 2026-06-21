import { NextResponse, type NextRequest } from "next/server";
import { fetchOptionChain } from "@/lib/yahoo";
import { optionMark } from "@/lib/paper-pricing";
import { impliedVol, RISK_FREE } from "@/lib/options-math";

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
    const T = Math.max((match.unix - Date.now() / 1000) / (365 * 86400), 0);

    const map = (arr: typeof chain.calls, type: "CALL" | "PUT") =>
      arr
        .map((c) => {
          const m = parseFloat(optionMark(c).toFixed(2));
          // Prefer the feed's IV; fall back to inverting Black-Scholes from the
          // mark so a quoted strike never shows a blank IV.
          let ivPct =
            c.impliedVolatility && c.impliedVolatility > 0 ? c.impliedVolatility * 100 : null;
          if (ivPct == null && m > 0 && spot > 0 && T > 0) {
            const computed = impliedVol({
              type: type === "CALL" ? "call" : "put",
              S: spot,
              K: c.strike,
              T,
              r: RISK_FREE,
              price: m,
            });
            if (computed != null) ivPct = computed * 100;
          }
          return {
            strike: c.strike,
            type,
            mark: m > 0 ? m : null, // null → table shows "—", click-to-add stays disabled
            iv: ivPct != null ? parseFloat(ivPct.toFixed(1)) : null,
          };
        })
        // Keep any strike that carries at least a mark or an IV; drop the rest.
        .filter((c) => c.mark != null || c.iv != null);

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
