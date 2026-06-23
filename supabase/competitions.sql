-- Competitions, leaderboards & live trade feed for paper trading.
--
-- A competition ENTRY is just a sandboxed paper_accounts row tagged with a
-- competition_id, so the existing engine/cron snapshot + fill it for free. This
-- migration adds:
--   public_profiles     — opt-in display handle (the only cross-user identity)
--   competitions        — a contest (private invite or global), window + rules
--   competition_entries — one per (competition, user); links to the paper account
--                         and carries the cron-computed score (denormalized)
--   paper_accounts.competition_id — tags an account as a competition sandbox
--   public-read RLS      — leaderboard scores + FILLED order feed are world-
--                          readable; positions/cash stay private (owner-only).
--
-- Idempotent: safe to re-run. Follows the repo's drop-then-create policy +
-- "add column if not exists" conventions (CREATE POLICY has no IF NOT EXISTS).

begin;

-- ── paper_accounts: tag competition sandboxes ──────────────────────────────
alter table paper_accounts add column if not exists competition_id uuid;
create index if not exists paper_accounts_competition_idx
  on paper_accounts (competition_id) where competition_id is not null;

-- ── public_profiles: opt-in handle (cross-user identity) ───────────────────
create table if not exists public_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  handle     text not null,
  avatar     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Handles are unique case-insensitively.
create unique index if not exists public_profiles_handle_key
  on public_profiles (lower(handle));

alter table public_profiles enable row level security;

drop policy if exists "Public read profiles" on public_profiles;
create policy "Public read profiles" on public_profiles
  for select using (true);

drop policy if exists "Users insert own profile" on public_profiles;
create policy "Users insert own profile" on public_profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users update own profile" on public_profiles;
create policy "Users update own profile" on public_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── competitions ───────────────────────────────────────────────────────────
create table if not exists competitions (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  description   text,
  scope         text not null default 'private' check (scope in ('private', 'global')),
  invite_code   text,                                  -- private contests only
  starting_cash numeric not null default 100000,
  rules         jsonb not null default '{}'::jsonb,    -- { allowedAssetClasses: [...] }
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  created_at    timestamptz not null default now()
);
create unique index if not exists competitions_invite_code_key
  on competitions (invite_code) where invite_code is not null;
create index if not exists competitions_scope_idx on competitions (scope);

alter table competitions enable row level security;

-- Private competitions must NOT be world-readable. invite_code lives on this row,
-- so a "using (true)" policy would let any signed-in user harvest every private
-- contest's code via a raw PostgREST select and join uninvited. A user may read a
-- competition only if it is global, they created it, or they have joined it. The
-- join-by-code flow (a not-yet-member resolving a private contest) is the one path
-- that must read an unjoined private row; it does so server-side with the
-- service-role client (see /api/competitions ?code= and /api/competitions/[id]/join),
-- which validates the code before exposing anything. Only the creator can mutate.
-- (No recursion risk: competition_entries' SELECT policy does not reference competitions.)
drop policy if exists "Public read competitions" on competitions;
drop policy if exists "Read own, global, or joined competitions" on competitions;
create policy "Read own, global, or joined competitions" on competitions
  for select using (
    scope = 'global'
    or auth.uid() = creator_id
    or id in (
      select competition_id from competition_entries where user_id = auth.uid()
    )
  );

drop policy if exists "Users create competitions" on competitions;
create policy "Users create competitions" on competitions
  for insert with check (auth.uid() = creator_id);

drop policy if exists "Creators update competitions" on competitions;
create policy "Creators update competitions" on competitions
  for update using (auth.uid() = creator_id) with check (auth.uid() = creator_id);

drop policy if exists "Creators delete competitions" on competitions;
create policy "Creators delete competitions" on competitions
  for delete using (auth.uid() = creator_id);

-- ── competition_entries ────────────────────────────────────────────────────
create table if not exists competition_entries (
  id               uuid primary key default gen_random_uuid(),
  competition_id   uuid not null references competitions(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  account_id       uuid not null references paper_accounts(id) on delete cascade,
  joined_at        timestamptz not null default now(),
  -- Denormalized score, recomputed daily by the cron (admin/service-role).
  last_equity      numeric,
  last_return_pct  numeric,
  sharpe           numeric,
  max_drawdown     numeric,
  score_updated_at timestamptz
);
create unique index if not exists competition_entries_unique
  on competition_entries (competition_id, user_id);
create index if not exists competition_entries_comp_idx
  on competition_entries (competition_id);
create index if not exists competition_entries_account_idx
  on competition_entries (account_id);

alter table competition_entries enable row level security;

-- Public read so leaderboards work cross-user. Exposing (user_id, account_id,
-- score) is safe: paper_positions/paper_accounts stay owner-only under their own
-- RLS, so knowing an account_id can't unlock anyone's holdings or cash. Users
-- may only insert/delete their OWN entry; scores are written by the cron
-- (service-role) which bypasses RLS — there is deliberately no user UPDATE
-- policy, so a player can't edit their own score.
drop policy if exists "Public read entries" on competition_entries;
create policy "Public read entries" on competition_entries
  for select using (true);

-- An entry may only be created by its owner AND must point at one of that
-- owner's OWN sandbox accounts tagged with this competition. Without the
-- paper_accounts check, a raw PostgREST insert could attach someone else's
-- account id to a competition and (via the feed policy below) expose their
-- order history.
drop policy if exists "Users join competitions" on competition_entries;
create policy "Users join competitions" on competition_entries
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from paper_accounts a
      where a.id = competition_entries.account_id
        and a.user_id = auth.uid()
        and a.competition_id = competition_entries.competition_id
    )
  );

drop policy if exists "Users leave competitions" on competition_entries;
create policy "Users leave competitions" on competition_entries
  for delete using (auth.uid() = user_id);

-- ── Live trade feed: world-readable FILLED orders for competition accounts ──
-- Adds a permissive SELECT policy ON TOP of "Users manage own paper orders".
-- Scoped to accounts explicitly tagged competition_id (a sandbox) — NOT derived
-- from competition_entries, so it can never be widened to a victim's private
-- account by inserting a crafted entry row. Exposes only FILLED orders, and only
-- the trade summary (symbol/side/qty/price/time) — never cash or positions.
drop policy if exists "Public read competition filled orders" on paper_orders;
create policy "Public read competition filled orders" on paper_orders
  for select using (
    status = 'FILLED'
    and account_id in (select id from paper_accounts where competition_id is not null)
  );

commit;
