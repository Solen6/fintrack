-- ════════════════════════════════════════════════════════════════════════
-- Unit-method seed (2026-07-10)
--
-- The unit (share) method needs a FIXED starting point per account so the
-- performance metric is rebalance-proof. We seed it from cost basis the first
-- time an account is seen, then never recompute it — a rebalance changes cost
-- basis but must NOT move the historical return, so the anchor lives here, not
-- in the live holdings.
--
--   seed_units = seed_cost_basis / base_price     (base_price = $10)
--
-- Unit price on any day = NAV / units, and Total Return % = price/base − 1.
-- Deposits/withdrawals adjust units at read time (units += flow / unit_price),
-- so they never distort the return.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists portfolio_seed (
  user_id         uuid not null references auth.users(id) on delete cascade,
  account         text not null,                    -- matches holdings.account
  seed_cost_basis numeric not null,                 -- cost basis when first seeded
  base_price      numeric not null default 10,      -- arbitrary starting unit price
  established_at  timestamptz not null default now(),
  primary key (user_id, account)
);

alter table portfolio_seed enable row level security;

-- Established + read by the user's own session (the snapshot capture runs as the
-- signed-in user), so owner can do everything to their own rows.
drop policy if exists "own portfolio_seed" on portfolio_seed;
create policy "own portfolio_seed" on portfolio_seed
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
