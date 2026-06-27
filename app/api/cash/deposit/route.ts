import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordTransaction } from "@/lib/transactions";

/* POST: deposit cash into an account — INCREMENTS its cash balance by `amount`
   and records a DEPOSIT in the transactions ledger. Deliberately does NOT touch
   account_meta, so depositing never converts the account to a "cash" type. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const account: string = (body.account ?? "").trim();
  const label: string = (body.label ?? "").trim();
  const amount = Number(body.amount);

  if (!account) return NextResponse.json({ error: "Account is required" }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Deposit amount must be a positive number" }, { status: 400 });
  }

  // Increment with optimistic concurrency: read the balance, then apply it with
  // a guard (update only matches if the balance is still what we read). A
  // concurrent deposit changes the balance → the guarded update matches 0 rows
  // → re-read and retry, so two interleaving deposits can't silently clobber
  // each other (the read-then-upsert version could drop money).
  const migrationErr = NextResponse.json(
    { error: "Run supabase/cash-balances.sql in the SQL Editor first" }, { status: 503 },
  );
  let newBalance = amount;
  let committed = false;

  for (let attempt = 0; attempt < 5 && !committed; attempt++) {
    const { data: existing, error: readErr } = await supabase
      .from("cash_balances")
      .select("balance,label")
      .eq("user_id", user.id)
      .eq("account", account)
      .maybeSingle();
    if (readErr) {
      if (readErr.code === "42P01") return migrationErr;
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }

    if (!existing) {
      newBalance = amount;
      const { error: insErr } = await supabase
        .from("cash_balances")
        .insert({ user_id: user.id, account, label: label || "Cash", balance: newBalance, updated_at: new Date().toISOString() });
      if (!insErr) { committed = true; break; }
      if (insErr.code === "23505") continue;            // concurrent insert → retry as update
      if (insErr.code === "42P01") return migrationErr;
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    newBalance = Number(existing.balance) + amount;
    const finalLabel = label || (existing.label as string | undefined) || "Cash";
    const { data: updated, error: updErr } = await supabase
      .from("cash_balances")
      .update({ balance: newBalance, label: finalLabel, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("account", account)
      .eq("balance", existing.balance)                  // optimistic guard
      .select("balance");
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    if (updated && updated.length > 0) { committed = true; break; }
    // 0 rows matched → balance changed under us; loop re-reads and retries.
  }

  if (!committed) {
    return NextResponse.json(
      { error: "Deposit could not be applied due to concurrent updates — please retry." },
      { status: 409 },
    );
  }

  // Ledger row (best-effort — no-ops if the transactions table isn't deployed).
  await recordTransaction(supabase, user.id, {
    account,
    action: "DEPOSIT",
    description: "Cash deposit",
    amount, // inflow (+)
  });

  return NextResponse.json({ ok: true, account, balance: newBalance });
}
