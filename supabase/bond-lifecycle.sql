-- ════════════════════════════════════════════════════════════════════════
-- Bond lifecycle: coupons + redemptions (2026-08-10)
--
-- Until now a bond's coupons were only ever PROJECTED (the ladder chart in
-- FixedIncomeView reads nextCouponDate/nextCouponAmount off the analytics) and
-- a matured bond sat at par in the portfolio forever. Neither event ever moved
-- cash. lib/bond-lifecycle.ts now applies both for real, reusing the same
-- applied_corporate_actions ledger the dividend/split cron already uses:
--
--   action_type = 'coupon'     — one row per bond per coupon payment date.
--                                effective_date = the payment date; cash_delta
--                                = the coupon. Also mirrored into the
--                                transactions ledger as an INTEREST row so the
--                                monthly/annual reports pick it up as interest
--                                income (dividends come from THIS table, so the
--                                two never double-count — see LEDGER_ACTIONS in
--                                lib/monthly-reports.ts, which skips DIV).
--
--   action_type = 'redemption' — one row per bond at maturity. Principal is
--                                returned to cash and the holding is closed
--                                into closed_positions at par (sale_price =
--                                1.00 under the face-value trick), which is
--                                what carries the realized gain into reports.
--                                Deliberately NOT mirrored into transactions —
--                                closed_positions is already the SELL record.
--
-- The only schema change needed is widening the action_type CHECK, which was
-- written as ('split','dividend') back in corporate-actions.sql. Everything
-- else (id PK, the partial unique index on (holding_id, action_type,
-- effective_date) where is_manual = false, the dropped holding_id FK that lets
-- history outlive a deleted holding) already carries over unchanged — which is
-- exactly why redemption can delete the holding and still keep its audit row.
--
-- No data is created, moved, or destroyed by this script. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- Widen the action_type CHECK. The constraint may be named differently across
-- environments (it was created inline), so find it by the column it guards
-- rather than by name, drop it, and re-add the widened version.
do $$
declare
  ck_name text;
begin
  for ck_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'applied_corporate_actions'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%action_type%'
  loop
    execute format('alter table applied_corporate_actions drop constraint %I', ck_name);
  end loop;
end $$;

alter table applied_corporate_actions
  add constraint applied_corporate_actions_action_type_check
  check (action_type in ('split', 'dividend', 'coupon', 'redemption'));

-- The lifecycle sweep asks "which bonds have a coupon or maturity due?" per
-- run, which is a maturity_date scan over the bond rows. holdings_instrument_type_idx
-- (user_id, instrument_type) from bonds.sql doesn't help a cross-user cron
-- sweep, so index the maturity directly. Partial: equities have no maturity.
create index if not exists holdings_maturity_idx
  on holdings (maturity_date)
  where maturity_date is not null;
