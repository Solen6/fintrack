import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { priceInstrument } from "@/lib/paper-pricing";
import { multiplierFor } from "@/lib/contract-specs";
import {
  evaluateFills,
  executeFill,
  instrumentName,
  loadAccountState,
  resolveAccount,
} from "@/lib/paper-engine";
import type { AssetClass, InstrumentRef, OptionType, OrderType, Side } from "@/lib/paper-types";

const ASSET_CLASSES: AssetClass[] = ["STOCK", "OPTION", "FUTURE", "FOREX"];
const ORDER_TYPES: OrderType[] = ["MARKET", "LIMIT", "STOP"];

const tablesMissing = (msg: string) =>
  NextResponse.json(
    { error: `Paper account unavailable: ${msg}. Have the v2 Supabase tables been created? (supabase/paper-v2-multi-asset.sql)` },
    { status: 500 }
  );

/* ─── GET: full account state (lazily fills any triggered pending orders) ─── */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Best-effort lazy fill so triggers still work even if the cron is down.
    try { await evaluateFills(supabase, user.id); } catch { /* non-fatal */ }

    const accountId = request.nextUrl.searchParams.get("account");
    const account = await resolveAccount(supabase, user.id, accountId);
    const state = await loadAccountState(supabase, user.id, account);
    return NextResponse.json(state);
  } catch (e) {
    return tablesMissing(e instanceof Error ? e.message : "Unknown error");
  }
}

/* ─── POST: place an order (market fills now; limit/stop rest as PENDING) ─── */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const assetClass = String(body.assetClass ?? "STOCK").toUpperCase() as AssetClass;
  const side = String(body.side ?? "").toUpperCase() as Side;
  const orderType = String(body.orderType ?? "MARKET").toUpperCase() as OrderType;
  const qty = Number(body.qty);

  if (!ASSET_CLASSES.includes(assetClass)) return NextResponse.json({ error: "Invalid asset class." }, { status: 400 });
  if (side !== "BUY" && side !== "SELL") return NextResponse.json({ error: "Side must be BUY or SELL." }, { status: 400 });
  if (!ORDER_TYPES.includes(orderType)) return NextResponse.json({ error: "Invalid order type." }, { status: 400 });
  if (!Number.isFinite(qty) || qty <= 0) return NextResponse.json({ error: "Quantity must be greater than zero." }, { status: 400 });

  // Build the instrument reference.
  let ref: InstrumentRef;
  if (assetClass === "OPTION") {
    const underlying = String(body.underlying ?? "").trim().toUpperCase();
    const expiry = String(body.expiry ?? "").trim();
    const strike = Number(body.strike);
    const optionType = String(body.optionType ?? "").toUpperCase() as OptionType;
    if (!underlying || !/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !Number.isFinite(strike) || (optionType !== "CALL" && optionType !== "PUT")) {
      return NextResponse.json({ error: "Option requires underlying, expiry (YYYY-MM-DD), strike, and CALL/PUT." }, { status: 400 });
    }
    ref = { assetClass, symbol: "", underlying, expiry, strike, optionType };
    ref.symbol = instrumentName(ref);
  } else {
    const symbol = String(body.symbol ?? "").trim().toUpperCase();
    if (!symbol || !/^[A-Z0-9.=^-]{1,12}$/.test(symbol)) {
      return NextResponse.json({ error: "Invalid symbol." }, { status: 400 });
    }
    ref = { assetClass, symbol };
  }

  const limitPrice = body.limitPrice != null ? Number(body.limitPrice) : null;
  const stopPrice = body.stopPrice != null ? Number(body.stopPrice) : null;
  if (orderType === "LIMIT" && (!Number.isFinite(limitPrice!) || limitPrice! <= 0)) {
    return NextResponse.json({ error: "Limit order requires a limit price." }, { status: 400 });
  }
  if (orderType === "STOP" && (!Number.isFinite(stopPrice!) || stopPrice! <= 0)) {
    return NextResponse.json({ error: "Stop order requires a stop price." }, { status: 400 });
  }

  try {
    const account = await resolveAccount(supabase, user.id, body.accountId);
    const direction = side === "BUY" ? "LONG" : "SHORT";
    const multiplier = multiplierFor(assetClass, ref.symbol);

    const orderBase = {
      user_id: user.id,
      account_id: account.id,
      ticker: ref.symbol,        // legacy NOT NULL column — keep it populated
      asset_class: assetClass,
      symbol: ref.symbol,
      underlying: ref.underlying ?? null,
      expiry: ref.expiry ?? null,
      strike: ref.strike ?? null,
      option_type: ref.optionType ?? null,
      side,
      direction,
      shares: qty,
      multiplier,
    };

    if (orderType === "MARKET") {
      const priced = await priceInstrument(ref);
      if (!priced) return NextResponse.json({ error: `No live price for "${ref.symbol}" — check the symbol/contract.` }, { status: 422 });

      let result;
      try {
        result = await executeFill(supabase, account, ref, side, qty, priced.price);
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Order rejected." }, { status: 422 });
      }

      const { data: order, error: orderErr } = await supabase.from("paper_orders").insert({
        ...orderBase,
        order_type: "MARKET",
        status: "FILLED",
        price: priced.price,
        filled_at: new Date().toISOString(),
      }).select().single();
      if (orderErr) throw new Error(orderErr.message);

      return NextResponse.json({
        filled: {
          id: order?.id, symbol: ref.symbol, side, qty, price: priced.price,
          notional: result.notional, realized: result.realized,
        },
      });
    }

    // LIMIT / STOP → rest as PENDING (filled by GET lazy-eval or the cron).
    // `price` is a legacy NOT NULL column; seed it with the trigger price until filled.
    const { data: order, error } = await supabase.from("paper_orders").insert({
      ...orderBase,
      order_type: orderType,
      status: "PENDING",
      price: limitPrice ?? stopPrice ?? 0,
      limit_price: limitPrice,
      stop_price: stopPrice,
    }).select().single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ pending: { id: order.id, symbol: ref.symbol, side, qty, orderType, limitPrice, stopPrice } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
