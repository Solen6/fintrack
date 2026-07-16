import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeDerivativeMarks, type DerivativeRow } from "@/lib/derivative-marks";

/**
 * GET — live marks for the signed-in user's real option/future holdings.
 * Returns { marks: { [holdingId]: { currentPrice } } }. Never 500s — a row
 * simply falls back to cost basis (client-side) if its mark can't be found.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("holdings")
    .select("id, instrument_type, underlying, expiry, strike, option_type")
    .eq("user_id", user.id)
    .in("instrument_type", ["option", "future"]);

  if (error) return NextResponse.json({ marks: {} });

  try {
    const marks = await computeDerivativeMarks((data ?? []) as DerivativeRow[]);
    return NextResponse.json({ marks });
  } catch {
    return NextResponse.json({ marks: {} });
  }
}
