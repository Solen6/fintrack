-- Fintrack: paper trading + portfolio history
-- Run once in Supabase Dashboard → SQL Editor.

-- ─── Paper account (one row per user; cash balance) ───
create table paper_accounts (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  cash          numeric not null default 100000,
  starting_cash numeric not null default 100000,
  created_at    timestamptz default now()
);
alter table paper_accounts enable row level security;
create policy "Users manage own paper account"
  on paper_accounts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Paper positions ───
create table paper_positions (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users(id) on delete cascade,
  ticker    text not null,
  name      text not null,
  shares    numeric not null,
  avg_cost  numeric not null,
  unique (user_id, ticker)
);
alter table paper_positions enable row level security;
create policy "Users manage own paper positions"
  on paper_positions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Paper order history ───
create table paper_orders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  ticker     text not null,
  side       text not null check (side in ('BUY','SELL')),
  shares     numeric not null,
  price      numeric not null,
  created_at timestamptz default now()
);
alter table paper_orders enable row level security;
create policy "Users manage own paper orders"
  on paper_orders for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── Daily portfolio snapshots (real holdings, for dashboard history) ───
create table portfolio_snapshots (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  total_value   numeric not null,
  created_at    timestamptz default now(),
  unique (user_id, snapshot_date)
);
alter table portfolio_snapshots enable row level security;
create policy "Users manage own snapshots"
  on portfolio_snapshots for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
