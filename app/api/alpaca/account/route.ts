import { NextResponse } from "next/server";
import { trading, alpacaConfigured, AlpacaError, type AlpacaAccount } from "@/lib/alpaca";

/**
 * Connection test + account snapshot. GET /api/alpaca/account
 * Returns { connected: false } with a hint if keys are missing,
 * otherwise the key account figures so the UI can confirm the link.
 */
export async function GET() {
  if (!alpacaConfigured) {
    return NextResponse.json(
      { connected: false, reason: "Alpaca API keys not set. Add ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY to .env.local and restart the dev server." },
      { status: 200 }
    );
  }

  try {
    const a = await trading.get<AlpacaAccount>("/v2/account");
    return NextResponse.json({
      connected: true,
      account: {
        accountNumber: a.account_number,
        status: a.status,
        currency: a.currency,
        cash: Number(a.cash),
        equity: Number(a.equity),
        lastEquity: Number(a.last_equity),
        portfolioValue: Number(a.portfolio_value),
        buyingPower: Number(a.buying_power),
      },
    });
  } catch (e) {
    const status = e instanceof AlpacaError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ connected: false, reason: message }, { status: status === 401 || status === 403 ? 200 : status });
  }
}
