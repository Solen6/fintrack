import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveAccount } from "@/lib/paper-engine";

/* GET: equity curve (paper_snapshots) for an account */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const account = await resolveAccount(supabase, user.id, request.nextUrl.searchParams.get("account"));
    const { data } = await supabase
      .from("paper_snapshots")
      .select("snapshot_date, equity, cash")
      .eq("account_id", account.id)
      .order("snapshot_date");

    return NextResponse.json({
      accountId: account.id,
      startingCash: Number(account.starting_cash),
      snapshots: (data ?? []).map((s) => ({
        date: s.snapshot_date,
        equity: Number(s.equity),
        cash: Number(s.cash),
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
