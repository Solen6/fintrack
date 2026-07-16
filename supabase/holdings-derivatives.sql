-- ════════════════════════════════════════════════════════════════════════
-- Options & futures on real brokerage accounts (2026-07-16)
--
-- Reuses the `holdings` table via the same "effective shares" trick bonds
-- already use (see supabase/bonds.sql):
--   • shares       = contracts × multiplier × (direction = 'SHORT' ? -1 : 1)
--   • cost_basis   = entry price PER UNIT, always positive (premium per
--                    share for options; price per point for futures)
--   • currentPrice = live price per unit, same convention
-- so value = shares*price, costTotal = shares*cost_basis, and
-- gain = shares*(price-cost_basis) all stay correct — including sign — for
-- both long and short, with NO change to computeMetrics() (lib/types.ts).
-- A short's costTotal comes out negative, which correctly represents a
-- credit/premium received rather than a cost paid.
--
-- Column names/semantics are copied verbatim from paper_positions
-- (supabase/paper-v2-multi-asset.sql) so lib/contract-specs.ts and
-- lib/options-math.ts work unmodified against real holdings.
--
-- A row is a derivative when instrument_type in ('option','future').
-- Additive + idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

alter table holdings
  add column if not exists underlying  text,
  add column if not exists expiry      date,
  add column if not exists strike      numeric,
  add column if not exists option_type text
    check (option_type is null or option_type in ('CALL', 'PUT')),
  add column if not exists multiplier  numeric not null default 1,
  add column if not exists direction   text not null default 'LONG'
    check (direction in ('LONG', 'SHORT'));

-- Widen the instrument_type check (originally 'equity'/'bond' from bonds.sql)
-- to also allow 'option'/'future'. Check constraints can't be altered in
-- place, so find whatever it's actually named and replace it.
do $$
declare
  conname text;
begin
  select c.conname into conname
  from pg_constraint c
  where c.conrelid = 'holdings'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%instrument_type%';
  if conname is not null then
    execute format('alter table holdings drop constraint %I', conname);
  end if;
end $$;

alter table holdings add constraint holdings_instrument_type_check
  check (instrument_type in ('equity', 'bond', 'option', 'future'));

-- closed_positions needs the same widening, plus the fields required to
-- unwind a closed derivative's display (contracts = shares / multiplier,
-- direction, and enough of the contract identity for a readable label).
-- Bonds didn't need this — the face-value trick alone was self-describing.
alter table closed_positions
  add column if not exists underlying  text,
  add column if not exists expiry      date,
  add column if not exists strike      numeric,
  add column if not exists option_type text
    check (option_type is null or option_type in ('CALL', 'PUT')),
  add column if not exists multiplier  numeric not null default 1,
  add column if not exists direction   text not null default 'LONG'
    check (direction in ('LONG', 'SHORT'));

do $$
declare
  conname text;
begin
  select c.conname into conname
  from pg_constraint c
  where c.conrelid = 'closed_positions'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%instrument_type%';
  if conname is not null then
    execute format('alter table closed_positions drop constraint %I', conname);
  end if;
end $$;

alter table closed_positions add constraint closed_positions_instrument_type_check
  check (instrument_type in ('equity', 'bond', 'option', 'future'));

-- ── Multi-leg strategies (iron condor, spreads, straddles, …) ──────────────
-- Legs of one strategy share a combo_id, exactly like paper_positions
-- (supabase/paper-combo.sql). Single-leg positions keep combo_id null.
alter table holdings add column if not exists combo_id uuid;
create index if not exists holdings_combo_idx
  on holdings (combo_id) where combo_id is not null;

alter table closed_positions add column if not exists combo_id uuid;
