-- ════════════════════════════════════════════════════════════════════════
-- Singular Event Subscriptions for Calendar Feed (2026-07-26)
--
-- Allows users to subscribe to singular events (e.g., "Fed Rate Decision")
-- even when the event's overall category (e.g., "Macro") is disabled in feed prefs.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists calendar_subscribed_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  event_key  text not null,
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);

alter table calendar_subscribed_events enable row level security;

drop policy if exists "Users manage own subscribed events" on calendar_subscribed_events;
create policy "Users manage own subscribed events" on calendar_subscribed_events for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists calendar_subscribed_events_user_idx
  on calendar_subscribed_events (user_id);
