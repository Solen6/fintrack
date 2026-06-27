import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordTransaction } from "@/lib/transactions";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { ticker, name, shares, cost_basis, account, notes } = body as {
    ticker: string;
    name?: string;
    shares: number;
    cost_basis: number;
    account: string;
    notes?: string;
  };

  if (!ticker || !shares || shares <= 0 || !account) {
    return NextResponse.json({ error: "ticker, shares (>0), and account are required" }, { status: 400 });
  }

  const perShare = cost_basis ?? 0;
  const { error } = await supabase.from("holdings").insert({
    user_id: user.id,
    ticker: ticker.toUpperCase(),
    name: name ?? ticker.toUpperCase(),
    shares,
    cost_basis: perShare,
    account: account.trim(),
    notes: notes ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Record the buy in the activity ledger (best-effort; cost_basis is per-share).
  await recordTransaction(supabase, user.id, {
    account: account.trim(),
    action: "BUY",
    symbol: ticker.toUpperCase(),
    description: `Bought ${name ?? ticker.toUpperCase()}`,
    quantity: shares,
    price: perShare,
    amount: -(shares * perShare), // cash outflow (−)
  });

  return NextResponse.json({ ok: true });
}
