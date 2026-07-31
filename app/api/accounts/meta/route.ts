import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeAccountType, type AccountType } from "@/lib/account-types";

/* ─── GET: per-account type + display-name map for the current user ───
   → { types: { [account]: "brokerage" | "retirement" | "cash" },
       displayNames: { [account]: string },
       accounts: string[] }

   `accounts` is every account the user has *declared* (a row here), which
   includes accounts created with no holdings and no cash yet — the dashboard
   needs them to render an empty account in the sidebar. `displayNames` only
   contains accounts with a user-chosen label; everything else should fall
   back to showing the raw account name. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("account_meta")
    .select("account,type,display_name")
    .eq("user_id", user.id);

  if (error) {
    if (error.code === "42P01") {
      // Table not created yet — degrade gracefully so the dashboard still loads
      // and falls back to name-based type guessing.
      return NextResponse.json({ types: {}, displayNames: {}, accounts: [], needsMigration: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const types: Record<string, AccountType> = {};
  const displayNames: Record<string, string> = {};
  for (const row of data ?? []) {
    const account = row.account as string;
    types[account] = normalizeAccountType(row.type as string);
    const label = (row.display_name as string | null)?.trim();
    if (label) displayNames[account] = label;
  }
  return NextResponse.json({ types, displayNames, accounts: Object.keys(types).sort() });
}

/* ─── POST: set one account's type and/or display name → upsert (user_id, account) ───
   Body: { account, type?, displayName? }. Only the fields present are written —
   e.g. a rename-only request (no `type`) never touches the stored type, and
   vice versa. `displayName: ""` explicitly clears back to the raw account name. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const account: string = (body.account ?? "").trim();
  if (!account) return NextResponse.json({ error: "Account is required" }, { status: 400 });

  const row: Record<string, unknown> = { user_id: user.id, account, updated_at: new Date().toISOString() };
  let type: AccountType | undefined;
  if (body.type !== undefined) {
    type = normalizeAccountType(body.type);
    row.type = type;
  }
  let displayName: string | undefined;
  if (body.displayName !== undefined) {
    displayName = String(body.displayName).trim();
    row.display_name = displayName || null;
  }

  const { error } = await supabase
    .from("account_meta")
    .upsert(row, { onConflict: "user_id,account" });

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json(
        { error: "Account metadata not set up. Run supabase/account-meta.sql." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, account, type, displayName: displayName || null });
}

/* ─── DELETE: forget an account's declaration + type ───
   Called when an account is removed from the sidebar. Without this the row
   here would keep the (now holding-less) account alive in the sidebar, since
   declared accounts are rendered even at $0. */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const account: string = (body.account ?? "").trim();
  if (!account) return NextResponse.json({ error: "Account is required" }, { status: 400 });

  const { error } = await supabase
    .from("account_meta")
    .delete()
    .eq("user_id", user.id)
    .eq("account", account);

  // A missing table means there was nothing to forget — not an error here.
  if (error && error.code !== "42P01") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, account });
}
