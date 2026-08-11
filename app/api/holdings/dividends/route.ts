import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  type Row = Record<string, unknown>;
  /* Coupons ride the same ledger as dividends (action_type 'coupon', written by
     lib/bond-lifecycle.ts) and belong on the same income surface, so they're
     read together. Only the READ is widened: the correction and manual-entry
     routes still filter action_type = 'dividend', so none of the DRIP-toggle /
     edit machinery can reach a coupon row — a coupon has no reinvestment
     choice to correct. Redemptions are deliberately excluded: returned
     principal is not income. */
  const read = (cols: string) =>
    supabase
      .from("applied_corporate_actions")
      .select(cols)
      .eq("user_id", user.id)
      .in("action_type", ["dividend", "coupon"])
      .order("effective_date", { ascending: false });

  const BASE =
    "id, holding_id, action_type, effective_date, detail, ticker, name, amount, reinvested, shares_delta, cash_delta, account, is_manual";

  let { data, error } = await read(`${BASE}, pay_date`);
  // Pre-migration (supabase/dividend-pay-date.sql not run yet) → retry without
  // pay_date so the history still loads, just with every row Pending-unknown.
  let hasPayDate = true;
  if (error && /pay_date|column|schema cache|PGRST204/i.test(error.message ?? "")) {
    hasPayDate = false;
    ({ data, error } = await read(BASE));
  }
  const rows = (data ?? []) as unknown as Row[];

  if (error) {
    if (error.message?.includes("does not exist")) {
      return NextResponse.json({ dividends: [], needsMigration: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  const dividends = rows.map((r) => {
    const payDate = hasPayDate ? ((r.pay_date as string | null) ?? null) : null;
    return {
    // Use real UUID if available (post-migration), fall back to composite key.
    id: (r.id as string | null) ?? `${r.holding_id}-${r.effective_date}`,
    holdingId: r.holding_id as string,
    /* 'dividend' | 'coupon'. The client keys off this to label the row and,
       more importantly, to know that everything from the ledger has actually
       been PAID — it only projects coupons forward from today, so a projected
       and a recorded coupon can never both count the same payment. */
    kind: ((r.action_type as string | null) ?? "dividend") as "dividend" | "coupon",
    /* `date` is the row's INCOME date — the pay date when we know it, so the
       history sorts and reports on when the cash actually landed. The ex-date
       stays available separately; it's the entitlement date, not income. */
    date: payDate ?? (r.effective_date as string),
    exDate: r.effective_date as string,
    payDate,
    /* Paid = we know a pay date and it has arrived. An unknown pay date is
       NOT treated as paid: it stays Pending, which is what keeps an ETF
       distribution out of the received total until its date is known. */
    paid: payDate != null && payDate <= today,
    ticker: (r.ticker as string | null) ?? "—",
    name: (r.name as string | null) ?? null,
    amount: (r.amount as number | null) ?? null,
    reinvested: (r.reinvested as boolean | null) ?? null,
    detail: (r.detail as string | null) ?? null,
    sharesDelta: (r.shares_delta as number | null) ?? 0,
    cashDelta: (r.cash_delta as number | null) ?? 0,
    account: (r.account as string | null) ?? null,
    isManual: (r.is_manual as boolean | null) ?? false,
    };
  })
  // Re-sort on the income date — swapping ex-dates for pay dates reorders rows
  // (a late-month ex-date can pay after an early-month one).
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return NextResponse.json({ dividends, hasPayDate });
}
