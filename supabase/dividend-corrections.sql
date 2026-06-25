-- ════════════════════════════════════════════════════════════════════════
-- Dividend corrections + manual add support (2026-06-24)
--
-- Extends applied_corporate_actions so individual dividend entries can be
-- corrected (cash↔DRIP flip) or manually added. Changes:
--
--   id              — real UUID primary key (replaces the composite PK) so
--                     rows can be targeted individually by the correction API
--   shares_delta    — shares added during DRIP (0 for cash dividends)
--   cash_delta      — cash credited (0 for DRIP dividends)
--   price_per_share — price used during DRIP reinvestment
--   account         — account name at apply time (for cash reversal when the
--                     holding may no longer exist)
--   is_manual       — true for user-entered dividends; false for cron-applied
--
-- Idempotency: auto-applied rows keep a partial unique index on
-- (holding_id, action_type, effective_date) where is_manual = false.
-- Manual rows have no uniqueness constraint (user may add more than one).
--
-- Additive + idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Add new columns.
alter table applied_corporate_actions
  add column if not exists id              uuid    default gen_random_uuid(),
  add column if not exists shares_delta    numeric not null default 0,
  add column if not exists cash_delta      numeric not null default 0,
  add column if not exists price_per_share numeric,
  add column if not exists account         text,
  add column if not exists is_manual       boolean not null default false;

-- 2. Backfill id for rows that existed before this migration.
update applied_corporate_actions set id = gen_random_uuid() where id is null;

-- 3. Make id non-null and promote to primary key.
alter table applied_corporate_actions alter column id set not null;

-- Drop the old composite primary key (may be named differently across envs).
do $$
declare
  pk_name text;
begin
  select con.conname into pk_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'applied_corporate_actions' and con.contype = 'p';
  if pk_name is not null then
    execute format('alter table applied_corporate_actions drop constraint %I', pk_name);
  end if;
end $$;

alter table applied_corporate_actions add primary key (id);

-- 4. Partial unique index: auto-applied rows remain idempotent.
create unique index if not exists applied_corporate_actions_auto_unique
  on applied_corporate_actions (holding_id, action_type, effective_date)
  where is_manual = false;
