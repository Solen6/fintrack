import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* ─── GET: fetch user's holdings ─── */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("holdings")
    .select("*")
    .eq("user_id", user.id)
    .order("ticker");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ holdings: data ?? [] });
}

/* ─── POST: replace holdings for a specific account ─── */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const accountName: string = body.accountName?.trim();
  const holdings = body.holdings as Array<{
    ticker: string;
    name?: string;
    shares: number;
    cost_basis: number;
    sector?: string;
    notes?: string;
  }>;

  if (!accountName) {
    return NextResponse.json({ error: "Account name is required" }, { status: 400 });
  }
  if (!Array.isArray(holdings) || holdings.length === 0) {
    return NextResponse.json({ error: "No holdings provided" }, { status: 400 });
  }

  // Replace only the EQUITY holdings for this account — other accounts, and any
  // bonds in this account (added via the Add Bond form, never via CSV), are
  // untouched so a CSV re-upload can't wipe fixed income.
  const { error: delErr } = await supabase
    .from("holdings")
    .delete()
    .eq("user_id", user.id)
    .eq("account", accountName)
    .eq("instrument_type", "equity");
  if (delErr) {
    // Pre-migration (bonds.sql not yet run → no instrument_type column). No
    // bonds can exist yet, so a plain per-account delete is safe and avoids
    // leaving duplicate rows behind.
    await supabase.from("holdings").delete().eq("user_id", user.id).eq("account", accountName);
  }

  const rows = holdings.map(h => ({
    user_id:    user.id,
    ticker:     h.ticker.toUpperCase(),
    name:       h.name ?? h.ticker,
    shares:     h.shares,
    cost_basis: h.cost_basis,
    account:    accountName,
    sector:     h.sector ?? null,
    notes:      h.notes ?? null,
  }));

  const { error } = await supabase.from("holdings").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ saved: rows.length });
}

/* ─── PATCH: edit a single holding ─── */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const {
    id, ticker, name, shares, cost_basis, account, notes, drip,
    bond_type, coupon_rate, coupon_freq, maturity_date, issue_date,
    day_count, price_source, manual_price, credit_spread_bps, cusip,
  } = body as {
    id: string;
    ticker?: string;
    name?: string;
    shares?: number;
    cost_basis?: number;
    account?: string;
    notes?: string | null;
    drip?: boolean;
    bond_type?: string;
    coupon_rate?: number | null;
    coupon_freq?: number | null;
    maturity_date?: string | null;
    issue_date?: string | null;
    day_count?: string;
    price_source?: string;
    manual_price?: number | null;
    credit_spread_bps?: number | null;
    cusip?: string | null;
  };

  if (!id) return NextResponse.json({ error: "Holding id is required" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (ticker !== undefined) updates.ticker = ticker.toUpperCase();
  if (name !== undefined) updates.name = name;
  if (shares !== undefined) updates.shares = shares;
  if (cost_basis !== undefined) updates.cost_basis = cost_basis;
  if (account !== undefined) updates.account = account;
  if (notes !== undefined) updates.notes = notes;
  if (drip !== undefined) updates.drip = drip;
  // Bond fields (only sent when editing a fixed-income row).
  if (bond_type !== undefined) updates.bond_type = bond_type;
  if (cusip !== undefined) updates.cusip = cusip;
  if (coupon_rate !== undefined) updates.coupon_rate = coupon_rate;
  if (coupon_freq !== undefined) updates.coupon_freq = coupon_freq;
  if (maturity_date !== undefined) updates.maturity_date = maturity_date;
  if (issue_date !== undefined) updates.issue_date = issue_date;
  if (day_count !== undefined) updates.day_count = day_count;
  if (price_source !== undefined) updates.price_source = price_source;
  if (manual_price !== undefined) updates.manual_price = manual_price;
  if (credit_spread_bps !== undefined) updates.credit_spread_bps = credit_spread_bps;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("holdings")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/* ─── DELETE: remove a single holding by id, or all holdings for an account ─── */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  if (body.account) {
    await supabase.from("holdings").delete().eq("user_id", user.id).eq("account", body.account);
  } else if (body.id) {
    await supabase.from("holdings").delete().eq("id", body.id).eq("user_id", user.id);
  }
  return NextResponse.json({ ok: true });
}
