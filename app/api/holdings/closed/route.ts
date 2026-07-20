import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("closed_positions")
    .select("*")
    .eq("user_id", user.id)
    .order("closed_at", { ascending: false });

  if (error) {
    if (error.message?.includes("relation") && error.message?.includes("does not exist")) {
      return NextResponse.json({ closed: [], needsMigration: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ closed: data ?? [] });
}

/* ─── PATCH: edit a closed position's record ───
   Editable: cost_basis, sale_price, closed_at (date), notes. Shares, ticker,
   and account stay locked — the close already carved those out of the live
   holding, so changing them here would desync the two sides. realized_gain is
   a generated column and recomputes on its own. A sale-price change re-adjusts
   the account's cash by the proceeds delta (same convention as the close
   itself; futures skipped — they never moved cash). */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { id, cost_basis, sale_price, closed_at, notes } = body as {
    id: string;
    cost_basis?: number;
    sale_price?: number;
    closed_at?: string; // YYYY-MM-DD
    notes?: string | null;
  };
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { data: row, error: fetchErr } = await supabase
    .from("closed_positions")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();
  if (fetchErr || !row) {
    return NextResponse.json({ error: "Closed position not found" }, { status: 404 });
  }

  const updates: Record<string, unknown> = {};
  if (cost_basis !== undefined) {
    if (typeof cost_basis !== "number" || !Number.isFinite(cost_basis) || cost_basis < 0) {
      return NextResponse.json({ error: "cost_basis must be a number ≥ 0" }, { status: 400 });
    }
    updates.cost_basis = cost_basis;
  }
  if (sale_price !== undefined) {
    // 0 is legitimate — an option expiring worthless closes at 0.
    if (typeof sale_price !== "number" || !Number.isFinite(sale_price) || sale_price < 0) {
      return NextResponse.json({ error: "sale_price must be a number ≥ 0" }, { status: 400 });
    }
    updates.sale_price = sale_price;
  }
  if (closed_at !== undefined) {
    if (typeof closed_at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(closed_at)) {
      return NextResponse.json({ error: "closed_at must be YYYY-MM-DD" }, { status: 400 });
    }
    // 16:00Z lands on the same calendar date in both UTC and ET, so the day
    // Carter picks is the day every view (reports, this table) shows.
    updates.closed_at = `${closed_at}T16:00:00Z`;
  }
  if (notes !== undefined) updates.notes = notes === null ? null : String(notes);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error: updErr } = await supabase
    .from("closed_positions")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Re-adjust cash for a changed sale price. row.shares is signed, so the
  // delta is correct for shorts too (covering cheaper = cash debited less =
  // positive delta) with no branching.
  let cashDelta = 0;
  const newPrice = updates.sale_price as number | undefined;
  const isFuture = (row.instrument_type ?? "equity") === "future";
  if (newPrice !== undefined && !isFuture) {
    const shares = Number(row.shares);
    const oldProceeds = Math.round(shares * Number(row.sale_price) * 100) / 100;
    const newProceeds = Math.round(shares * newPrice * 100) / 100;
    cashDelta = Math.round((newProceeds - oldProceeds) * 100) / 100;
    if (cashDelta !== 0) {
      const { data: existingCash } = await supabase
        .from("cash_balances")
        .select("balance,label")
        .eq("user_id", user.id)
        .eq("account", row.account)
        .maybeSingle();
      const newBalance = Math.round((Number(existingCash?.balance ?? 0) + cashDelta) * 100) / 100;
      await supabase.from("cash_balances").upsert(
        {
          user_id: user.id,
          account: row.account,
          label: existingCash?.label ?? "Cash",
          balance: newBalance,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,account" },
      );
    }
  }

  const { data: fresh } = await supabase
    .from("closed_positions")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({ ok: true, position: fresh, cashDelta });
}
