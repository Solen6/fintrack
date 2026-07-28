-- Saved custom portfolios plotted on the efficient-frontier chart
-- (Analysis tab → Portfolio Optimization). One row per portfolio per user;
-- `weights` is a jsonb map of ticker -> percent (0-100, not necessarily
-- normalized — the tool normalizes before plotting).
-- Idempotent: safe to re-run.

create table if not exists optimizer_portfolios (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  weights    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists optimizer_portfolios_user_idx
  on optimizer_portfolios (user_id, created_at);

alter table optimizer_portfolios enable row level security;

drop policy if exists "Users manage own optimizer_portfolios" on optimizer_portfolios;
create policy "Users manage own optimizer_portfolios"
  on optimizer_portfolios for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
