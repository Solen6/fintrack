import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordTransaction } from "@/lib/transactions";
import { normalizeNote } from "@/lib/notes";

/* POST: move shares of a position between two of the user's own accounts —
   an IN-KIND transfer, the way an ACAT does it. No sale, no realized gain:
   the shares keep their cost basis and their acquisition date.

   Deliberately NOT a sell-then-buy. A sell would realize a gain, reset the
   holding period, and write BUY/SELL rows that the reports read as trading
   activity — none of which happened.

   Scope: stocks and ETFs. Bonds (CUSIP/coupon/maturity-specific) and
   options/futures (distinct contracts, and combo legs whose payoff math
   assumes the legs sit together) are rejected rather than half-handled. */

const EPS = 1e-9;
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id: string = (body.id ?? "").trim();
  const to: string = (body.to ?? "").trim();
  const note = normalizeNote(body.note);
  // Live price from the client, which already holds the quote this row is
  // rendered with. Only ever used to VALUE the ledger flow (see below) — never
  // written to the holding — so a stale quote can't corrupt a position. Falls
  // back to cost basis when absent.
  const quoted = Number(body.price);

  if (!id) return NextResponse.json({ error: "Holding id is required" }, { status: 400 });
  if (!to) return NextResponse.json({ error: "Destination account is required" }, { status: 400 });

  const { data: holding, error: readErr } = await supabase
    .from("holdings")
    .select("id,ticker,name,sector,shares,cost_basis,account,notes,drip,acquired_at,instrument_type")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!holding) return NextResponse.json({ error: "Position not found" }, { status: 404 });

  const kind = (holding.instrument_type ?? "equity") as string;
  if (kind !== "equity") {
    return NextResponse.json(
      { error: `Only stock and ETF positions can be transferred — ${holding.ticker} is ${kind === "bond" ? "a bond" : `a ${kind}`}.` },
      { status: 400 },
    );
  }

  const from = (holding.account ?? "").trim();
  if (from === to) return NextResponse.json({ error: "Pick two different accounts" }, { status: 400 });

  const held = Number(holding.shares) || 0;
  if (held <= 0) return NextResponse.json({ error: "This position has no shares to transfer" }, { status: 400 });

  // Omitted `shares` means "move the whole position".
  const moveShares = body.shares === undefined || body.shares === null || body.shares === ""
    ? held
    : Number(body.shares);
  if (!Number.isFinite(moveShares) || moveShares <= 0) {
    return NextResponse.json({ error: "Share count must be a positive number" }, { status: 400 });
  }
  if (moveShares > held + EPS) {
    return NextResponse.json(
      { error: `Cannot transfer more than the ${held} ${holding.ticker} shares held in ${from}` },
      { status: 400 },
    );
  }
  const moveAll = moveShares >= held - EPS;
  const perShare = Number(holding.cost_basis) || 0;
  const remainder = moveAll ? 0 : held - moveShares;

  // Is the destination already holding this ticker? Exactly one equity row
  // merges at a share-weighted average cost, the way a broker reports a single
  // blended position — matching /api/holdings/add. Anything ambiguous (two
  // rows for the same ticker) is left alone rather than guessed at.
  const { data: destRows } = await supabase
    .from("holdings")
    .select("id,shares,cost_basis,acquired_at,instrument_type")
    .eq("user_id", user.id)
    .eq("ticker", holding.ticker)
    .eq("account", to);
  const destMatches = (destRows ?? []).filter((r) => (r.instrument_type ?? "equity") === "equity");
  const mergeTarget = destMatches.length === 1 ? destMatches[0] : null;

  let blendedCost: number | null = null;

  if (!mergeTarget && moveAll) {
    // Nothing to merge with and the whole position is moving: just re-point the
    // row. This keeps the SAME holding id, so its dividend/split history and
    // its idempotency markers travel with it untouched — no split, no re-credit
    // risk, and nothing to roll back.
    const { error } = await supabase
      .from("holdings")
      .update({ account: to })
      .eq("id", holding.id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (mergeTarget) {
    // Fold into the destination row at a blended cost, then shrink (or clear)
    // the source row.
    const prevShares = Number(mergeTarget.shares) || 0;
    const prevCost = Number(mergeTarget.cost_basis) || 0;
    const totalShares = prevShares + moveShares;
    blendedCost = totalShares !== 0
      ? (prevShares * prevCost + moveShares * perShare) / totalShares
      : perShare;

    // Keep the EARLIER acquisition date of the two lots. acquired_at gates
    // dividend entitlement and the long-term/short-term split in the tax-loss
    // harvester, so taking the later one would restart the holding period on
    // shares that have been owned for years.
    const destAcq = mergeTarget.acquired_at as string | null;
    const srcAcq = holding.acquired_at as string | null;
    const keptAcq = !destAcq || !srcAcq ? null : (srcAcq < destAcq ? srcAcq : destAcq);

    const { error: mergeErr } = await supabase
      .from("holdings")
      .update({
        shares: totalShares,
        cost_basis: blendedCost,
        ...(keptAcq !== destAcq ? { acquired_at: keptAcq } : {}),
      })
      .eq("id", mergeTarget.id)
      .eq("user_id", user.id);
    if (mergeErr) return NextResponse.json({ error: mergeErr.message }, { status: 500 });

    // Source leg. If it fails, undo the merge — otherwise the shares would
    // exist in both accounts at once.
    const { error: srcErr } = moveAll
      ? await supabase.from("holdings").delete().eq("id", holding.id).eq("user_id", user.id)
      : await supabase.from("holdings").update({ shares: remainder }).eq("id", holding.id).eq("user_id", user.id);
    if (srcErr) {
      await supabase
        .from("holdings")
        .update({ shares: prevShares, cost_basis: prevCost, acquired_at: destAcq })
        .eq("id", mergeTarget.id)
        .eq("user_id", user.id);
      return NextResponse.json(
        { error: `Transfer failed while updating ${from} — nothing was moved. Please retry.` },
        { status: 500 },
      );
    }
  } else {
    // Partial move into an account that doesn't hold this ticker: the row has
    // to split. The new row carries the SOURCE's acquired_at, so the moved
    // shares keep their real holding period rather than looking bought today.
    const newRow: Record<string, unknown> = {
      user_id: user.id,
      ticker: holding.ticker,
      name: holding.name,
      sector: holding.sector,
      shares: moveShares,
      cost_basis: perShare,
      account: to,
      notes: holding.notes ?? null,
      drip: holding.drip ?? false,
      instrument_type: "equity",
      acquired_at: holding.acquired_at,
    };
    let { data: inserted, error: insErr } = await supabase.from("holdings").insert(newRow).select("id").single();
    if (insErr && /acquired_at/i.test(insErr.message ?? "")) {
      delete newRow.acquired_at; // pre-migration fallback, same as /api/holdings/add
      ({ data: inserted, error: insErr } = await supabase.from("holdings").insert(newRow).select("id").single());
    }
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    const { error: srcErr } = await supabase
      .from("holdings")
      .update({ shares: remainder })
      .eq("id", holding.id)
      .eq("user_id", user.id);
    if (srcErr) {
      if (inserted?.id) await supabase.from("holdings").delete().eq("id", inserted.id).eq("user_id", user.id);
      return NextResponse.json(
        { error: `Transfer failed while updating ${from} — nothing was moved. Please retry.` },
        { status: 500 },
      );
    }
  }

  // Ledger pair. `amount` is what the unit-method return reads as this
  // account's external flow, and the flow has to equal the NAV the transfer
  // moved — which is MARKET value, not cost. Booking cost would leave the
  // unrealized gain behind as a phantom loss on the source and a phantom gain
  // on the destination. No cash actually changes hands, so cash_balances is
  // deliberately untouched.
  const price = Number.isFinite(quoted) && quoted > 0 ? quoted : perShare;
  const value = r2(moveShares * price);
  const qty = Number(moveShares.toFixed(6));

  await recordTransaction(supabase, user.id, {
    account: from,
    action: "TRANSFER_OUT",
    symbol: holding.ticker,
    description: note ?? `Transferred ${qty} ${holding.ticker} to ${to}`,
    quantity: qty,
    price,
    amount: -value,
  });
  await recordTransaction(supabase, user.id, {
    account: to,
    action: "TRANSFER_IN",
    symbol: holding.ticker,
    description: note ?? `Transferred ${qty} ${holding.ticker} from ${from}`,
    quantity: qty,
    price,
    amount: value,
  });

  return NextResponse.json({
    ok: true,
    ticker: holding.ticker,
    shares: qty,
    value,
    from,
    to,
    merged: mergeTarget !== null,
    blendedCost: blendedCost !== null ? Number(blendedCost.toFixed(6)) : null,
  });
}
