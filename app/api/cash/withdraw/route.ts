import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordTransaction, sumNetDeposits } from "@/lib/transactions";

/* POST: withdraw cash from an account — DECREMENTS its cash balance by `amount`
   and records a WITHDRAWAL in the transactions ledger. Rejects if the account
   has no cash or the amount exceeds the balance. Mirrors the deposit route's
   optimistic-concurrency retry so interleaving cash moves can't clobber each
   other. Never touches account_meta (withdrawing doesn't change account type). */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const account: string = (body.account ?? "").trim();
  const amount = Number(body.amount);

  if (!account) return NextResponse.json({ error: "Account is required" }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Withdrawal amount must be a positive number" }, { status: 400 });
  }

  // Audit: cash − net-deposits-to-date is the "excess cash beyond what was
  // contributed" — it must read IDENTICAL before and after this withdrawal,
  // since a withdrawal moves cash_balance and the ledger by the exact same
  // amount. If this ever prints two different numbers, a withdrawal is
  // leaking into the return/gain calculation somewhere.
  const netDepositsBefore = await sumNetDeposits(supabase, user.id, account);
  const { data: preRow } = await supabase
    .from("cash_balances").select("balance").eq("user_id", user.id).eq("account", account).maybeSingle();
  const cashBefore = Number(preRow?.balance ?? 0);
  console.log(
    `[cash/withdraw audit] BEFORE ${account}: cash=${cashBefore.toFixed(2)} netDeposits=${netDepositsBefore.toFixed(2)} ` +
    `contributedCapitalCheck=${(cashBefore - netDepositsBefore).toFixed(2)}`,
  );

  const migrationErr = NextResponse.json(
    { error: "Run supabase/cash-balances.sql in the SQL Editor first" }, { status: 503 },
  );
  let newBalance = 0;
  let committed = false;

  for (let attempt = 0; attempt < 5 && !committed; attempt++) {
    const { data: existing, error: readErr } = await supabase
      .from("cash_balances")
      .select("balance")
      .eq("user_id", user.id)
      .eq("account", account)
      .maybeSingle();
    if (readErr) {
      if (readErr.code === "42P01") return migrationErr;
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }

    const current = Number(existing?.balance ?? 0);
    if (!existing || current <= 0) {
      return NextResponse.json({ error: "No cash to withdraw from this account" }, { status: 400 });
    }
    if (amount > current) {
      return NextResponse.json(
        { error: `Cannot withdraw more than the ${account} balance` }, { status: 400 },
      );
    }

    newBalance = Math.round((current - amount) * 100) / 100;
    const { data: updated, error: updErr } = await supabase
      .from("cash_balances")
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
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
      { error: "Withdrawal could not be applied due to concurrent updates — please retry." },
      { status: 409 },
    );
  }

  // Ledger row (best-effort — no-ops if the transactions table isn't deployed).
  // Recorded AFTER cash_balances commits — the balance is the source of
  // truth, the ledger is an audit trail of it, never the other way around.
  await recordTransaction(supabase, user.id, {
    account,
    action: "WITHDRAWAL",
    description: "Cash withdrawal",
    amount: -amount, // outflow (−)
  });

  const netDepositsAfter = netDepositsBefore - amount;
  console.log(
    `[cash/withdraw audit] AFTER  ${account}: cash=${newBalance.toFixed(2)} netDeposits=${netDepositsAfter.toFixed(2)} ` +
    `contributedCapitalCheck=${(newBalance - netDepositsAfter).toFixed(2)} (must equal the BEFORE value above)`,
  );

  return NextResponse.json({ ok: true, account, balance: newBalance });
}
