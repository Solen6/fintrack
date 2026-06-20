-- ════════════════════════════════════════════════════════════════════════
-- Dividend history: structured + durable (2026-06-19)
--
-- 1. The applied_corporate_actions ledger only stored a human-readable `detail`
--    string. The Accounts → Dividends view needs structured fields, so add them.
--    Populated by the corporate-actions cron (lib/corporate-actions.ts).
--
--      ticker      — security symbol at the time (durable label)
--      name        — company/fund name at the time (durable label)
--      amount      — total cash value of the dividend event (per-share × shares)
--      reinvested  — true = DRIP bought shares, false = paid to cash
--
-- 2. Dividend history must SURVIVE closing/deleting a position. The original FK
--    was `on delete cascade`, which wiped the ledger when a holding row was
--    deleted (a full close deletes the holding). Drop that FK so the rows
--    persist — holding_id simply becomes an orphaned reference, and the row is
--    fully self-describing via the columns above.
--
-- Additive + idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

alter table applied_corporate_actions
  add column if not exists ticker      text,
  add column if not exists name        text,
  add column if not exists amount      numeric,
  add column if not exists reinvested  boolean;

-- Stop deleting dividend/split history when the underlying holding is removed.
-- Drop whatever FK sits on holding_id, regardless of its generated name.
do $$
declare
  fk_name text;
begin
  for fk_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'applied_corporate_actions'
      and con.contype = 'f'
      and con.conkey = array[
        (select attnum from pg_attribute
          where attrelid = 'applied_corporate_actions'::regclass
            and attname = 'holding_id')
      ]
  loop
    execute format('alter table applied_corporate_actions drop constraint %I', fk_name);
  end loop;
end $$;
