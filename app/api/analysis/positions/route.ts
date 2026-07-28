import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadPriceablePositions } from "@/lib/portfolio-positions";
import type { AnalysisPositionsResponse } from "@/lib/analytics/api-types";

export const dynamic = "force-dynamic";

/** Fast list of the user's priceable positions with current weights, for the
    "autofill from portfolio" action. Uses live quotes (not Yahoo history), so
    it returns in well under a second. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { positions, cash, riskyValue, totalValue, pricesStale } =
      await loadPriceablePositions(supabase, user.id);

    if (positions.length === 0) {
      const empty: AnalysisPositionsResponse = {
        positions: [], cash, riskyValue: 0, totalValue: cash, empty: true,
      };
      return NextResponse.json(empty);
    }

    const payload: AnalysisPositionsResponse = {
      positions, cash, riskyValue, totalValue, pricesStale,
    };
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load positions" },
      { status: 500 },
    );
  }
}
