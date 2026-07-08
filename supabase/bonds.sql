-- ════════════════════════════════════════════════════════════════════════
-- Bonds / fixed income (2026-07-07)
--
-- Bonds reuse the existing `holdings` table via the "face-value trick":
--   • shares       = FACE VALUE held, in dollars of par   (e.g. 10000)
--   • cost_basis   = purchase CLEAN price / 100            (e.g. 97.00 -> 0.97)
--   • currentPrice = live CLEAN price / 100 (joined at read time, not stored)
-- so value = shares*price and costTotal = shares*cost_basis stay correct in
-- dollars and computeMetrics() (lib/types.ts) needs NO change.
--
-- A row is a bond when instrument_type = 'bond'. Bond ETFs keep their real
-- ticker (bond_type = 'etf') and price through the normal /api/quotes pipeline;
-- every other bond_type is priced by /api/bonds/marks from the Treasury curve /
-- par / cost, and is excluded from the equity-only flows (quotes, corporate
-- actions, dividends).
--
-- Additive + idempotent — safe to re-run. Existing rows default to 'equity'.
-- ════════════════════════════════════════════════════════════════════════

alter table holdings
  add column if not exists instrument_type text not null default 'equity'
    check (instrument_type in ('equity', 'bond')),
  -- classification (nullable for equities; a check still allows NULL)
  add column if not exists bond_type text
    check (bond_type in ('treasury', 'cd', 'corporate', 'muni', 'agency', 'etf')),
  add column if not exists cusip text,
  -- annual coupon rate as a percent of par, e.g. 4.25
  add column if not exists coupon_rate numeric,
  -- coupon payments per year (2 = semiannual, 1 = annual, 4 = quarterly, 12 = monthly)
  add column if not exists coupon_freq int default 2,
  add column if not exists maturity_date date,
  add column if not exists issue_date date,
  add column if not exists day_count text default 'actual/actual'
    check (day_count in ('actual/actual', '30/360', 'actual/365')),
  -- how the live mark is derived
  add column if not exists price_source text default 'auto'
    check (price_source in ('auto', 'manual', 'cost', 'curve')),
  -- user-entered clean price override (per 100 of par), used when price_source = 'manual'
  add column if not exists manual_price numeric,
  -- optional yield spread over the Treasury curve for corporate/muni curve pricing (bps)
  add column if not exists credit_spread_bps numeric default 0;

-- Fast lookup of a user's bond rows (marks route, fixed-income view).
create index if not exists holdings_instrument_type_idx
  on holdings (user_id, instrument_type);

-- Preserve a closed bond's nature so realized-history display can format it
-- as a bond (Face / clean price) instead of shares @ per-share price.
alter table closed_positions
  add column if not exists instrument_type text not null default 'equity'
    check (instrument_type in ('equity', 'bond'));
