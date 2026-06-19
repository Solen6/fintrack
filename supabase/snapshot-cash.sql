-- ════════════════════════════════════════════════════════════════════════
-- Add cash to daily snapshots (2026-06-19)
--
-- portfolio_snapshots.total_value stays HOLDINGS-ONLY (so the return/TWR math
-- and the gain-vs-cost-basis line are unaffected). This new `cash` column
-- records the account's cash balance at capture time, so the dashboard's
-- VALUE line can plot holdings + cash (true total) while Return % stays a pure
-- securities figure.
--
-- Historical rows get cash = 0 (we didn't track cash before now) — honest
-- "started tracking cash from here," not a retroactive guess.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

alter table portfolio_snapshots
  add column if not exists cash numeric not null default 0;
