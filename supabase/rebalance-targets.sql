-- Saved rebalance target weights (Analysis tab → Rebalancer). One row per
-- user; `targets` is a jsonb map of ticker -> target percent (0-100, not
-- necessarily normalized to sum 100 — the tool normalizes at render time).
-- Idempotent: safe to re-run.

create table if not exists rebalance_targets (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  targets    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table rebalance_targets enable row level security;

drop policy if exists "Users manage own rebalance_targets" on rebalance_targets;
create policy "Users manage own rebalance_targets"
  on rebalance_targets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
