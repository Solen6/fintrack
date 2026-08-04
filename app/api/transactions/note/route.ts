import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { NOTABLE_ACTIONS } from "@/lib/transactions";
import { normalizeNote } from "@/lib/notes";

/* PATCH /api/transactions/note — edit the note on one cash-flow ledger row.

   The ledger is otherwise append-only (see supabase/transactions-ledger.sql):
   holdings, cash, and every return series are DERIVED by replaying `action` /
   `amount` / `quantity` / `price`. `description` feeds none of that — it is
   display text only — so rewriting it annotates history without restating it.
   Nothing about the money moves.

   Deliberately narrow: only the caller's OWN rows, and only DEPOSIT /
   WITHDRAWAL. A BUY or DIV description is derived from the trade or the CSV
   import, so letting it be overwritten would make the ledger disagree with its
   source. */

const DEFAULT_LABEL: Record<string, string> = {
  DEPOSIT: "Cash deposit",
  WITHDRAWAL: "Cash withdrawal",
};

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id: string = (body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Transaction id is required" }, { status: 400 });

  const note = normalizeNote(body.note);

  // Read first so a cleared note can fall back to the row's action-specific
  // label, and so we can 404 rather than silently updating zero rows.
  const { data: row, error: readErr } = await supabase
    .from("transactions")
    .select("id, action")
    .eq("user_id", user.id)
    .eq("id", id)
    .maybeSingle();

  if (readErr) {
    if (readErr.code === "42P01") {
      return NextResponse.json(
        { error: "Run supabase/transactions-ledger.sql in the SQL Editor first" }, { status: 503 },
      );
    }
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

  const action = String(row.action ?? "").toUpperCase();
  if (!(NOTABLE_ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json(
      { error: "Only deposits and withdrawals can carry a note" }, { status: 400 },
    );
  }

  const description = note ?? DEFAULT_LABEL[action] ?? action;
  const { error: updErr } = await supabase
    .from("transactions")
    .update({ description })
    .eq("user_id", user.id)   // belt-and-braces alongside RLS
    .eq("id", id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, id, description });
}
