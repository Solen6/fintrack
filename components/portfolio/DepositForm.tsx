"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";

interface Props {
  existingAccounts: string[];
  cashByAccount?: Record<string, { label: string; balance: number }>;
  onSaved: () => void;
  onCancel: () => void;
}

/* Deposit cash into an account — ADDS to the existing balance (vs. "Add cash",
   which sets an absolute balance) and logs a DEPOSIT in the activity feed.
   Never changes the account's type. */
export function DepositForm({ existingAccounts, cashByAccount = {}, onSaved, onCancel }: Props) {
  const initialAccount = existingAccounts[0] ?? "";
  const [account, setAccount] = useState(initialAccount);
  const [newAccount, setNewAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("Cash");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const acct = newAccount.trim() || account;
  // Show the name input when the "+ New account" sentinel (account === "") is
  // picked, or when there are no accounts yet. Mirrors AddCashForm.
  const showNew = !account || existingAccounts.length === 0;
  const current = acct && cashByAccount[acct] ? cashByAccount[acct].balance : 0;
  const amt = parseFloat(amount);
  const projected = Number.isFinite(amt) && amt > 0 ? current + amt : current;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!acct) { setError("Account is required."); return; }
    if (!Number.isFinite(amt) || amt <= 0) { setError("Deposit amount must be a positive number."); return; }

    setSaving(true);
    const res = await fetch("/api/cash/deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: acct, amount: amt, label: showNew ? label.trim() || "Cash" : undefined }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Failed to record deposit");
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
        <h2 className="text-lg font-medium text-foreground">Deposit Cash</h2>
        <p className="text-xs text-muted-foreground">
          Add money to an account&apos;s cash balance. This increases the balance
          and records a deposit in your 30-day activity — it does not change the
          account&apos;s type.
        </p>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Account *</label>
          {existingAccounts.length > 0 ? (
            <select className={inputClass} value={account} onChange={(e) => setAccount(e.target.value)}>
              {existingAccounts.map((a) => <option key={a} value={a}>{a}</option>)}
              <option value="">+ New account</option>
            </select>
          ) : null}
          {showNew && (
            <input
              className={`${inputClass} mt-1.5`}
              value={newAccount}
              onChange={(e) => setNewAccount(e.target.value)}
              placeholder="HYSA"
            />
          )}
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Deposit amount *</label>
          <input
            className={inputClass}
            type="number"
            step="any"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="1000.00"
            autoFocus
          />
        </div>

        {showNew && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Label</label>
            <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Cash" />
          </div>
        )}

        {acct && (
          <div className="flex items-center justify-between text-xs rounded-sm border border-border px-3 py-2" style={{ background: "oklch(0.10 0 0)" }}>
            <span className="text-muted-foreground">{acct} balance</span>
            <span className="font-mono text-foreground">
              {formatCurrency(current)}
              {projected !== current && <span style={{ color: "var(--positive)" }}> → {formatCurrency(projected)}</span>}
            </span>
          </div>
        )}

        {error && <p className="text-xs" style={{ color: "var(--negative)" }}>{error}</p>}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="text-xs px-4 py-2 rounded-sm font-medium disabled:opacity-50"
            style={{ background: "oklch(0.72 0.14 74)", color: "oklch(0.08 0 0)" }}
          >
            {saving ? "Depositing…" : "Deposit Cash"}
          </button>
          <button type="button" onClick={onCancel} className="text-xs px-3 py-2 rounded-sm text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
