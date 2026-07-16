"use client";

import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { FUTURES_SPECS } from "@/lib/contract-specs";

interface Props {
  existingAccounts: string[];
  onSaved: () => void;
  onCancel: () => void;
}

const FUTURES_BY_CATEGORY = Object.values(FUTURES_SPECS).reduce<Record<string, typeof FUTURES_SPECS[string][]>>(
  (acc, spec) => {
    (acc[spec.category] ??= []).push(spec);
    return acc;
  },
  {},
);

export function AddFutureForm({ existingAccounts, onSaved, onCancel }: Props) {
  const [symbol, setSymbol] = useState(Object.keys(FUTURES_SPECS)[0] ?? "");
  const [direction, setDirection] = useState<"LONG" | "SHORT">("LONG");
  const [contracts, setContracts] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [account, setAccount] = useState(existingAccounts[0] ?? "");
  const [newAccount, setNewAccount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const spec = FUTURES_SPECS[symbol];

  const notional = useMemo(() => {
    const c = parseFloat(contracts);
    const p = parseFloat(entryPrice);
    return spec && Number.isFinite(c) && Number.isFinite(p) ? c * spec.multiplier * p : null;
  }, [spec, contracts, entryPrice]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const acct = newAccount.trim() || account;
    const c = parseFloat(contracts);
    const p = parseFloat(entryPrice);
    if (!symbol || !acct) {
      setError("Symbol and account are required.");
      return;
    }
    if (!Number.isFinite(c) || c <= 0) {
      setError("Contracts must be > 0.");
      return;
    }
    if (!Number.isFinite(p) || p <= 0) {
      setError("Entry price must be > 0.");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/holdings/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instrument_type: "future",
        underlying: symbol,
        direction,
        contracts: c,
        cost_basis: p, // entry price per point
        account: acct,
        notes: notes.trim() || undefined,
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Failed to add future");
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved();
  };

  const inputClass =
    "w-full px-3 py-2 text-sm rounded-sm border border-border bg-transparent text-foreground focus:outline-none focus:border-[var(--primary)] font-mono";
  const labelClass = "text-xs text-muted-foreground mb-1 block";

  return (
    <div className="flex-1 flex items-start justify-center pt-10 px-6 overflow-y-auto">
      <form onSubmit={handleSubmit} className="w-full max-w-lg space-y-4 pb-16">
        <div>
          <h2 className="text-lg font-medium text-foreground">Add Future</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tracked in contracts at {spec ? `$${spec.multiplier}/point` : "the contract's point value"}. No cash
            is moved at open — futures are margin instruments, not modeled here beyond live P/L.
          </p>
        </div>

        <div>
          <label className={labelClass}>Contract *</label>
          <select className={inputClass} value={symbol} onChange={(e) => setSymbol(e.target.value)} autoFocus>
            {Object.entries(FUTURES_BY_CATEGORY).map(([category, specs]) => (
              <optgroup key={category} label={category}>
                {specs.map((s) => (
                  <option key={s.symbol} value={s.symbol}>{s.name} ({s.symbol})</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Long or short *</label>
            <select className={inputClass} value={direction} onChange={(e) => setDirection(e.target.value as "LONG" | "SHORT")}>
              <option value="LONG">Long</option>
              <option value="SHORT">Short</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Contracts *</label>
            <input className={inputClass} type="number" step="any" min="0" value={contracts}
              onChange={(e) => setContracts(e.target.value)} placeholder="1" />
          </div>
        </div>

        <div>
          <label className={labelClass}>Entry price *</label>
          <input className={inputClass} type="number" step="any" min="0" value={entryPrice}
            onChange={(e) => setEntryPrice(e.target.value)} placeholder={spec ? String(spec.tickSize >= 1 ? 100 : 100) : "0"} />
        </div>

        <div>
          <label className={labelClass}>Account *</label>
          {existingAccounts.length > 0 ? (
            <select className={inputClass} value={account} onChange={(e) => setAccount(e.target.value)}>
              {existingAccounts.map((a) => <option key={a} value={a}>{a}</option>)}
              <option value="">+ New account</option>
            </select>
          ) : null}
          {(!account || existingAccounts.length === 0) && (
            <input className={`${inputClass} mt-1.5`} value={newAccount}
              onChange={(e) => setNewAccount(e.target.value)} placeholder="Account name" />
          )}
        </div>

        <div>
          <label className={labelClass}>Notes</label>
          <input className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </div>

        {notional !== null && (
          <p className="text-xs text-muted-foreground">
            Notional ≈ <span className="text-foreground font-mono">{formatCurrency(notional)}</span>
            {spec && <> · initial margin ≈ <span className="text-foreground font-mono">{formatCurrency(spec.initialMargin * (parseFloat(contracts) || 0))}</span></>}
          </p>
        )}
        {error && <p className="text-xs" style={{ color: "var(--negative)" }}>{error}</p>}

        <div className="flex items-center gap-3 pt-1">
          <button type="submit" disabled={saving}
            className="text-xs px-4 py-2 rounded-sm font-medium disabled:opacity-50"
            style={{ background: "oklch(0.72 0.14 74)", color: "oklch(0.08 0 0)" }}>
            {saving ? "Adding…" : "Add Future"}
          </button>
          <button type="button" onClick={onCancel}
            className="text-xs px-3 py-2 rounded-sm text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
