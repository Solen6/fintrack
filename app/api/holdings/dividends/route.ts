import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("applied_corporate_actions")
    .select("id, holding_id, effective_date, detail, ticker, name, amount, reinvested, shares_delta, cash_delta, account, is_manual")
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
    // Use real UUID if available (post-migration), fall back to composite key.
    id: (r.id as string | null) ?? `${r.holding_id}-${r.effective_date}`,
    holdingId: r.holding_id as string,
    date: r.effective_date as string,
    ticker: (r.ticker as string | null) ?? "—",
    name: (r.name as string | null) ?? null,
    amount: (r.amount as number | null) ?? null,
    reinvested: (r.reinvested as boolean | null) ?? null,
    detail: (r.detail as string | null) ?? null,
    sharesDelta: (r.shares_delta as number | null) ?? 0,
    cashDelta: (r.cash_delta as number | null) ?? 0,
    account: (r.account as string | null) ?? null,
    isManual: (r.is_manual as boolean | null) ?? false,
  }));

  return NextResponse.json({ dividends });
}
