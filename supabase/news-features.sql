-- Idempotent migration for news custom sources + article interactions

-- news_sources: user-configured RSS feeds
create table if not exists news_sources (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  url        text not null,
  enabled    boolean not null default true,
  created_at timestamptz default now()
);
alter table news_sources enable row level security;
drop policy if exists "users_own_sources" on news_sources;
create policy "users_own_sources" on news_sources
  for all using (auth.uid() = user_id);

-- news_interactions: per-article read/saved/deleted state (separate booleans)
create table if not exists news_interactions (
  user_id     uuid not null references auth.users(id) on delete cascade,
  article_url text not null,
  is_read     boolean not null default false,
  is_saved    boolean not null default false,
  is_deleted  boolean not null default false,
  updated_at  timestamptz default now(),
  primary key (user_id, article_url)
);
alter table news_interactions enable row level security;
drop policy if exists "users_own_interactions" on news_interactions;
create policy "users_own_interactions" on news_interactions
  for all using (auth.uid() = user_id);

-- news_builtin_prefs: enable/disable state for built-in providers (finnhub, alphavantage)
-- A row exists only when the user has changed it from the default (enabled).
create table if not exists news_builtin_prefs (
  user_id    uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  enabled    boolean not null default true,
  updated_at timestamptz default now(),
  primary key (user_id, source_key)
);
alter table news_builtin_prefs enable row level security;
drop policy if exists "users_own_builtin_prefs" on news_builtin_prefs;
create policy "users_own_builtin_prefs" on news_builtin_prefs
  for all using (auth.uid() = user_id);
