-- Competition results & career records (wins / podiums / played).
--
-- When a competition ends, the cron finalizes it: ranks entries by total return,
-- writes one frozen `competition_results` row per entry (final_rank, return_pct,
-- is_winner), and stamps competitions.finalized_at so it's only scored once.
-- Aggregating these rows per user gives the all-time podium + career standings.
--
-- Idempotent. Requires competitions.sql first.

begin;

alter table competitions add column if not exists finalized_at timestamptz;

create table if not exists competition_results (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  final_rank     int not null,
  return_pct     numeric,
  is_winner      boolean not null default false,    -- final_rank = 1
  finalized_at   timestamptz not null default now()
);
create unique index if not exists competition_results_unique
  on competition_results (competition_id, user_id);
create index if not exists competition_results_user_idx on competition_results (user_id);

alter table competition_results enable row level security;

-- Public read so the podium / career standings work cross-user. There is no
-- user write policy — results are written only by the cron (service-role).
drop policy if exists "Public read results" on competition_results;
create policy "Public read results" on competition_results
  for select using (true);

commit;
