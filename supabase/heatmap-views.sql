-- Saved heatmap layouts — the "Auto" (traditional squarified) view is implicit
-- and never stored; this table holds only the user's custom arrangements.
-- `ordering` is a JSON array of holding ids (uuids, plus synthetic ids like
-- `cash-<account>` / `combo-<comboId>`) in the order the user dragged them.
-- Holdings not in the array fall to the end (value-sorted) at render time, and
-- ids that no longer exist are ignored — so a saved view survives buys/sells.
-- Idempotent: safe to re-run.

create table if not exists heatmap_views (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  ordering   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table heatmap_views enable row level security;

drop policy if exists "Users manage own heatmap_views" on heatmap_views;
create policy "Users manage own heatmap_views"
  on heatmap_views for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_heatmap_views_user on heatmap_views(user_id, created_at);
