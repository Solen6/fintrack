import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { recordTransaction } from "@/lib/transactions";
import { OPTION_MULTIPLIER } from "@/lib/contract-specs";

/**
 * POST — record a multi-leg option strategy (iron condor, spread, straddle, …)
 * against a REAL brokerage account. Mirrors /api/paper/combo's shape but writes
 * `holdings` rows: one row per leg, all sharing a minted combo_id, each using
 * the same signed "effective shares" encoding as /api/holdings/add.
 *
 * Stock legs are rejected — the covered-call template's stock leg is tracked
 * as a regular equity position, not here (prevents double-counting shares the
 * user already holds). The client greys those legs out before POSTing.
 */

interface ComboLeg {
  type: "call" | "put";
  side: "long" | "short";
  strike: number;
  expiry: number;  // unix seconds
  qty: number;     // contracts
  premium: number; // per share, always positive
}

const isoFromUnix = (u: number) => new Date(u * 1000).toISOString().slice(0, 10);

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const underlying = String(body.underlying ?? "").trim().toUpperCase();
  const account = String(body.account ?? "").trim();
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  const strategyName = String(body.strategyName ?? "Strategy").slice(0, 60);
  const rawLegs = (body.legs ?? []) as ComboLeg[];

  if (!underlying || !/^[A-Z0-9.^-]{1,12}$/.test(underlying)) {
    return NextResponse.json({ error: "Invalid underlying." }, { status: 400 });
  }
  if (!account) {
    return NextResponse.json({ error: "Account is required." }, { status: 400 });
  }
  if (!Array.isArray(rawLegs) || rawLegs.length === 0) {
    return NextResponse.json({ error: "No legs to record." }, { status: 400 });
  }

  for (const l of rawLegs) {
    if (l.type !== "call" && l.type !== "put") {
      return NextResponse.json({ error: "Each leg must be a call or put (stock legs are tracked as regular positions)." }, { status: 400 });
    }
    if (l.side !== "long" && l.side !== "short") {
      return NextResponse.json({ error: "Each leg needs a side (long/short)." }, { status: 400 });
    }
    if (!Number.isFinite(l.strike) || l.strike <= 0 || !Number.isFinite(l.expiry) || l.expiry <= 0) {
      return NextResponse.json({ error: "Each leg needs a strike and expiry." }, { status: 400 });
    }
    if (!Number.isFinite(l.qty) || l.qty <= 0) {
      return NextResponse.json({ error: "Each leg needs contracts > 0." }, { status: 400 });
    }
    if (!Number.isFinite(l.premium) || l.premium < 0) {
      return NextResponse.json({ error: "Each leg needs a premium ≥ 0." }, { status: 400 });
    }
  }

  const comboId = randomUUID();
  const nowIso = new Date().toISOString();

  const rows = rawLegs.map((l) => {
    const expiryISO = isoFromUnix(l.expiry);
    const optionType = l.type === "call" ? "CALL" : "PUT";
    const direction = l.side === "short" ? "SHORT" : "LONG";
    const effectiveShares = l.qty * OPTION_MULTIPLIER * (direction === "SHORT" ? -1 : 1);
    return {
      user_id: user.id,
      ticker: `${underlying} ${expiryISO} ${l.strike} ${optionType}`,
      name: `${underlying} ${optionType} $${l.strike} exp ${expiryISO}`,
      shares: effectiveShares,
      cost_basis: l.premium,
      account,
      notes,
      acquired_at: nowIso,
      instrument_type: "option",
      sector: "Derivatives",
      underlying,
      expiry: expiryISO,
      strike: l.strike,
      option_type: optionType,
      multiplier: OPTION_MULTIPLIER,
      direction,
      combo_id: comboId,
    };
  });

  const { error } = await supabase.from("holdings").insert(rows);
  if (error) {
    // Pre-migration hint beats a bare 500 (combo_id from holdings-derivatives.sql).
    if (/combo_id|column/i.test(error.message ?? "")) {
      return NextResponse.json({ error: "Run supabase/holdings-derivatives.sql in the SQL Editor first." }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Net cash effect across all legs: long legs pay premium (−), short legs
  // receive it (+) — the signed effectiveShares makes Σ -(shares × premium)
  // come out to the strategy's net debit (−) or credit (+) automatically.
  const netCash = rows.reduce((s, r) => s - r.shares * r.cost_basis, 0);
  const netCashRounded = Math.round(netCash * 100) / 100;
  const debitOrCredit = netCashRounded <= 0 ? "net debit" : "net credit";

  // ONE ledger row for the whole strategy, not one per leg (4 rows per iron
  // condor would spam the activity feed).
  await recordTransaction(supabase, user.id, {
    account,
    action: "BUY",
    symbol: underlying,
    description: `Opened ${strategyName} — ${rawLegs.length} leg${rawLegs.length === 1 ? "" : "s"} ${underlying} (${debitOrCredit} $${Math.abs(netCashRounded).toFixed(2)})`,
    quantity: null,
    price: null,
    amount: netCashRounded,
  });

  // ONE net cash-balance adjustment. Non-fatal if cash_balances isn't
  // migrated yet — the holdings inserts already succeeded.
  const { data: existingCash } = await supabase
    .from("cash_balances")
    .select("balance,label")
    .eq("user_id", user.id)
    .eq("account", account)
    .maybeSingle();

  const newBalance = Math.round((Number(existingCash?.balance ?? 0) + netCashRounded) * 100) / 100;
  await supabase.from("cash_balances").upsert(
    {
      user_id: user.id,
      account,
      label: existingCash?.label ?? "Cash",
      balance: newBalance,
      updated_at: nowIso,
    },
    { onConflict: "user_id,account" },
  );

  return NextResponse.json({ ok: true, comboId, legs: rows.length, netCash: netCashRounded, cashBalance: newBalance });
}
