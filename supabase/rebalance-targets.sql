-- Saved rebalance target weights (Analysis tab → Rebalancer). One row per
-- (user, account) — the Rebalancer is sectioned by account, each with its own
-- targets; `targets` is a jsonb map of ticker -> target percent (0-100, not
-- necessarily normalized to sum 100 — the tool normalizes at render time).
-- Idempotent: safe to re-run.

create table if not exists rebalance_targets (
  user_id    uuid not null references auth.users(id) on delete cascade,
  account    text not null default '__all__',
  targets    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, account)
);

-- Idempotent for installs that predate per-account targets (2026-08-01): adds
-- the column, then widens the PK from (user_id) to (user_id, account). Any
-- pre-existing single row lands under the '__all__' bucket and is simply
-- unused by the now-per-account UI — harmless leftover, not worth migrating.
alter table rebalance_targets add column if not exists account text not null default '__all__';
alter table rebalance_targets drop constraint if exists rebalance_targets_pkey;
alter table rebalance_targets add primary key (user_id, account);

alter table rebalance_targets enable row level security;

drop policy if exists "Users manage own rebalance_targets" on rebalance_targets;
create policy "Users manage own rebalance_targets"
  on rebalance_targets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
