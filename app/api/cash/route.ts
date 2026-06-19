import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* ─── GET: user's cash balances, one per account ───
   → { balances: [{ account, label, balance }] } */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("cash_balances")
    .select("account,label,balance")
    .eq("user_id", user.id);

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json({ balances: [], needsMigration: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    balances: (data ?? []).map((r) => ({
      account: r.account as string,
      label: (r.label as string) ?? "Cash",
      balance: Number(r.balance),
    })),
  });
}

/* ─── POST: set an account's cash balance (upsert) ─── */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const account: string = (body.account ?? "").trim();
  const label: string = (body.label ?? "Cash").trim() || "Cash";
  const balance = Number(body.balance);

  if (!account) return NextResponse.json({ error: "Account is required" }, { status: 400 });
  if (!Number.isFinite(balance) || balance < 0) {
    return NextResponse.json({ error: "Balance must be a non-negative number" }, { status: 400 });
  }

  const { error } = await supabase
    .from("cash_balances")
    .upsert(
      { user_id: user.id, account, label, balance, updated_at: new Date().toISOString() },
      { onConflict: "user_id,account" },
    );

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json(
        { error: "Run supabase/cash-balances.sql in the SQL Editor first" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, account, balance });
}

/* ─── DELETE: remove an account's cash balance ─── */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const account: string = (body.account ?? "").trim();
  if (!account) return NextResponse.json({ error: "Account is required" }, { status: 400 });

  await supabase
    .from("cash_balances")
    .delete()
    .eq("user_id", user.id)
    .eq("account", account);

  return NextResponse.json({ ok: true });
}
