-- Yearly snapshots of the user's portfolio composition, plotted on the
-- efficient-frontier chart (Analysis tab → Portfolio Optimization) so this
-- year's mix can be compared against previous years'.
--
-- One row per capture; the API only writes a new one when the newest existing
-- row is at least 365 days old. `weights` is a jsonb map of ticker -> percent
-- of the risky sleeve at capture time.
-- Idempotent: safe to re-run.

create table if not exists portfolio_frontier_snapshots (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  taken_on    date not null default (now() at time zone 'utc')::date,
  weights     jsonb not null default '{}'::jsonb,
  total_value numeric,
  created_at  timestamptz not null default now()
);

-- One capture per user per day is the hard floor; the 365-day rule is enforced
-- in the API. This index also serves the "newest first" listing.
create unique index if not exists portfolio_frontier_snapshots_user_day
  on portfolio_frontier_snapshots (user_id, taken_on);

alter table portfolio_frontier_snapshots enable row level security;

drop policy if exists "Users manage own portfolio_frontier_snapshots" on portfolio_frontier_snapshots;
create policy "Users manage own portfolio_frontier_snapshots"
  on portfolio_frontier_snapshots for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
