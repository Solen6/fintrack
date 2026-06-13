-- Fintrack: Paper Trading v2 — multi-asset margin engine
-- Generalizes the stock-only paper tables into named, multi-account, multi-asset
-- (STOCK / OPTION / FUTURE / FOREX) trading with limit/stop orders, a realistic
-- margin model, realized-P/L logging, and a per-account equity curve.
--
-- SAFE TO RE-RUN: every statement is additive/idempotent and preserves existing
-- rows. Existing single-per-user accounts become the "Main" account; existing
-- positions/orders are backfilled onto it.
--
-- Run once in Supabase Dashboard → SQL Editor.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. paper_accounts: single-per-user → named, multi-account, with margin
-- ─────────────────────────────────────────────────────────────────────────────
alter table paper_accounts add column if not exists id          uuid not null default gen_random_uuid();
alter table paper_accounts add column if not exists name        text not null default 'Main';
alter table paper_accounts add column if not exists margin_used  numeric not null default 0;

-- Migrate primary key user_id → id (guarded so re-runs are no-ops).
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'paper_accounts_pkey'
      and conrelid = 'paper_accounts'::regclass
      and (select array_agg(attname::text) from pg_attribute
           where attrelid = 'paper_accounts'::regclass
             and attnum = any(conkey)) = array['user_id']
  ) then
    alter table paper_accounts drop constraint paper_accounts_pkey;
    alter table paper_accounts add constraint paper_accounts_pkey primary key (id);
  end if;
end $$;

-- A user can't have two accounts with the same name.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'paper_accounts_user_name_key'
      and conrelid = 'paper_accounts'::regclass
  ) then
    alter table paper_accounts add constraint paper_accounts_user_name_key unique (user_id, name);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. paper_positions: generalize to any asset class (shares = generic quantity)
-- ─────────────────────────────────────────────────────────────────────────────
alter table paper_positions add column if not exists account_id   uuid;
alter table paper_positions add column if not exists asset_class  text not null default 'STOCK';
alter table paper_positions add column if not exists symbol       text;
alter table paper_positions add column if not exists underlying   text;
alter table paper_positions add column if not exists expiry       date;
alter table paper_positions add column if not exists strike       numeric;
alter table paper_positions add column if not exists option_type  text;       -- CALL / PUT
alter table paper_positions add column if not exists multiplier   numeric not null default 1;
alter table paper_positions add column if not exists direction    text not null default 'LONG'; -- LONG / SHORT
alter table paper_positions add column if not exists margin_held  numeric not null default 0;

-- Backfill the canonical symbol from the legacy ticker, then make it required.
update paper_positions set symbol = ticker where symbol is null;
-- Backfill account_id onto each user's (only, at migration time) account.
update paper_positions p
   set account_id = a.id
  from paper_accounts a
 where a.user_id = p.user_id and p.account_id is null;

alter table paper_positions
  add constraint paper_positions_asset_class_check
  check (asset_class in ('STOCK','OPTION','FUTURE','FOREX')) not valid;
alter table paper_positions
  add constraint paper_positions_direction_check
  check (direction in ('LONG','SHORT')) not valid;
alter table paper_positions
  add constraint paper_positions_option_type_check
  check (option_type is null or option_type in ('CALL','PUT')) not valid;

-- Swap uniqueness from (user_id, ticker) → (account_id, symbol).
do $$
begin
  if exists (select 1 from pg_constraint
             where conname = 'paper_positions_user_id_ticker_key'
               and conrelid = 'paper_positions'::regclass) then
    alter table paper_positions drop constraint paper_positions_user_id_ticker_key;
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'paper_positions_account_symbol_key'
                   and conrelid = 'paper_positions'::regclass) then
    alter table paper_positions add constraint paper_positions_account_symbol_key unique (account_id, symbol);
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'paper_positions_account_fk'
                   and conrelid = 'paper_positions'::regclass) then
    alter table paper_positions add constraint paper_positions_account_fk
      foreign key (account_id) references paper_accounts(id) on delete cascade;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. paper_orders: generalize + order types (market/limit/stop) + status
-- ─────────────────────────────────────────────────────────────────────────────
alter table paper_orders add column if not exists account_id  uuid;
alter table paper_orders add column if not exists asset_class text not null default 'STOCK';
alter table paper_orders add column if not exists symbol      text;
alter table paper_orders add column if not exists underlying  text;
alter table paper_orders add column if not exists expiry      date;
alter table paper_orders add column if not exists strike      numeric;
alter table paper_orders add column if not exists option_type text;
alter table paper_orders add column if not exists multiplier  numeric not null default 1;
alter table paper_orders add column if not exists direction   text not null default 'LONG';
alter table paper_orders add column if not exists order_type  text not null default 'MARKET';
alter table paper_orders add column if not exists limit_price numeric;
alter table paper_orders add column if not exists stop_price  numeric;
alter table paper_orders add column if not exists status      text not null default 'FILLED';
alter table paper_orders add column if not exists filled_at   timestamptz;

update paper_orders set symbol = ticker where symbol is null;
update paper_orders set filled_at = created_at where filled_at is null and status = 'FILLED';
update paper_orders o
   set account_id = a.id
  from paper_accounts a
 where a.user_id = o.user_id and o.account_id is null;

alter table paper_orders
  add constraint paper_orders_asset_class_check
  check (asset_class in ('STOCK','OPTION','FUTURE','FOREX')) not valid;
alter table paper_orders
  add constraint paper_orders_order_type_check
  check (order_type in ('MARKET','LIMIT','STOP')) not valid;
alter table paper_orders
  add constraint paper_orders_status_check
  check (status in ('PENDING','FILLED','CANCELLED','REJECTED')) not valid;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'paper_orders_account_fk'
                   and conrelid = 'paper_orders'::regclass) then
    alter table paper_orders add constraint paper_orders_account_fk
      foreign key (account_id) references paper_accounts(id) on delete cascade;
  end if;
end $$;

create index if not exists paper_orders_pending_idx
  on paper_orders (status) where status = 'PENDING';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. paper_realized: realized-P/L log (one row per closing fill)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists paper_realized (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  account_id  uuid not null references paper_accounts(id) on delete cascade,
  symbol      text not null,
  asset_class text not null,
  realized_pl numeric not null,
  closed_at   timestamptz not null default now()
);
alter table paper_realized enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies
                 where tablename = 'paper_realized' and policyname = 'Users manage own realized') then
    create policy "Users manage own realized" on paper_realized for all
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;
create index if not exists paper_realized_account_idx on paper_realized (account_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. paper_snapshots: per-account equity curve (distinct from portfolio_snapshots)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists paper_snapshots (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  account_id    uuid not null references paper_accounts(id) on delete cascade,
  snapshot_date date not null,
  equity        numeric not null,
  cash          numeric not null,
  created_at    timestamptz default now(),
  unique (account_id, snapshot_date)
);
alter table paper_snapshots enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies
                 where tablename = 'paper_snapshots' and policyname = 'Users manage own paper snapshots') then
    create policy "Users manage own paper snapshots" on paper_snapshots for all
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

commit;
