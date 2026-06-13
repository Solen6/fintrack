import { NextResponse, type NextRequest } from "next/server";
import { priceInstrument } from "@/lib/paper-pricing";
import type { AssetClass, InstrumentRef, OptionType } from "@/lib/paper-types";

/* GET: live mark for any instrument — drives the trade-ticket est. cost/margin */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const assetClass = (sp.get("assetClass") ?? "STOCK").toUpperCase() as AssetClass;

  let ref: InstrumentRef;
  if (assetClass === "OPTION") {
    const underlying = (sp.get("underlying") ?? "").trim().toUpperCase();
    const expiry = sp.get("expiry") ?? "";
    const strike = Number(sp.get("strike"));
    const optionType = (sp.get("optionType") ?? "").toUpperCase() as OptionType;
    if (!underlying || !expiry || !Number.isFinite(strike) || (optionType !== "CALL" && optionType !== "PUT")) {
      return NextResponse.json({ error: "Missing option params." }, { status: 400 });
    }
    ref = { assetClass, symbol: "", underlying, expiry, strike, optionType };
  } else {
    const symbol = (sp.get("symbol") ?? "").trim().toUpperCase();
    if (!symbol) return NextResponse.json({ error: "symbol is required." }, { status: 400 });
    ref = { assetClass, symbol };
  }

  const priced = await priceInstrument(ref);
  if (!priced) return NextResponse.json({ price: null });
  return NextResponse.json({ price: priced.price });
}
