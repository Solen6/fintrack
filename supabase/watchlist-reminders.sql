-- ════════════════════════════════════════════════════════════════════════
-- Watchlist + reminders (2026-07-13)
--
-- watchlist: tickers you're WATCHING, not holding. `added_price` is the live
-- price captured the moment you added it — the baseline for "% gain since
-- started watching" — so the figure never mutates as quotes move. One row per
-- (user, ticker); re-adding a removed ticker starts a fresh baseline.
--
-- reminders: free-text dashboard notes ("rebalance Roth", "sell before
-- earnings"). No dates, no recurrence — a checklist, not a scheduler.
--
-- Idempotent + re-runnable.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists watchlist (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  ticker      text not null,
  name        text,
  added_at    timestamptz not null default now(),
  added_price numeric,
  unique (user_id, ticker)
);

alter table watchlist enable row level security;

drop policy if exists "Users manage own watchlist" on watchlist;
create policy "Users manage own watchlist" on watchlist for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists reminders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  text       text not null,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);

alter table reminders enable row level security;

drop policy if exists "Users manage own reminders" on reminders;
create policy "Users manage own reminders" on reminders for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
