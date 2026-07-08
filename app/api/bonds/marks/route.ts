import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeBondMarks, type BondRow } from "@/lib/bond-marks";

/**
 * GET — live marks + analytics for the signed-in user's non-ETF bonds.
 * Returns { marks: { [holdingId]: BondMark } }. Bond ETFs are intentionally
 * omitted (they price through /api/quotes). Never 500s on a pricing failure —
 * bonds simply fall back to cost inside computeBondMarks.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("holdings")
    .select(
      "id, ticker, shares, cost_basis, bond_type, coupon_rate, coupon_freq, maturity_date, day_count, price_source, manual_price, credit_spread_bps",
    )
    .eq("user_id", user.id)
    .eq("instrument_type", "bond");

  if (error) return NextResponse.json({ marks: {} });

  try {
    const marks = await computeBondMarks((data ?? []) as BondRow[]);
    return NextResponse.json({ marks });
  } catch {
    return NextResponse.json({ marks: {} });
  }
}
