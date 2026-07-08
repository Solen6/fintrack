-- ════════════════════════════════════════════════════════════════════════
-- Add cost_basis to daily snapshots (2026-07-08)
-- ════════════════════════════════════════════════════════════════════════

alter table portfolio_snapshots
  add column if not exists cost_basis numeric not null default 0;
