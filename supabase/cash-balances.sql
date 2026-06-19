-- ════════════════════════════════════════════════════════════════════════
-- Cash balances — a real cash balance per account (2026-06-18)
--
-- Cash is NOT a position (no ticker, no shares, no live price). It's a flat
-- dollar balance you hold in an account — HYSA, checking, a brokerage sweep.
-- Stored here as a number, separate from `holdings`, so it never appears as a
-- row in the positions table but still counts toward total portfolio value and
-- the cash allocation slice.
--
-- One balance per (user, account); the Add Cash form upserts it. Cash sits in
-- the cash bucket, so it does NOT affect the invested time-weighted return.
-- Idempotent + re-runnable.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists cash_balances (
  user_id    uuid not null references auth.users(id) on delete cascade,
  account    text not null,
  label      text not null default 'Cash',
  balance    numeric not null default 0,
  updated_at timestamptz default now(),
  primary key (user_id, account)
);

alter table cash_balances enable row level security;

drop policy if exists "Users manage own cash" on cash_balances;
create policy "Users manage own cash" on cash_balances for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
