import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/* Best-effort writer for the transactions ledger (supabase/transactions-ledger.sql).
   Manual events (a BUY from "Add position", a DEPOSIT from "Deposit") append one
   immutable row each. If the table isn't deployed yet, this no-ops silently so
   the underlying action (insert holding / update cash) still succeeds. */

export type TxnAction =
  | "BUY" | "SELL" | "DIV" | "DEPOSIT" | "WITHDRAWAL" | "INTEREST" | "FEE" | "OTHER";

export interface TxnInput {
  account: string;
  action: TxnAction;
  symbol?: string | null;
  description?: string | null;
  quantity?: number | null;
  price?: number | null;
  amount: number;       // signed USD cash impact: inflow +, outflow −
  tradeDate?: string;   // YYYY-MM-DD; defaults to today (US market day)
}

const FLOW_ACTIONS = ["DEPOSIT", "WITHDRAWAL", "TRANSFER_IN", "TRANSFER_OUT", "TRANSFER"] as const;

/** Σ signed external cash flows (deposits +, withdrawals −) recorded so far
 *  for one account — used to audit that cash_balance stays in lockstep with
 *  the ledger (cash − netDeposits must be flow-invariant). Best-effort: 0 if
 *  the ledger table isn't deployed yet. */
export async function sumNetDeposits(
  supabase: SupabaseClient,
  userId: string,
  account: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("transactions")
    .select("amount")
    .eq("user_id", userId)
    .eq("account", account)
    .in("action", FLOW_ACTIONS);
  if (error || !data) return 0;
  return data.reduce((s, r) => s + Number(r.amount ?? 0), 0);
}

function todayEastern(): string {
  // en-CA renders YYYY-MM-DD; anchor to New York so the date matches the market day.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Append one ledger row. Returns true if it landed, false if it was skipped
 *  (table missing) or errored — never throws, so callers can fire-and-forget. */
export async function recordTransaction(
  supabase: SupabaseClient,
  userId: string,
  t: TxnInput,
): Promise<boolean> {
  try {
    const { error } = await supabase.from("transactions").insert({
      user_id: userId,
      account: t.account,
      broker: "manual",
      trade_date: t.tradeDate ?? todayEastern(),
      action: t.action,
      symbol: t.symbol ?? null,
      description: t.description ?? null,
      quantity: t.quantity ?? null,
      price: t.price ?? null,
      amount: t.amount ?? 0,
      // Manual events are one-off — a UUID guarantees the unique(dedupe_hash)
      // constraint passes (the CSV importer uses a content hash for idempotency).
      dedupe_hash: randomUUID(),
    });
    return !error;
  } catch {
    return false;
  }
}
