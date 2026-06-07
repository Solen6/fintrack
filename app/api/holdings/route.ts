import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* ─── GET: fetch user's holdings ─── */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("holdings")
    .select("*")
    .eq("user_id", user.id)
    .order("ticker");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ holdings: data ?? [] });
}

/* ─── POST: replace holdings for a specific account ─── */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const accountName: string = body.accountName?.trim();
  const holdings = body.holdings as Array<{
    ticker: string;
    name?: string;
    shares: number;
    cost_basis: number;
    sector?: string;
    notes?: string;
  }>;

  if (!accountName) {
    return NextResponse.json({ error: "Account name is required" }, { status: 400 });
  }
  if (!Array.isArray(holdings) || holdings.length === 0) {
    return NextResponse.json({ error: "No holdings provided" }, { status: 400 });
  }

  // Replace only holdings for this account — other accounts are untouched
  await supabase.from("holdings").delete().eq("user_id", user.id).eq("account", accountName);

  const rows = holdings.map(h => ({
    user_id:    user.id,
    ticker:     h.ticker.toUpperCase(),
    name:       h.name ?? h.ticker,
    shares:     h.shares,
    cost_basis: h.cost_basis,
    account:    accountName,
    sector:     h.sector ?? null,
    notes:      h.notes ?? null,
  }));

  const { error } = await supabase.from("holdings").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ saved: rows.length });
}

/* ─── DELETE: remove a single holding by id, or all holdings for an account ─── */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  if (body.account) {
    await supabase.from("holdings").delete().eq("user_id", user.id).eq("account", body.account);
  } else if (body.id) {
    await supabase.from("holdings").delete().eq("id", body.id).eq("user_id", user.id);
  }
  return NextResponse.json({ ok: true });
}
