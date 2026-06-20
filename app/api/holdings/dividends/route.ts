import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Recorded dividends from the corporate-actions ledger. Self-contained: ticker/
  // name/amount/reinvested are stored on the row (not joined from holdings), so
  // the history persists after a position is closed or deleted.
  const { data, error } = await supabase
    .from("applied_corporate_actions")
    .select("holding_id, effective_date, detail, ticker, name, amount, reinvested")
    .eq("user_id", user.id)
    .eq("action_type", "dividend")
    .order("effective_date", { ascending: false });

  if (error) {
    if (error.message?.includes("does not exist")) {
      return NextResponse.json({ dividends: [], needsMigration: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const dividends = (data ?? []).map((r) => ({
    id: `${r.holding_id}-${r.effective_date}`,
    date: r.effective_date as string,
    ticker: (r.ticker as string | null) ?? "—",
    name: (r.name as string | null) ?? null,
    amount: (r.amount as number | null) ?? null,
    reinvested: (r.reinvested as boolean | null) ?? null,
    detail: (r.detail as string | null) ?? null,
  }));

  return NextResponse.json({ dividends });
}
