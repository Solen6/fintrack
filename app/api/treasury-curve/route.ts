import { NextResponse } from "next/server";
import { getTreasuryCurve } from "@/lib/treasury-curve";

/**
 * GET — the current U.S. Treasury par-yield curve for the News-tab yield-curve
 * panel. Public market data (same as /api/macro); returns { curve: null } if
 * every upstream source is unreachable rather than erroring.
 */
export async function GET() {
  try {
    const curve = await getTreasuryCurve();
    return NextResponse.json({ curve });
  } catch {
    return NextResponse.json({ curve: null });
  }
}
