"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";

interface Props {
  existingAccounts: string[];
  cashByAccount?: Record<string, { label: string; balance: number }>;
  onSaved: () => void;
  onCancel: () => void;
}

type Mode = "deposit" | "withdraw";

/* Move cash into or out of an account. Deposit ADDS to the balance and logs a
   DEPOSIT; Withdraw SUBTRACTS and logs a WITHDRAWAL. Neither changes the
   account's type. (Distinct from "Add cash", which sets an absolute balance.) */
export function DepositForm({ existingAccounts, cashByAccount = {}, onSaved, onCancel }: Props) {
  const initialAccount = existingAccounts[0] ?? "";
  const [mode, setMode] = useState<Mode>("deposit");
  const [account, setAccount] = useState(initialAccount);
  const [newAccount, setNewAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("Cash");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isDeposit = mode === "deposit";
  const acct = newAccount.trim() || account;
  // "+ New account" only makes sense for a deposit — you can't withdraw from an
  // account that doesn't exist yet.
  const showNew = isDeposit && (!account || existingAccounts.length === 0);
  const current = acct && cashByAccount[acct] ? cashByAccount[acct].balance : 0;
  const amt = parseFloat(amount);
  const hasAmt = Number.isFinite(amt) && amt > 0;
  const projected = hasAmt ? (isDeposit ? current + amt : current - amt) : current;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!acct) { setError("Account is required."); return; }
    if (!hasAmt) { setError(`${isDeposit ? "Deposit" : "Withdrawal"} amount must be a positive number.`); return; }
    if (!isDeposit && amt > current) { setError("Cannot withdraw more than the account balance."); return; }

    setSaving(true);
    const res = await fetch(isDeposit ? "/api/cash/deposit" : "/api/cash/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account: acct,
        amount: amt,
        ...(isDeposit && showNew ? { label: label.trim() || "Cash" } : {}),
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? `Failed to record ${isDeposit ? "deposit" : "withdrawal"}`);
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved();
  };

  const inputClass =
    "w-full px-3 py-2 text-sm rounded-sm border border-border bg-transparent text-foreground focus:outline-none focus:border-[var(--primary)] font-mono";
  const pill = (active: boolean) =>
    `flex-1 text-xs px-3 py-1.5 rounded-sm transition-colors ${active
      ? "text-foreground border border-[var(--primary)]"
      : "text-muted-foreground border border-border hover:text-foreground"}`;

  return (
    <div className="flex-1 flex items-start justify-center pt-12 px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4">
        <h2 className="text-lg font-medium text-foreground">Deposit / Withdraw Cash</h2>

        <div className="flex gap-2">
          <button type="button" aria-pressed={isDeposit} className={pill(isDeposit)} onClick={() => { setMode("deposit"); setError(""); }}>
            Deposit
          </button>
          <button type="button" aria-pressed={!isDeposit} className={pill(!isDeposit)} onClick={() => { setMode("withdraw"); setError(""); setNewAccount(""); }}>
            Withdraw
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          {isDeposit
            ? "Add money to an account's cash balance and record a deposit in your activity. It does not change the account's type."
            : "Remove money from an account's cash balance and record a withdrawal. It does not change the account's type."}
        </p>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Account *</label>
          {existingAccounts.length > 0 ? (
            <select className={inputClass} value={account} onChange={(e) => setAccount(e.target.value)}>
              {existingAccounts.map((a) => <option key={a} value={a}>{a}</option>)}
              {isDeposit && <option value="">+ New account</option>}
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
          <label className="text-xs text-muted-foreground mb-1 block">{isDeposit ? "Deposit" : "Withdrawal"} amount *</label>
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

        {isDeposit && showNew && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Label</label>
            <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Cash" />
          </div>
        )}

        {acct && (
          <div className="flex items-center justify-between text-xs rounded-sm border border-border px-3 py-2" style={{ background: "oklch(0.10 0 0)" }}>
            <span className="text-muted-foreground">{acct} balance</span>
            <span className="font-mono text-foreground">
              <Sensitive>{formatCurrency(current)}</Sensitive>
              {projected !== current && (
                <span style={{ color: isDeposit ? "var(--positive)" : "var(--negative)" }}>
                  {" → "}<Sensitive>{formatCurrency(projected)}</Sensitive>
                </span>
              )}
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
            {saving ? (isDeposit ? "Depositing…" : "Withdrawing…") : (isDeposit ? "Deposit Cash" : "Withdraw Cash")}
          </button>
          <button type="button" onClick={onCancel} className="text-xs px-3 py-2 rounded-sm text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
