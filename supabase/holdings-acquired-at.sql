-- ════════════════════════════════════════════════════════════════════════
-- Track when a holding was acquired (2026-07-10)
--
-- Lets the daily gain measure a position bought TODAY from its cost basis
-- (your entry price) instead of yesterday's close — which the position was
-- never held through. Without this, a same-day buy shows the stock's move from
-- the prior close (e.g. −1.6%) even though you're up from where you bought it
-- (+0.3%), disagreeing with Fidelity.
--
-- Nullable: existing rows stay null = "predates the app / unknown" and are
-- measured from the market as before. Only holdings first seen going forward
-- get a date, and a same-day check (acquired_at::date == today ET) decides
-- whether to measure from cost.
-- ════════════════════════════════════════════════════════════════════════

alter table holdings add column if not exists acquired_at timestamptz;
