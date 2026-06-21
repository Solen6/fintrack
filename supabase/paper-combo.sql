-- Multi-leg option strategies trade as a single combo in paper trading.
-- All legs of one strategy share a combo_id so they fill, display, and close
-- together, and margin is computed on the strategy as a whole (max loss).
--
-- Additive + idempotent — safe to re-run. No data migration needed (existing
-- single-leg option positions just keep a null combo_id and behave as before).

alter table paper_positions add column if not exists combo_id uuid;
alter table paper_orders    add column if not exists combo_id uuid;

create index if not exists paper_positions_combo_idx on paper_positions(combo_id);
create index if not exists paper_orders_combo_idx    on paper_orders(combo_id);
