import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { multiplierFor } from "@/lib/contract-specs";
import {
  closeCombo,
  instrumentName,
  openCombo,
  resolveAccount,
  type ComboLegInput,
} from "@/lib/paper-engine";
import type { InstrumentRef, OptionType, Side } from "@/lib/paper-types";

/* Shape of a leg sent from the strategy builder (options-math Leg). */
interface BuilderLeg {
  type: "call" | "put" | "stock";
  side: "long" | "short";
  strike: number;
  qty: number;
  expiry: number;  // unix seconds (ignored for stock)
}

const isoFromUnix = (u: number) => new Date(u * 1000).toISOString().slice(0, 10);

/* ─── POST: open a multi-leg strategy as one combo ─── */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const underlying = String(body.underlying ?? "").trim().toUpperCase();
  const rawLegs = (body.legs ?? []) as BuilderLeg[];
  const strategyName = String(body.strategyName ?? "Custom").slice(0, 60);

  if (!underlying || !/^[A-Z0-9.=^-]{1,12}$/.test(underlying)) {
    return NextResponse.json({ error: "Invalid underlying." }, { status: 400 });
  }
  if (!Array.isArray(rawLegs) || rawLegs.length === 0) {
    return NextResponse.json({ error: "No legs to trade." }, { status: 400 });
  }

  // Build instrument refs from the builder legs.
  const legInputs: ComboLegInput[] = [];
  for (const l of rawLegs) {
    const qty = Math.max(1, Math.round(Number(l.qty) || 1));
    const side: Side = l.side === "short" ? "SELL" : "BUY";
    if (l.type === "stock") {
      const ref: InstrumentRef = { assetClass: "STOCK", symbol: underlying };
      legInputs.push({ ref, side, qty });
      continue;
    }
    if (l.type !== "call" && l.type !== "put") {
      return NextResponse.json({ error: "Each option leg must be a call or put." }, { status: 400 });
    }
    if (!Number.isFinite(l.strike) || !Number.isFinite(l.expiry)) {
      return NextResponse.json({ error: "Each option leg needs a strike and expiry." }, { status: 400 });
    }
    const optionType: OptionType = l.type === "call" ? "CALL" : "PUT";
    const ref: InstrumentRef = {
      assetClass: "OPTION",
      symbol: "",
      underlying,
      expiry: isoFromUnix(l.expiry),
      strike: l.strike,
      optionType,
    };
    ref.symbol = instrumentName(ref);
    legInputs.push({ ref, side, qty });
  }

  try {
    const account = await resolveAccount(supabase, user.id, body.accountId);
    const comboId = randomUUID();
    const result = await openCombo(supabase, account, legInputs, comboId);

    // Record one FILLED order per leg for the history, tagged with the combo.
    const filledAt = new Date().toISOString();
    const orderRows = legInputs.map((leg, i) => ({
      user_id: user.id,
      account_id: account.id,
      combo_id: comboId,
      ticker: leg.ref.symbol,
      asset_class: leg.ref.assetClass,
      symbol: leg.ref.symbol,
      underlying: leg.ref.underlying ?? null,
      expiry: leg.ref.expiry ?? null,
      strike: leg.ref.strike ?? null,
      option_type: leg.ref.optionType ?? null,
      side: leg.side,
      direction: leg.side === "BUY" ? "LONG" : "SHORT",
      shares: leg.qty,
      multiplier: multiplierFor(leg.ref.assetClass, leg.ref.symbol),
      order_type: "MARKET",
      status: "FILLED",
      price: result.legs[i]?.price ?? 0,
      filled_at: filledAt,
    }));
    await supabase.from("paper_orders").insert(orderRows);

    return NextResponse.json({
      combo: {
        id: comboId,
        strategy: strategyName,
        legs: result.legs.length,
        margin: result.margin,
        netCost: result.netCost,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Order rejected." }, { status: 422 });
  }
}

/* ─── DELETE: close every leg of a combo ─── */
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const comboId = request.nextUrl.searchParams.get("comboId");
  if (!comboId) return NextResponse.json({ error: "comboId is required." }, { status: 400 });

  try {
    const result = await closeCombo(supabase, user.id, comboId);
    return NextResponse.json({ closed: result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Close failed." }, { status: 500 });
  }
}
