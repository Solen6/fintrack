-- ════════════════════════════════════════════════════════════════════════════
-- Monthly account reports — cron-generated statement archive (2026-07-01)
-- ════════════════════════════════════════════════════════════════════════════
-- One row per (user, account, month, report type), generated automatically by
-- the daily snapshot cron (service-role) on the first market days after a
-- month closes:
--   · cash_flow — inflows/outflows/net savings rate from the merged activity
--                 sources (transactions ledger + closed_positions + dividends)
--   · portfolio — positions, cost basis, unrealized G/L, sector allocation,
--                 month-end value + monthly return from portfolio_snapshots
--   · tax       — realized gains, dividend/interest income log, fees
--
-- account is the free-text account name used everywhere else; the sentinel
-- '__all__' holds the all-accounts rollup. payload is the full report JSON
-- (self-describing, versioned via its "v" field). Reports are written only by
-- the cron (service-role bypasses RLS) — users can read their own, nothing
-- else. Idempotent + re-runnable.

begin;

create table if not exists monthly_reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  account       text not null,
  period        text not null,  -- 'YYYY-MM'
  report_type   text not null check (report_type in ('cash_flow', 'portfolio', 'tax')),
  payload       jsonb not null default '{}'::jsonb,
  generated_at  timestamptz not null default now()
);

-- The cron's upsert / exactly-once key.
create unique index if not exists monthly_reports_user_acct_period_type_key
  on monthly_reports (user_id, account, period, report_type);

create index if not exists monthly_reports_user_period_idx
  on monthly_reports (user_id, period);

alter table monthly_reports enable row level security;

-- Drop-then-create so the whole script is safely re-runnable (create policy
-- has no "if not exists"; re-running without this errors "policy already exists").
drop policy if exists "Users read own reports" on monthly_reports;
create policy "Users read own reports" on monthly_reports
  for select using (auth.uid() = user_id);
-- There are deliberately no user write policies — reports are written only by
-- the cron via the service-role client, which bypasses RLS.

commit;
