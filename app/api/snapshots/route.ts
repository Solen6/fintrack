import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchQuotes } from "@/lib/finnhub";

/* ─── GET: the user's snapshot history, oldest first ─── */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("portfolio_snapshots")
    .select("snapshot_date,total_value")
    .eq("user_id", user.id)
    .order("snapshot_date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    snapshots: (data ?? []).map((s) => ({
      date: s.snapshot_date as string,
      value: Number(s.total_value),
    })),
  });
}

/* ─── POST: capture today's portfolio value (idempotent per day) ───
   Computes value server-side from real holdings × live quotes, then upserts
   today's row. Called fire-and-forget on dashboard load, so opening the app
   once a day is enough to build the history. */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: holdings, error: hErr } = await supabase
    .from("holdings")
    .select("ticker,shares,cost_basis")
    .eq("user_id", user.id);
  if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 });
  if (!holdings || holdings.length === 0) {
    return NextResponse.json({ captured: false, reason: "No holdings." });
  }

  const tickers = [...new Set(holdings.map((h) => h.ticker as string))];
  const quotes = await fetchQuotes(tickers);

  let totalValue = 0;
  let pricedPositions = 0;
  for (const h of holdings) {
    const q = quotes[(h.ticker as string).toUpperCase()];
    const price = q?.price ?? Number(h.cost_basis);
    if (q) pricedPositions++;
    totalValue += Number(h.shares) * price;
  }

  // Don't record a junk data point if live prices were broadly unavailable
  if (pricedPositions === 0) {
    return NextResponse.json({ captured: false, reason: "No live prices available." });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { error: upErr } = await supabase
    .from("portfolio_snapshots")
    .upsert(
      { user_id: user.id, snapshot_date: today, total_value: totalValue },
      { onConflict: "user_id,snapshot_date" }
    );
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({ captured: true, date: today, value: totalValue });
}
