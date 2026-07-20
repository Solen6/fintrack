"use client";

import { useEffect, useState } from "react";

interface Props {
  existingAccounts: string[];
  onSaved: () => void;
  onCancel: () => void;
}

export function AddPositionForm({ existingAccounts, onSaved, onCancel }: Props) {
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  // Autofill owns the Name field until the user types their own; clearing it hands control back.
  const [nameIsAuto, setNameIsAuto] = useState(true);
  const [nameLoading, setNameLoading] = useState(false);
  const [shares, setShares] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [account, setAccount] = useState(existingAccounts[0] ?? "");
  const [newAccount, setNewAccount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Look up the company/fund name once the ticker settles (debounced; Yahoo via
  // /api/stocks/detail carries longName for stocks AND ETFs). Never overwrites a
  // hand-typed name.
  useEffect(() => {
    if (!nameIsAuto) return;
    const sym = ticker.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) return;

    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setNameLoading(true);
      try {
        const res = await fetch(
          `/api/stocks/detail?symbol=${encodeURIComponent(sym)}`,
          { signal: ctrl.signal },
        );
        if (res.ok) {
          const d = await res.json();
          const found = d?.stats?.name;
          if (typeof found === "string" && found) setName(found);
        }
      } catch {
        /* unknown ticker or network hiccup — leave the field as-is */
      } finally {
        if (!ctrl.signal.aborted) setNameLoading(false);
      }
    }, 450);
    return () => {
      clearTimeout(t);
      ctrl.abort();
      setNameLoading(false);
    };
  }, [ticker, nameIsAuto]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const acct = newAccount.trim() || account;
    if (!ticker.trim() || !shares || !acct) {
      setError("Ticker, shares, and account are required.");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/holdings/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker: ticker.trim(),
        name: name.trim() || ticker.trim().toUpperCase(),
        shares: parseFloat(shares),
        cost_basis: parseFloat(costBasis) || 0,
        account: acct,
        notes: notes.trim() || undefined,
      }),
    });

    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "Failed to add position");
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
        <h2 className="text-lg font-medium text-foreground">Add Position</h2>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Ticker *</label>
            <input
              className={inputClass}
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="AAPL"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              Name{nameLoading ? <span className="opacity-60"> · looking up…</span> : null}
            </label>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameIsAuto(e.target.value.trim() === "");
              }}
              placeholder="Auto-fills from ticker"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Shares *</label>
            <input
              className={inputClass}
              type="number"
              step="any"
              min="0"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder="10"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Avg Cost Basis</label>
            <input
              className={inputClass}
              type="number"
              step="any"
              min="0"
              value={costBasis}
              onChange={(e) => setCostBasis(e.target.value)}
              placeholder="150.00"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Account *</label>
          {existingAccounts.length > 0 ? (
            <select
              className={inputClass}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
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
              placeholder="Account name"
            />
          )}
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
          <input
            className={inputClass}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
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
            {saving ? "Adding…" : "Add Position"}
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
