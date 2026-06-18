-- Closed positions log — records every position close (full or partial)
-- Idempotent: safe to re-run.

create table if not exists closed_positions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  ticker      text not null,
  name        text not null,
  shares      numeric not null,
  cost_basis  numeric not null,
  sale_price  numeric not null,
  realized_gain numeric generated always as ((sale_price - cost_basis) * shares) stored,
  account     text not null,
  closed_at   timestamptz not null default now(),
  notes       text
);

alter table closed_positions enable row level security;

drop policy if exists "Users manage own closed_positions" on closed_positions;
create policy "Users manage own closed_positions"
  on closed_positions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_closed_positions_user on closed_positions(user_id);
create index if not exists idx_closed_positions_ticker on closed_positions(user_id, ticker);
