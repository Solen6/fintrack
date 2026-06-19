"use client";

import { useState } from "react";

interface Props {
  existingAccounts: string[];
  /* Current cash balances keyed by account, so editing an account prefills. */
  cashByAccount?: Record<string, { label: string; balance: number }>;
  onSaved: () => void;
  onCancel: () => void;
}

/* Set a cash balance on an account — a flat dollar amount (HYSA, checking,
   brokerage sweep), NOT a priced position. Writes to the cash_balances table
   via /api/cash and tags the account type=cash so the dashboard buckets it.
   Re-submitting for the same account overwrites its balance. */
export function AddCashForm({ existingAccounts, cashByAccount = {}, onSaved, onCancel }: Props) {
  const initialAccount = existingAccounts[0] ?? "";
  const [account, setAccount] = useState(initialAccount);
  const [newAccount, setNewAccount] = useState("");
  const [balance, setBalance] = useState(
    initialAccount && cashByAccount[initialAccount]
      ? String(cashByAccount[initialAccount].balance)
      : "",
  );
  const [label, setLabel] = useState(
    initialAccount && cashByAccount[initialAccount]
      ? cashByAccount[initialAccount].label
      : "Cash",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // When switching account in the picker, prefill from any existing balance.
  const handleAccountChange = (acct: string) => {
    setAccount(acct);
    const existing = cashByAccount[acct];
    if (existing) {
      setBalance(String(existing.balance));
      setLabel(existing.label);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const acct = newAccount.trim() || account;
    const amt = parseFloat(balance);
    if (!acct) {
      setError("Account is required.");
      return;
    }
    if (!Number.isFinite(amt) || amt < 0) {
      setError("Balance must be a non-negative number.");
      return;
    }

    setSaving(true);

    // Tag the account as type=cash so the dashboard buckets it correctly.
    await fetch("/api/accounts/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: acct, type: "cash" }),
    }).catch(() => null);

    const res = await fetch("/api/cash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: acct, balance: amt, label: label.trim() || "Cash" }),
    });

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Failed to save cash balance");
      setSaving(false);
      return;
    }

    setSaving(false);
    onSaved();
  };

  const inputClass =
    "w-full px-3 py-2 text-sm rounded-sm border border-border bg-transparent text-foreground focus:outline-none focus:border-[var(--primary)] font-mono";

  return (
    <div className="flex-1 flex items-start justify-center pt-12 px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4">
        <h2 className="text-lg font-medium text-foreground">Cash Balance</h2>
        <p className="text-xs text-muted-foreground">
          Track a cash balance — HYSA, checking, a brokerage sweep. It counts
          toward your total value and cash allocation, but isn&apos;t a position
          and stays out of the investment-return math. Saving overwrites the
          account&apos;s current balance.
        </p>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Account *</label>
          {existingAccounts.length > 0 ? (
            <select
              className={inputClass}
              value={account}
              onChange={(e) => handleAccountChange(e.target.value)}
            >
              {existingAccounts.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
              <option value="">+ New account</option>
            </select>
          ) : null}
          {(!account || existingAccounts.length === 0) && (
            <input
              className={`${inputClass} mt-1.5`}
              value={newAccount}
              onChange={(e) => setNewAccount(e.target.value)}
              placeholder="HYSA"
            />
          )}
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Cash balance *</label>
          <input
            className={inputClass}
            type="number"
            step="any"
            min="0"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="5000.00"
            autoFocus
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Label</label>
          <input
            className={inputClass}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Cash"
          />
        </div>

        {error && <p className="text-xs" style={{ color: "var(--negative)" }}>{error}</p>}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="text-xs px-4 py-2 rounded-sm font-medium disabled:opacity-50"
            style={{ background: "oklch(0.72 0.14 74)", color: "oklch(0.08 0 0)" }}
          >
            {saving ? "Saving…" : "Save Cash Balance"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs px-3 py-2 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
