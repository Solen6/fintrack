import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeAccountType, type AccountType } from "@/lib/account-types";

/* ─── GET: per-account type map for the current user ───
   → { types: { [account]: "brokerage" | "retirement" | "cash" } } */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("account_meta")
    .select("account,type")
    .eq("user_id", user.id);

  if (error) {
    if (error.code === "42P01") {
      // Table not created yet — degrade gracefully so the dashboard still loads
      // and falls back to name-based type guessing.
      return NextResponse.json({ types: {}, needsMigration: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const types: Record<string, AccountType> = {};
  for (const row of data ?? []) {
    types[row.account as string] = normalizeAccountType(row.type as string);
  }
  return NextResponse.json({ types });
}

/* ─── POST: set one account's type → upsert (user_id, account) ─── */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const account: string = (body.account ?? "").trim();
  const type = normalizeAccountType(body.type);
  if (!account) return NextResponse.json({ error: "Account is required" }, { status: 400 });

  const { error } = await supabase
    .from("account_meta")
    .upsert(
      { user_id: user.id, account, type, updated_at: new Date().toISOString() },
      { onConflict: "user_id,account" },
    );

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json(
        { error: "Account metadata not set up. Run supabase/account-meta.sql." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, account, type });
}
