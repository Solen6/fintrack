-- Fintrack: per-account daily snapshots
-- Adds an `account` column so each day captures one row per account, enabling
-- per-account performance lines on the dashboard chart. Legacy rows (account
-- IS NULL) represent the pre-split combined total; they continue to display
-- in the "all accounts" view but cannot be filtered to a single account.
--
-- SAFE TO RE-RUN.

begin;

alter table portfolio_snapshots
  add column if not exists account text;

-- Replace the (user_id, snapshot_date) unique constraint with one that includes
-- account so we can store one row per (user, day, account). PostgreSQL treats
-- NULLs as distinct, so legacy NULL-account rows don't conflict with the new
-- per-account rows captured going forward.
alter table portfolio_snapshots
  drop constraint if exists portfolio_snapshots_user_id_snapshot_date_key;

alter table portfolio_snapshots
  drop constraint if exists portfolio_snapshots_user_date_account_key;

alter table portfolio_snapshots
  add constraint portfolio_snapshots_user_date_account_key
  unique (user_id, snapshot_date, account);

commit;
