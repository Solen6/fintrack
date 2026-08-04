import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildTickerEventInfo } from "@/lib/calendar-events";
import { isPriceable } from "@/lib/portfolio-positions";

export type { TickerEventInfo } from "@/lib/calendar-events";

/* GET /api/holdings/events

   Upcoming earnings + dividend dates per held ticker, for the "E"/"D" badges on
   the Accounts-tab heatmap. Same fetchers (and therefore the same dates) as
   /api/calendar — this route just reshapes them into one row per ticker and
   skips the macro/split feeds the badge doesn't use. */

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 90;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  type Row = Record<string, unknown>;
  const { data, error } = await supabase
    .from("holdings")
    .select("ticker, name, shares, instrument_type, bond_type")
    .eq("user_id", user.id);
  // Pre-migration DBs have no instrument_type/bond_type columns — fall back to
  // the plain select rather than returning nothing (matches /api/holdings).
  const holdings: Row[] = error
    ? ((await supabase.from("holdings").select("ticker, name, shares").eq("user_id", user.id)).data ?? [])
    : (data ?? []);

  const refs = holdings
    .filter((h) =>
      isPriceable({
        instrument_type: (h.instrument_type as string | null) ?? null,
        bond_type: (h.bond_type as string | null) ?? null,
      }),
    )
    .map((h) => ({
      ticker: (h.ticker as string) ?? "",
      name: (h.name as string) ?? (h.ticker as string),
      shares: Number(h.shares ?? 0),
    }))
    // Neither upstream knows anything about the synthetic cash row or an option
    // contract's multi-word ticker; skipping them saves the round trips.
    .filter((h) => h.ticker && h.ticker.toUpperCase() !== "CASH" && !/\s/.test(h.ticker));

  const today = new Date().toISOString().split("T")[0];
  const to = new Date(Date.now() + WINDOW_DAYS * DAY_MS).toISOString().split("T")[0];

  const events = await buildTickerEventInfo(user.id, refs, today, to);
  return NextResponse.json({ events, from: today, to });
}
