import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { recordTransaction } from "@/lib/transactions";
import { normalizeNote } from "@/lib/notes";

/* POST: move cash between two of the user's own accounts — DECREMENTS the
   source balance and INCREMENTS the destination by the same amount, then
   records the matched TRANSFER_OUT / TRANSFER_IN ledger pair.

   Why this isn't just a withdraw + a deposit: a withdrawal followed by a
   deposit reads as "money left the portfolio, then new money arrived", which
   is true for neither. The TRANSFER pair nets to zero at the rollup, so total
   return is untouched, while each account still sees the flow it needs for its
   own return to stay honest. Neither account's type is changed. */

const r2 = (n: number) => Math.round(n * 100) / 100;

const MIGRATION_ERR = () =>
  NextResponse.json(
    { error: "Run supabase/cash-balances.sql in the SQL Editor first" },
    { status: 503 },
  );

/** Apply `delta` to one account's cash balance under optimistic concurrency:
 *  read the balance, then write it back guarded on the value we read, so an
 *  interleaving cash move can't silently clobber this one. Mirrors the retry
 *  loop in /api/cash/deposit and /api/cash/withdraw.
 *
 *  `requireFunds` rejects an overdraft (used for the debit leg). Returns the
 *  new balance, or a reason string the caller turns into a response. */
async function applyDelta(
  supabase: SupabaseClient,
  userId: string,
  account: string,
  delta: number,
  opts: { requireFunds: boolean; label?: string },
): Promise<{ balance: number } | { reason: "missing" | "insufficient" | "conflict" | "migration"; message?: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing, error: readErr } = await supabase
      .from("cash_balances")
      .select("balance,label")
      .eq("user_id", userId)
      .eq("account", account)
      .maybeSingle();
    if (readErr) {
      if (readErr.code === "42P01") return { reason: "migration" };
      return { reason: "conflict", message: readErr.message };
    }

    if (!existing) {
      // Debiting an account with no cash row is an overdraft, full stop.
      if (opts.requireFunds) return { reason: "missing" };
      // Crediting one creates it, the way a first deposit does.
      const balance = r2(delta);
      const { error: insErr } = await supabase.from("cash_balances").insert({
        user_id: userId,
        account,
        label: opts.label || "Cash",
        balance,
        updated_at: new Date().toISOString(),
      });
      if (!insErr) return { balance };
      if (insErr.code === "23505") continue;            // concurrent insert → retry as an update
      if (insErr.code === "42P01") return { reason: "migration" };
      return { reason: "conflict", message: insErr.message };
    }

    const current = Number(existing.balance) || 0;
    if (opts.requireFunds && current + delta < -1e-9) return { reason: "insufficient" };

    const balance = r2(current + delta);
    const { data: updated, error: updErr } = await supabase
      .from("cash_balances")
      .update({ balance, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("account", account)
      .eq("balance", existing.balance)                  // optimistic guard
      .select("balance");
    if (updErr) return { reason: "conflict", message: updErr.message };
    if (updated && updated.length > 0) return { balance };
    // 0 rows matched → the balance moved under us; loop re-reads and retries.
  }
  return { reason: "conflict" };
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const from: string = (body.from ?? "").trim();
  const to: string = (body.to ?? "").trim();
  const label: string = (body.label ?? "").trim();
  const amount = r2(Number(body.amount));
  // Optional free-text note. Stored as BOTH ledger rows' description, which is
  // the field the activity feed and the monthly/annual reports already print.
  const note = normalizeNote(body.note);

  if (!from || !to) return NextResponse.json({ error: "Both accounts are required" }, { status: 400 });
  if (from === to) {
    return NextResponse.json({ error: "Pick two different accounts" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Transfer amount must be a positive number" }, { status: 400 });
  }

  // Debit first. If the credit then fails we can hand the money back; the
  // reverse order could leave the destination credited with cash the source
  // never had.
  const debit = await applyDelta(supabase, user.id, from, -amount, { requireFunds: true });
  if ("reason" in debit) {
    if (debit.reason === "migration") return MIGRATION_ERR();
    if (debit.reason === "missing") {
      return NextResponse.json({ error: `${from} has no cash to transfer` }, { status: 400 });
    }
    if (debit.reason === "insufficient") {
      return NextResponse.json({ error: `Cannot transfer more than the ${from} balance` }, { status: 400 });
    }
    return NextResponse.json(
      { error: debit.message ?? "Transfer could not be applied due to concurrent updates — please retry." },
      { status: 409 },
    );
  }

  const credit = await applyDelta(supabase, user.id, to, amount, { requireFunds: false, label });
  if ("reason" in credit) {
    // Compensating rollback: Supabase gives us no cross-statement transaction,
    // so if the credit leg fails we put the debited cash back rather than let
    // it vanish. If the rollback ALSO fails, say so loudly with the amount and
    // account — a silent "transfer failed" would hide missing money.
    const undo = await applyDelta(supabase, user.id, from, amount, { requireFunds: false });
    const restored = !("reason" in undo);
    console.error(
      `[cash/transfer] credit leg failed for ${to} (${credit.reason}); ` +
      `rollback of ${amount} to ${from} ${restored ? "succeeded" : "ALSO FAILED"}`,
    );
    if (credit.reason === "migration" && restored) return MIGRATION_ERR();
    return NextResponse.json(
      {
        error: restored
          ? `Transfer failed while crediting ${to} — the ${from} balance was restored. Please retry.`
          : `Transfer failed while crediting ${to} AND the ${from} balance could not be restored. ` +
            `${from} is short ${amount.toFixed(2)} — fix it with a deposit before trading.`,
      },
      { status: 500 },
    );
  }

  // Ledger pair, written only after BOTH balances have committed — the balance
  // is the source of truth, the ledger is an audit trail of it. Best-effort:
  // no-ops if the transactions table isn't deployed.
  await recordTransaction(supabase, user.id, {
    account: from,
    action: "TRANSFER_OUT",
    description: note ?? `Transfer to ${to}`,
    amount: -amount, // outflow (−)
  });
  await recordTransaction(supabase, user.id, {
    account: to,
    action: "TRANSFER_IN",
    description: note ?? `Transfer from ${from}`,
    amount, // inflow (+)
  });

  return NextResponse.json({
    ok: true,
    amount,
    from: { account: from, balance: debit.balance },
    to: { account: to, balance: credit.balance },
  });
}
