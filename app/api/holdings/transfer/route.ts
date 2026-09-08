import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordTransaction } from "@/lib/transactions";
import { normalizeNote } from "@/lib/notes";
import { formatCurrency } from "@/lib/format";

/* POST: move a position between two of the user's own accounts — an IN-KIND
   transfer, the way an ACAT does it. No sale, no realized gain: the position
   keeps its cost basis and its acquisition date.

   Deliberately NOT a sell-then-buy. A sell would realize a gain, reset the
   holding period, and write BUY/SELL rows that the reports read as trading
   activity — none of which happened.

   Scope: stocks, ETFs and bonds (individual bonds and bond funds alike).
   Options/futures are still rejected — they are distinct contracts, and combo
   legs carry payoff math that assumes the legs sit together.

   ── Bonds ────────────────────────────────────────────────────────────────
   A non-ETF bond uses the face-value encoding (supabase/bonds.sql): `shares`
   is FACE VALUE in dollars of par and `cost_basis`/price are the clean price
   / 100. Every formula below is therefore unchanged — face × clean/100 is
   already the market value, and a face-weighted average of clean prices is
   already the blended cost. What does change is IDENTITY: an equity is its
   ticker, but a bond is a specific instrument, so a $10k 2031 Treasury must
   never blend into a 2027 one that happens to share a label. See sameLot(). */

const EPS = 1e-9;
const r2 = (n: number) => Math.round(n * 100) / 100;
const ET_TODAY = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** Columns that define a bond and must travel with the face value on a split. */
const BOND_COLS = [
  "bond_type", "cusip", "coupon_rate", "coupon_freq", "maturity_date",
  "issue_date", "day_count", "price_source", "manual_price", "credit_spread_bps",
] as const;

type Row = Record<string, unknown>;

const kindOf = (r: Row) => (r.instrument_type ?? "equity") as string;
const isEtfBond = (r: Row) => kindOf(r) === "bond" && (r.bond_type ?? "") === "etf";
/** Face-value encoding: shares = par, price = clean/100. Bond ETFs are normal shares. */
const isFaceBond = (r: Row) => kindOf(r) === "bond" && (r.bond_type ?? "") !== "etf";

const num = (v: unknown) => (v == null ? null : Number(v));
const day = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : null);
const cus = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : null);

/**
 * Is `row` the same lot-mergeable instrument as `src`? Both are already known
 * to share a ticker and an account.
 *
 * Equities and bond ETFs: the ticker IS the instrument, so a ticker match is
 * enough (unchanged behaviour). Individual bonds: the ticker is only a label —
 * AddBondForm stores the CUSIP there, but nothing enforces it — so identity is
 * the CUSIP when both rows carry one, and otherwise the terms that actually
 * define the security. Anything short of a full match is left as its own row.
 */
function sameLot(src: Row, row: Row): boolean {
  const a = kindOf(src);
  const b = kindOf(row);
  if (a !== b) return false;
  if (a !== "bond") return true;
  if (isEtfBond(src) !== isEtfBond(row)) return false;
  if (isEtfBond(src)) return true;

  const ca = cus(src.cusip);
  const cb = cus(row.cusip);
  if (ca && cb) return ca === cb; // a CUSIP is the instrument, by definition
  return (
    (src.bond_type ?? null) === (row.bond_type ?? null) &&
    num(src.coupon_rate) === num(row.coupon_rate) &&
    num(src.coupon_freq) === num(row.coupon_freq) &&
    day(src.maturity_date) === day(row.maturity_date)
  );
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id: string = (body.id ?? "").trim();
  const to: string = (body.to ?? "").trim();
  const note = normalizeNote(body.note);
  // Live price from the client, which already holds the quote (or the bond
  // mark) this row is rendered with. Only ever used to VALUE the ledger flow
  // (see below) — never written to the holding — so a stale quote can't
  // corrupt a position. Falls back to cost basis when absent. For a
  // face-value bond this is clean/100, matching `currentPrice` on the client.
  const quoted = Number(body.price);

  if (!id) return NextResponse.json({ error: "Holding id is required" }, { status: 400 });
  if (!to) return NextResponse.json({ error: "Destination account is required" }, { status: 400 });

  const { data: holding, error: readErr } = await supabase
    .from("holdings")
    .select(`id,ticker,name,sector,shares,cost_basis,account,notes,drip,acquired_at,instrument_type,${BOND_COLS.join(",")}`)
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle<Row>();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!holding) return NextResponse.json({ error: "Position not found" }, { status: 404 });

  const kind = kindOf(holding);
  if (kind !== "equity" && kind !== "bond") {
    return NextResponse.json(
      { error: `Only stock, ETF and bond positions can be transferred — ${holding.ticker} is a ${kind}.` },
      { status: 400 },
    );
  }
  const faceBond = isFaceBond(holding);
  const label = String(holding.ticker ?? holding.name ?? "position");
  // Face bonds are measured in dollars of par everywhere the user sees them.
  const qtyText = (n: number) => (faceBond ? `${formatCurrency(n)} face` : `${n} ${label}`);

  const from = String(holding.account ?? "").trim();
  if (from === to) return NextResponse.json({ error: "Pick two different accounts" }, { status: 400 });

  const held = Number(holding.shares) || 0;
  if (held <= 0) {
    return NextResponse.json(
      { error: faceBond ? "This bond has no face value to transfer" : "This position has no shares to transfer" },
      { status: 400 },
    );
  }

  // Omitted `shares` means "move the whole position". For a face bond the
  // wire field still carries the `shares` COLUMN, which is face value.
  const moveShares = body.shares === undefined || body.shares === null || body.shares === ""
    ? held
    : Number(body.shares);
  if (!Number.isFinite(moveShares) || moveShares <= 0) {
    return NextResponse.json(
      { error: faceBond ? "Face value must be a positive number" : "Share count must be a positive number" },
      { status: 400 },
    );
  }
  if (moveShares > held + EPS) {
    return NextResponse.json(
      { error: `Cannot transfer more than the ${qtyText(held)} held in ${from}` },
      { status: 400 },
    );
  }
  const moveAll = moveShares >= held - EPS;
  const perUnit = Number(holding.cost_basis) || 0; // per share, or clean/100 for a face bond
  const remainder = moveAll ? 0 : held - moveShares;

  // Is the destination already holding this instrument? Exactly one matching
  // row merges at a quantity-weighted average cost, the way a broker reports a
  // single blended position — matching /api/holdings/add for equities, and
  // doing for bonds what /api/holdings/add deliberately does not: an add is a
  // new purchase at a new price, but a transfer moves a lot that is already
  // this user's, so refusing to merge would leave the same CUSIP sitting in
  // two rows of one account. Anything ambiguous (two rows for the same
  // instrument) is left alone rather than guessed at.
  const { data: destRows } = await supabase
    .from("holdings")
    .select(`id,shares,cost_basis,acquired_at,instrument_type,${BOND_COLS.join(",")}`)
    .eq("user_id", user.id)
    .eq("ticker", holding.ticker)
    .eq("account", to)
    .returns<Row[]>();
  const destMatches = (destRows ?? []).filter((r) => sameLot(holding, r));
  const mergeTarget = destMatches.length === 1 ? destMatches[0] : null;

  let blendedCost: number | null = null;
  let newRowId: string | null = null;

  if (!mergeTarget && moveAll) {
    // Nothing to merge with and the whole position is moving: just re-point the
    // row. This keeps the SAME holding id, so its dividend/coupon history and
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
    // the source row. For a face bond this is a face-weighted average of clean
    // prices — the same arithmetic, in the bond's own units.
    const prevShares = Number(mergeTarget.shares) || 0;
    const prevCost = Number(mergeTarget.cost_basis) || 0;
    const totalShares = prevShares + moveShares;
    blendedCost = totalShares !== 0
      ? (prevShares * prevCost + moveShares * perUnit) / totalShares
      : perUnit;

    // Keep the EARLIER acquisition date of the two lots. acquired_at gates
    // dividend and coupon entitlement and the long-term/short-term split in the
    // tax-loss harvester, so taking the later one would restart the holding
    // period on a position that has been owned for years.
    const destAcq = (mergeTarget.acquired_at ?? null) as string | null;
    const srcAcq = (holding.acquired_at ?? null) as string | null;
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

    // Source leg. If it fails, undo the merge — otherwise the position would
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
    // Partial move into an account that doesn't hold this instrument: the row
    // has to split. The new row carries the SOURCE's acquired_at, so the moved
    // shares keep their real holding period rather than looking bought today,
    // and every bond term travels with the face value — a bond row without its
    // coupon and maturity is unpriceable.
    const newRow: Record<string, unknown> = {
      user_id: user.id,
      ticker: holding.ticker,
      name: holding.name,
      sector: holding.sector,
      shares: moveShares,
      cost_basis: perUnit,
      account: to,
      notes: holding.notes ?? null,
      drip: holding.drip ?? false,
      instrument_type: kind,
      acquired_at: holding.acquired_at,
      ...(kind === "bond" ? Object.fromEntries(BOND_COLS.map((c) => [c, holding[c] ?? null])) : {}),
    };
    let { data: inserted, error: insErr } = await supabase.from("holdings").insert(newRow).select("id").single();
    if (insErr && /acquired_at/i.test(insErr.message ?? "")) {
      delete newRow.acquired_at; // pre-migration fallback, same as /api/holdings/add
      ({ data: inserted, error: insErr } = await supabase.from("holdings").insert(newRow).select("id").single());
    }
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    newRowId = inserted?.id ?? null;

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

  /* A split bond row inherits the source's coupon claims for today.

     lib/bond-lifecycle.ts floors its catch-up sweep at the row's created_at,
     so a row created NOW is still owed any coupon dated TODAY. If today's
     coupon already paid on the source's full face, the new row would be paid
     it a second time on the face that moved — the sweep dedupes on holding_id,
     and the new id has no markers. Copy the claims across as zero-dollar
     rows: they satisfy the unique index on (holding_id, action_type,
     effective_date) and they suppress the projected coupon in
     lib/income-rows.ts, while adding nothing to income (a coupon always pays
     cash, so amount = 0 is unambiguously a marker, never a payment).

     Only TODAY's coupons can be affected — anything earlier is already before
     the new row's tracked-from date — so this is at most a row or two.
     Redemption needs no equivalent: it deletes the row it pays, so a redeemed
     bond can't be transferred, and two rows that both still exist at maturity
     each correctly redeem their own face. Best-effort: the transfer itself has
     already committed, and a missing marker only risks a duplicate coupon. */
  if (newRowId && faceBond) {
    const today = ET_TODAY();
    const { data: claims } = await supabase
      .from("applied_corporate_actions")
      .select("effective_date,pay_date")
      .eq("holding_id", holding.id)
      .eq("action_type", "coupon")
      .eq("is_manual", false)
      .gte("effective_date", today)
      .returns<{ effective_date: string; pay_date: string | null }[]>();
    for (const c of claims ?? []) {
      await supabase.from("applied_corporate_actions").insert({
        holding_id: newRowId,
        user_id: user.id,
        action_type: "coupon",
        effective_date: c.effective_date,
        pay_date: c.pay_date ?? c.effective_date,
        detail: `Coupon already paid in ${from} before this face value transferred — recorded here so it is not paid twice`,
        ticker: holding.ticker,
        name: holding.name,
        amount: 0,
        reinvested: false,
        shares_delta: 0,
        cash_delta: 0,
        price_per_share: null,
        account: to,
        is_manual: false,
      });
    }
  }

  // Ledger pair. `amount` is what the unit-method return reads as this
  // account's external flow, and the flow has to equal the NAV the transfer
  // moved — which is MARKET value, not cost. Booking cost would leave the
  // unrealized gain behind as a phantom loss on the source and a phantom gain
  // on the destination. No cash actually changes hands, so cash_balances is
  // deliberately untouched.
  const price = Number.isFinite(quoted) && quoted > 0 ? quoted : perUnit;
  const value = r2(moveShares * price);
  const qty = Number(moveShares.toFixed(6));
  // Face bonds omit quantity/price from the ledger for the same reason
  // /api/holdings/add does: the feed would render raw face as a share count
  // and clean/100 as a dollar price. The description carries the real units.
  const moved = faceBond
    ? `${formatCurrency(qty)} face — ${holding.name ?? label} @ ${(price * 100).toFixed(2)}`
    : `${qty} ${label}`;

  await recordTransaction(supabase, user.id, {
    account: from,
    action: "TRANSFER_OUT",
    symbol: String(holding.ticker ?? ""),
    description: note ?? `Transferred ${moved} to ${to}`,
    quantity: faceBond ? null : qty,
    price: faceBond ? null : price,
    amount: -value,
  });
  await recordTransaction(supabase, user.id, {
    account: to,
    action: "TRANSFER_IN",
    symbol: String(holding.ticker ?? ""),
    description: note ?? `Transferred ${moved} from ${from}`,
    quantity: faceBond ? null : qty,
    price: faceBond ? null : price,
    amount: value,
  });

  return NextResponse.json({
    ok: true,
    ticker: holding.ticker,
    shares: qty,
    faceValue: faceBond,
    value,
    from,
    to,
    merged: mergeTarget !== null,
    blendedCost: blendedCost !== null ? Number(blendedCost.toFixed(6)) : null,
  });
}
