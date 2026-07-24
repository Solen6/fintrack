-- ════════════════════════════════════════════════════════════════════════
-- Calendar feed customization (2026-07-23)
--
-- Three settings that shape what the iCal subscribe feed (/api/calendar/ics)
-- returns. The feed URL is DERIVED (HMAC of user id) and never changes, so
-- editing any of these in-app takes effect on Apple Calendar's next refresh
-- (~hourly) without re-subscribing.
--
--   calendar_feed_prefs   — which event categories sync (Macro/Earnings/…/Custom)
--   calendar_hidden_events — events hidden in Fintrack; excluded from the feed
--                            (this is how a hide in-app "deletes" from Apple)
--   calendar_custom_events — user-added one-off events (e.g. "Fed speaks 8/1").
--                            Category 'Custom' so they sync even when the
--                            user has turned their natural category off.
--
-- Idempotent + re-runnable.
-- ════════════════════════════════════════════════════════════════════════

-- ── Feed category preferences ──────────────────────────────────────────────
-- One row per user. Absent row = feed returns all categories (the pre-feature
-- behavior, so existing subscribers are unaffected until they change anything).
create table if not exists calendar_feed_prefs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  categories text[] not null default array['Macro','Earnings','Dividend','Split','Custom'],
  updated_at timestamptz not null default now()
);

alter table calendar_feed_prefs enable row level security;

drop policy if exists "Users manage own feed prefs" on calendar_feed_prefs;
create policy "Users manage own feed prefs" on calendar_feed_prefs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Hidden events ──────────────────────────────────────────────────────────
-- `event_key` is the stable identity string `${date}|${category}|${title}` —
-- the same key the in-app calendar and the ICS UID are built from. Hiding an
-- event inserts a row here; the feed filters these out on its next fetch.
create table if not exists calendar_hidden_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  event_key  text not null,
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);

alter table calendar_hidden_events enable row level security;

drop policy if exists "Users manage own hidden events" on calendar_hidden_events;
create policy "Users manage own hidden events" on calendar_hidden_events for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Custom (user-added) events ─────────────────────────────────────────────
-- `event_date` (not `date`) to dodge the reserved word. `detail` is the small
-- secondary line shown under the title; may be blank.
create table if not exists calendar_custom_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  event_date date not null,
  title      text not null,
  detail     text not null default '',
  created_at timestamptz not null default now()
);

alter table calendar_custom_events enable row level security;

drop policy if exists "Users manage own custom events" on calendar_custom_events;
create policy "Users manage own custom events" on calendar_custom_events for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists calendar_custom_events_user_date_idx
  on calendar_custom_events (user_id, event_date);
