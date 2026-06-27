import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* Unified recent account activity for the portfolio deck.
   Merges the real, dated sources we have:
     · SELL  ← closed_positions (closed_at)
     · DIV   ← applied_corporate_actions (action_type=dividend, effective_date)
     · BUY / DEPOSIT / WITHDRAWAL / … ← transactions ledger, if deployed+populated
   The transactions ledger has no writer yet, so it returns empty until wired —
   buys/deposits light up automatically once it's populated. Each source is
   isolated in try/catch so a missing table never breaks the feed. */

export type ActivityType = "BUY" | "SELL" | "DIV" | "DEPOSIT" | "WITHDRAWAL" | "INTEREST" | "FEE" | "TRANSFER" | "OTHER";

export interface ActivityItem {
  id: string;
  date: string;          // YYYY-MM-DD
  type: ActivityType;
  symbol: string | null;
  description: string;
  shares: number | null;
  price: number | null;
  amount: number;        // signed USD cash impact: inflow +, outflow − (0 for DRIP)
  gross: number;         // event size for display (e.g. full dividend even if reinvested)
  account: string | null;
}

// Ledger actions that have NO dedicated table (so we don't double-count SELL/DIV).
const LEDGER_ACTIONS: Record<string, ActivityType> = {
  BUY: "BUY", DEPOSIT: "DEPOSIT", WITHDRAWAL: "WITHDRAWAL",
  INTEREST: "INTEREST", FEE: "FEE", TRANSFER_IN: "TRANSFER", TRANSFER_OUT: "TRANSFER", OTHER: "OTHER",
};

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const daysParam = Number(request.nextUrl.searchParams.get("days") ?? "30");
  const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 365 ? daysParam : 30;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  const cutoffISO = cutoff.toISOString();
  const cutoffDate = cutoffISO.slice(0, 10);

  const items: ActivityItem[] = [];
  let hasLedger = false;

  // ── Sells ───────────────────────────────────────────────────────────────
  try {
    const { data, error } = await supabase
      .from("closed_positions")
      .select("id, ticker, name, shares, sale_price, account, closed_at")
      .eq("user_id", user.id)
      .gte("closed_at", cutoffISO)
      .order("closed_at", { ascending: false });
    if (!error && data) {
      for (const r of data) {
        const shares = Number(r.shares) || 0;
        const price = Number(r.sale_price) || 0;
        items.push({
          id: `sell-${r.id}`,
          date: String(r.closed_at).slice(0, 10),
          type: "SELL",
          symbol: r.ticker as string,
          description: (r.name as string) ?? (r.ticker as string),
          shares, price,
          amount: shares * price, // proceeds (inflow)
          gross: shares * price,
          account: (r.account as string) ?? null,
        });
      }
    }
  } catch { /* table missing — skip */ }

  // ── Dividends ─────────────────────────────────────────────────────────────
  try {
    const { data, error } = await supabase
      .from("applied_corporate_actions")
      .select("id, holding_id, effective_date, ticker, name, amount, reinvested, cash_delta, account")
      .eq("user_id", user.id)
      .eq("action_type", "dividend")
      .gte("effective_date", cutoffDate)
      .order("effective_date", { ascending: false });
    if (!error && data) {
      for (const r of data) {
        const reinvested = r.reinvested === true;
        // gross = the dividend's value; cash impact is 0 when reinvested (DRIP),
        // else the real cash credit (prefer cash_delta, fall back to amount for
        // legacy rows authored before the delta columns existed).
        const gross = (r.amount as number | null) ?? (r.cash_delta as number | null) ?? 0;
        const amt = reinvested ? 0 : ((r.cash_delta as number | null) ?? (r.amount as number | null) ?? 0);
        items.push({
          id: `div-${(r.id as string | null) ?? `${r.holding_id}-${r.effective_date}`}`,
          date: String(r.effective_date).slice(0, 10),
          type: "DIV",
          symbol: (r.ticker as string | null) ?? null,
          description: reinvested ? "Dividend · reinvested" : "Dividend · cash",
          shares: null, price: null,
          amount: amt,
          gross,
          account: (r.account as string | null) ?? null,
        });
      }
    }
  } catch { /* table missing — skip */ }

  // ── Buys / deposits / etc. from the transactions ledger (optional) ─────────
  try {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, trade_date, action, symbol, description, quantity, price, amount, account")
      .eq("user_id", user.id)
      .gte("trade_date", cutoffDate)
      .order("trade_date", { ascending: false });
    if (!error && data) {
      hasLedger = true;
      for (const r of data) {
        const type = LEDGER_ACTIONS[(r.action as string)?.toUpperCase()];
        if (!type) continue; // skip SELL/DIV (covered above) and unknowns
        items.push({
          id: `txn-${r.id}`,
          date: String(r.trade_date).slice(0, 10),
          type,
          symbol: (r.symbol as string | null) ?? null,
          description: (r.description as string | null) ?? type,
          shares: r.quantity != null ? Number(r.quantity) : null,
          price: r.price != null ? Number(r.price) : null,
          amount: Number(r.amount) || 0,
          gross: Math.abs(Number(r.amount) || 0),
          account: (r.account as string | null) ?? null,
        });
      }
    }
  } catch { /* ledger not deployed — buys/deposits simply absent */ }

  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return NextResponse.json({ items, days, hasLedger });
}
