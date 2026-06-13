import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listAccounts, STARTING_CASH } from "@/lib/paper-engine";

const MAX_ACCOUNTS = 8;

/* POST: create a named account */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const name = String(body.name ?? "").trim().slice(0, 40);
  if (!name) return NextResponse.json({ error: "Account name is required." }, { status: 400 });

  try {
    const existing = await listAccounts(supabase, user.id);
    if (existing.length >= MAX_ACCOUNTS) {
      return NextResponse.json({ error: `Limit reached (${MAX_ACCOUNTS} accounts).` }, { status: 422 });
    }
    if (existing.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      return NextResponse.json({ error: `You already have an account named "${name}".` }, { status: 422 });
    }
    const { data, error } = await supabase
      .from("paper_accounts")
      .insert({ user_id: user.id, name, cash: STARTING_CASH, starting_cash: STARTING_CASH })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ account: { id: data.id, name: data.name } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

/* PATCH: rename, or reset an account to its starting cash */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const accountId = String(body.accountId ?? "");
  if (!accountId) return NextResponse.json({ error: "accountId is required." }, { status: 400 });

  try {
    const accounts = await listAccounts(supabase, user.id);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    if (body.reset === true) {
      // Wipe positions/orders/realized and restore starting cash.
      await Promise.all([
        supabase.from("paper_positions").delete().eq("account_id", accountId),
        supabase.from("paper_orders").delete().eq("account_id", accountId),
        supabase.from("paper_realized").delete().eq("account_id", accountId),
        supabase.from("paper_snapshots").delete().eq("account_id", accountId),
      ]);
      await supabase.from("paper_accounts")
        .update({ cash: Number(account.starting_cash), margin_used: 0 })
        .eq("id", accountId);
      return NextResponse.json({ ok: true, reset: true });
    }

    const name = body.name != null ? String(body.name).trim().slice(0, 40) : null;
    if (name) {
      if (accounts.some((a) => a.id !== accountId && a.name.toLowerCase() === name.toLowerCase())) {
        return NextResponse.json({ error: `You already have an account named "${name}".` }, { status: 422 });
      }
      await supabase.from("paper_accounts").update({ name }).eq("id", accountId);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}

/* DELETE: remove an account (cascades positions/orders); can't delete the last one */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId = request.nextUrl.searchParams.get("account");
  if (!accountId) return NextResponse.json({ error: "account query param is required." }, { status: 400 });

  try {
    const accounts = await listAccounts(supabase, user.id);
    if (!accounts.some((a) => a.id === accountId)) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }
    if (accounts.length <= 1) {
      return NextResponse.json({ error: "Can't delete your only account." }, { status: 422 });
    }
    await supabase.from("paper_accounts").delete().eq("id", accountId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
