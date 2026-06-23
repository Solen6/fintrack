-- ════════════════════════════════════════════════════════════════════════
-- Transaction ledger — source of truth for account history (2026-06-17)
--
-- Replaces the "holdings snapshot" mental model: every buy/sell/dividend/
-- deposit/withdrawal/fee is one immutable row here. Holdings, cash balance,
-- and the value-over-time chart are all DERIVED by replaying these rows, so a
-- new trade can never desync the history — you just append a row.
--
-- Brokerage-agnostic (broker column + normalized `action`); the Fidelity CSV
-- importer is the first writer, manual entry / other brokers slot in later.
-- Idempotent re-upload: a stable dedupe_hash per row + unique constraint means
-- re-uploading the same export inserts nothing new (on conflict do nothing).
-- ════════════════════════════════════════════════════════════════════════

create table if not exists transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  account         text not null,                       -- matches holdings.account
  broker          text not null default 'fidelity',    -- for multi-broker later
  trade_date      date not null,                        -- Fidelity "Run Date"
  settlement_date date,
  -- normalized action: BUY | SELL | DIV | INTEREST | DEPOSIT | WITHDRAWAL
  --                   | FEE | TRANSFER_IN | TRANSFER_OUT | OTHER
  action          text not null,
  symbol          text,                                 -- null for pure-cash actions
  description     text,
  quantity        numeric,                              -- shares, positive
  price           numeric,                              -- per share
  -- signed cash impact on the account: buys negative, sells/divs/deposits positive
  amount          numeric not null default 0,
  fees            numeric not null default 0,
  raw             jsonb,                                -- original CSV row, for audit/debug
  -- sha-ish fingerprint of the source row → idempotent re-upload
  dedupe_hash     text not null,
  created_at      timestamptz default now(),
  unique (user_id, dedupe_hash)
);

-- Running account cash balance after the transaction (Fidelity's own figure).
-- Lets the derivation engine read cash at any past date directly instead of
-- guessing an opening balance. Added separately so the script stays re-runnable.
alter table transactions add column if not exists cash_balance numeric;

create index if not exists transactions_user_acct_date_idx
  on transactions (user_id, account, trade_date);

alter table transactions enable row level security;
-- Drop-then-create so the whole script is safely re-runnable (create policy has
-- no "if not exists"; re-running without this errors "policy already exists").
drop policy if exists "Users manage own transactions" on transactions;
create policy "Users manage own transactions"
  on transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
