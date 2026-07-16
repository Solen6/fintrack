"use client";

import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { OPTION_MULTIPLIER } from "@/lib/contract-specs";

interface Props {
  existingAccounts: string[];
  onSaved: () => void;
  onCancel: () => void;
}

export function AddOptionForm({ existingAccounts, onSaved, onCancel }: Props) {
  const [underlying, setUnderlying] = useState("");
  const [optionType, setOptionType] = useState<"CALL" | "PUT">("CALL");
  const [direction, setDirection] = useState<"LONG" | "SHORT">("LONG");
  const [strike, setStrike] = useState("");
  const [expiry, setExpiry] = useState("");
  const [contracts, setContracts] = useState("");
  const [premium, setPremium] = useState(""); // per share, not per contract
  const [account, setAccount] = useState(existingAccounts[0] ?? "");
  const [newAccount, setNewAccount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isShort = direction === "SHORT";

  const totalPremium = useMemo(() => {
    const c = parseFloat(contracts);
    const p = parseFloat(premium);
    return Number.isFinite(c) && Number.isFinite(p) ? c * OPTION_MULTIPLIER * p : null;
  }, [contracts, premium]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const acct = newAccount.trim() || account;
    const c = parseFloat(contracts);
    const s = parseFloat(strike);
    if (!underlying.trim() || !acct) {
      setError("Underlying and account are required.");
      return;
    }
    if (!Number.isFinite(c) || c <= 0) {
      setError("Contracts must be > 0.");
      return;
    }
    if (!Number.isFinite(s) || s <= 0) {
      setError("Strike must be > 0.");
      return;
    }
    if (!expiry) {
      setError("Expiry date is required.");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/holdings/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instrument_type: "option",
        underlying: underlying.trim().toUpperCase(),
        option_type: optionType,
        direction,
        strike: s,
        expiry,
        contracts: c,
        cost_basis: parseFloat(premium) || 0, // per share
        account: acct,
        notes: notes.trim() || undefined,
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Failed to add option");
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
          <h2 className="text-lg font-medium text-foreground">Add Option</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tracked in contracts (×{OPTION_MULTIPLIER} shares). "Sold to open" (short) is tracked too — a
            covered call or cash-secured put.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Underlying *</label>
            <input className={inputClass} value={underlying}
              onChange={(e) => setUnderlying(e.target.value.toUpperCase())} placeholder="AAPL" autoFocus />
          </div>
          <div>
            <label className={labelClass}>Type *</label>
            <select className={inputClass} value={optionType} onChange={(e) => setOptionType(e.target.value as "CALL" | "PUT")}>
              <option value="CALL">Call</option>
              <option value="PUT">Put</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Strike *</label>
            <input className={inputClass} type="number" step="any" min="0" value={strike}
              onChange={(e) => setStrike(e.target.value)} placeholder="150" />
          </div>
          <div>
            <label className={labelClass}>Expiry *</label>
            <input className={inputClass} type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Bought or sold *</label>
            <select className={inputClass} value={direction} onChange={(e) => setDirection(e.target.value as "LONG" | "SHORT")}>
              <option value="LONG">Bought (long)</option>
              <option value="SHORT">Sold to open (short)</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Contracts *</label>
            <input className={inputClass} type="number" step="any" min="0" value={contracts}
              onChange={(e) => setContracts(e.target.value)} placeholder="1" />
          </div>
        </div>

        <div>
          <label className={labelClass}>Premium per share {isShort ? "(received)" : "(paid)"}</label>
          <input className={inputClass} type="number" step="any" min="0" value={premium}
            onChange={(e) => setPremium(e.target.value)} placeholder="2.50" />
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

        {totalPremium !== null && (
          <p className="text-xs text-muted-foreground">
            {isShort ? "Credit received" : "Total premium"} ≈{" "}
            <span className="text-foreground font-mono">{formatCurrency(totalPremium)}</span>
          </p>
        )}
        {error && <p className="text-xs" style={{ color: "var(--negative)" }}>{error}</p>}

        <div className="flex items-center gap-3 pt-1">
          <button type="submit" disabled={saving}
            className="text-xs px-4 py-2 rounded-sm font-medium disabled:opacity-50"
            style={{ background: "oklch(0.72 0.14 74)", color: "oklch(0.08 0 0)" }}>
            {saving ? "Adding…" : "Add Option"}
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
