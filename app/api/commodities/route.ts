import { NextResponse } from "next/server";
import { yahooCandles, type CandleSeries } from "@/lib/yahoo-candles";

// Prices only. Catalyst markers come from /api/commodities/catalysts, fetched
// separately for the one commodity being charted, so a slow news lookup never
// holds up the lines.

const COMMODITIES = [
  { id: "gold",    symbol: "GLD",   name: "Gold",      unit: "$/oz (GLD)"   },
  { id: "silver",  symbol: "SLV",   name: "Silver",    unit: "$/oz (SLV)"   },
  { id: "oil",     symbol: "USO",   name: "WTI Crude", unit: "$/bbl (USO)"  },
  { id: "copper",  symbol: "CPER",  name: "Copper",    unit: "$/lb (CPER)"  },
  { id: "uranium", symbol: "SRUUF", name: "Uranium",   unit: "$/lb (SRUUF)" },
];

const MAX_EXTRA = 5;

/** User-added tickers beyond the 5 curated commodities — `?extra=NVDA,PL=F`. */
function parseExtra(searchParams: URLSearchParams): typeof COMMODITIES {
  const raw = searchParams.get("extra");
  if (!raw) return [];
  const preset = new Set(COMMODITIES.map((c) => c.symbol));
  const symbols = [...new Set(
    raw.split(",").map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0 && s.length <= 15 && !preset.has(s))
  )].slice(0, MAX_EXTRA);
  return symbols.map((symbol) => ({ id: symbol.toLowerCase(), symbol, name: symbol, unit: "" }));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tf = searchParams.get("range") ?? "1Y";
  const allMeta = [...COMMODITIES, ...parseExtra(searchParams)];

  const priceResults = await Promise.allSettled(allMeta.map((c) => yahooCandles(c.symbol, tf)));

  const commodities = allMeta.map((meta, i) => {
    const r = priceResults[i];
    if (r.status !== "fulfilled") {
      return { ...meta, currentPrice: 0, changePct: 0, data: [] };
    }
    const v: CandleSeries = r.value;
    return {
      ...meta,
      currentPrice: v.currentPrice,
      changePct: v.changePct,
      basePrice: v.basePrice,
      // Opens are only for catalyst detection; the chart draws closes.
      data: v.data.map((d) => ({ date: d.date, price: d.price })),
    };
  });

  return NextResponse.json({ commodities });
}
