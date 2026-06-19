-- ════════════════════════════════════════════════════════════════════════
-- Corporate actions: auto-apply splits / consolidations / dividends (2026-06-19)
--
-- A daily cron reads splits + dividends effective "today" and updates the
-- underlying holding:
--   • Split (ratio R>1)        → shares × R,  cost_basis ÷ R   (total cost kept)
--   • Consolidation (R<1)      → shares × R,  cost_basis ÷ R   (reverse split)
--   • Dividend, DRIP holding   → buy shares at ex-date price, recompute avg cost
--   • Dividend, cash holding   → credit dividend × shares to the cash balance
--
-- Two pieces of state:
--   1. holdings.drip — per-position preference (false = pay to cash, the
--      brokerage default; true = reinvest).
--   2. applied_corporate_actions — idempotency ledger so a given action is
--      applied to a given holding exactly once (cron may run repeatedly).
-- Idempotent + re-runnable.
-- ════════════════════════════════════════════════════════════════════════

alter table holdings
  add column if not exists drip boolean not null default false;

create table if not exists applied_corporate_actions (
  holding_id     uuid not null references holdings(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  action_type    text not null check (action_type in ('split','dividend')),
  effective_date date not null,
  -- audit trail
  detail         text,
  applied_at     timestamptz default now(),
  primary key (holding_id, action_type, effective_date)
);

create index if not exists applied_corporate_actions_user_idx
  on applied_corporate_actions (user_id);

alter table applied_corporate_actions enable row level security;

drop policy if exists "Users read own corporate actions" on applied_corporate_actions;
create policy "Users read own corporate actions" on applied_corporate_actions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
