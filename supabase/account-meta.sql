-- ════════════════════════════════════════════════════════════════════════
-- Account metadata — per-account TYPE (2026-06-17)
--
-- Accounts are otherwise just a free-text `account` name on holdings/
-- transactions. This table tags each account with a normalized type so the
-- dashboard can group/filter by Brokerage · Retirement · Cash instead of
-- guessing "cash-like" from the account name. One row per (user, account).
--
-- type ∈ {brokerage, retirement, cash}. brokerage + retirement = invested;
-- cash = cash-like (HYSA / checking / sweep). Idempotent + re-runnable.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists account_meta (
  user_id    uuid not null references auth.users(id) on delete cascade,
  account    text not null,
  type       text not null default 'brokerage',  -- brokerage | retirement | cash
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, account)
);

alter table account_meta enable row level security;

-- Drop-then-create so the script is safely re-runnable (create policy has no
-- "if not exists"; re-running without this errors "policy already exists").
drop policy if exists "Users manage own account_meta" on account_meta;
create policy "Users manage own account_meta"
  on account_meta for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
