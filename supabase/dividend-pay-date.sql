-- ════════════════════════════════════════════════════════════════════════
-- Dividend pay dates (2026-08-03)
--
-- `effective_date` on a dividend row is the EX-date — the ownership deadline.
-- It is NOT when the money arrives: TXN went ex 2026-07-31 and pays 2026-08-11.
-- Recording income on the ex-date made a dividend count before it was paid.
--
-- Adds the pay date so the income view can key on "when the cash actually
-- lands" and hold everything else in a Pending state.
--
--   pay_date — the dividend's payable date. NULL = unknown, which is the
--              normal case for ETFs: Yahoo quoteSummary carries no forward
--              distribution data for them, and Finnhub's /stock/dividend2
--              (which does carry payDate) is a premium endpoint that 403s on
--              the free tier. Populated going forward by the corporate-actions
--              cron, and for current dividends by
--              scratchpad/backfill-pay-dates.ts.
--
-- Purely additive: no existing column changes meaning, and no cash or share
-- movement is affected by this script. Idempotent + re-runnable.
-- ════════════════════════════════════════════════════════════════════════

alter table applied_corporate_actions
  add column if not exists pay_date date;

-- The income view filters "paid so far" by pay_date, per user+action_type.
create index if not exists applied_corporate_actions_pay_date_idx
  on applied_corporate_actions (user_id, action_type, pay_date);
