"use client";

import { useMemo, useState } from "react";
import type { Leg } from "@/lib/options-math";
import { OPTION_MULTIPLIER } from "@/lib/contract-specs";
import { formatCurrency } from "@/lib/format";

interface Props {
  legs: Leg[];
  underlying: string;
  strategyName: string;
  existingAccounts: string[];
  onDone: (result: { ok: boolean; msg: string }) => void;
}

const fmtExpiry = (unixSec: number) => new Date(unixSec * 1000).toISOString().slice(0, 10);

/** Confirm/record step after "Record strategy" in the builder. The builder
 *  prefills premiums from the live chain mid, but a position recorded here was
 *  opened at the broker — possibly days ago — so each leg's ENTRY premium is
 *  editable before saving. Stock legs (covered-call template) are shown
 *  greyed-out and never persisted: shares belong in a regular equity position,
 *  and auto-inserting them would double-count stock the user already holds. */
export function RecordStrategyModal({ legs, underlying, strategyName, existingAccounts, onDone }: Props) {
  const optionLegs = useMemo(() => legs.filter((l) => l.type !== "stock"), [legs]);
  const stockLegs = useMemo(() => legs.filter((l) => l.type === "stock"), [legs]);

  const [premiums, setPremiums] = useState<string[]>(() => optionLegs.map((l) => l.premium.toFixed(2)));
  const [account, setAccount] = useState(existingAccounts[0] ?? "");
  const [newAccount, setNewAccount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Net cash at open from the EDITED premiums: long legs pay (−), short legs
  // receive (+). Positive = net credit.
  const netCash = useMemo(
    () =>
      optionLegs.reduce((s, l, i) => {
        const p = parseFloat(premiums[i]) || 0;
        const sign = l.side === "short" ? 1 : -1;
        return s + sign * l.qty * OPTION_MULTIPLIER * p;
      }, 0),
    [optionLegs, premiums],
  );
  const credit = netCash > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const acct = newAccount.trim() || account;
    if (!acct) { setError("Account is required."); return; }
    if (premiums.some((p) => !Number.isFinite(parseFloat(p)) || parseFloat(p) < 0)) {
      setError("Each leg needs a premium ≥ 0.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/holdings/combo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          underlying,
          account: acct,
          notes: notes.trim() || undefined,
          strategyName,
          legs: optionLegs.map((l, i) => ({
            type: l.type,
            side: l.side,
            strike: l.strike,
            expiry: l.expiry,
            qty: l.qty,
            premium: parseFloat(premiums[i]) || 0,
          })),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Failed to record strategy");
      onDone({ ok: true, msg: `Recorded ${strategyName} (${optionLegs.length} legs).` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record strategy");
      setSaving(false);
    }
  };

  const inputClass =
    "px-2 py-1 text-xs rounded-sm border border-border bg-transparent text-foreground focus:outline-none focus:border-[var(--primary)] font-mono";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => onDone({ ok: false, msg: "Cancelled." })}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-lg rounded-md border border-border p-6 space-y-4 max-h-[85vh] overflow-y-auto"
        style={{ background: "oklch(0.12 0 0)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-sm font-medium text-foreground">
            Record {strategyName} — <span className="font-mono">{underlying}</span>
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Premiums are prefilled from the live mid — adjust them to what you actually paid or received at your broker.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-1.5 pr-2 font-medium">Side</th>
                <th className="py-1.5 pr-2 font-medium">Type</th>
                <th className="py-1.5 pr-2 font-medium text-right">Strike</th>
                <th className="py-1.5 pr-2 font-medium text-right">Expiry</th>
                <th className="py-1.5 pr-2 font-medium text-right">Qty</th>
                <th className="py-1.5 font-medium text-right">Premium/sh</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {optionLegs.map((l, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-1.5 pr-2" style={{ color: l.side === "short" ? "var(--negative)" : "var(--positive)" }}>
                    {l.side === "short" ? "Sell" : "Buy"}
                  </td>
                  <td className="py-1.5 pr-2 text-foreground">{l.type === "put" ? "Put" : "Call"}</td>
                  <td className="py-1.5 pr-2 text-right text-foreground">{l.strike}</td>
                  <td className="py-1.5 pr-2 text-right text-muted-foreground">{fmtExpiry(l.expiry)}</td>
                  <td className="py-1.5 pr-2 text-right text-foreground">{l.qty}</td>
                  <td className="py-1.5 text-right">
                    <input
                      className={`${inputClass} w-20 text-right`}
                      type="number"
                      step="any"
                      min="0"
                      value={premiums[i]}
                      onChange={(e) => setPremiums((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))}
                      aria-label={`Premium for leg ${i + 1}`}
                    />
                  </td>
                </tr>
              ))}
              {stockLegs.map((l, i) => (
                <tr key={`stock-${i}`} className="border-b border-border/50 opacity-50">
                  <td className="py-1.5 pr-2">{l.side === "short" ? "Sell" : "Buy"}</td>
                  <td className="py-1.5 pr-2">Stock</td>
                  <td className="py-1.5 pr-2 text-right">—</td>
                  <td className="py-1.5 pr-2 text-right">—</td>
                  <td className="py-1.5 pr-2 text-right">{l.qty}</td>
                  <td className="py-1.5 text-right text-muted-foreground">not recorded</td>
                </tr>
              ))}
            </tbody>
          </table>
          {stockLegs.length > 0 && (
            <p className="text-[10px] text-muted-foreground -mt-2">
              Stock legs aren&apos;t recorded here — track the shares as a regular position so they aren&apos;t double-counted.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Account *</label>
              {existingAccounts.length > 0 ? (
                <select
                  className="w-full px-3 py-2 text-sm rounded-sm border border-border bg-transparent text-foreground focus:outline-none focus:border-[var(--primary)] font-mono"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  {existingAccounts.map((a) => <option key={a} value={a}>{a}</option>)}
                  <option value="">+ New account</option>
                </select>
              ) : null}
              {(!account || existingAccounts.length === 0) && (
                <input
                  className="w-full mt-1.5 px-3 py-2 text-sm rounded-sm border border-border bg-transparent text-foreground focus:outline-none focus:border-[var(--primary)] font-mono"
                  value={newAccount}
                  onChange={(e) => setNewAccount(e.target.value)}
                  placeholder="Account name"
                />
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
              <input
                className="w-full px-3 py-2 text-sm rounded-sm border border-border bg-transparent text-foreground focus:outline-none focus:border-[var(--primary)] font-mono"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="text-xs py-2 border-t border-border">
            <span className="text-muted-foreground">{credit ? "Net credit received: " : "Net debit paid: "}</span>
            <span className="font-mono font-medium" style={{ color: credit ? "var(--positive)" : "var(--foreground)" }}>
              {formatCurrency(Math.abs(netCash))}
            </span>
          </div>

          {error && <p className="text-xs" style={{ color: "var(--negative)" }}>{error}</p>}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving || optionLegs.length === 0}
              className="text-xs px-4 py-2 rounded-sm font-medium disabled:opacity-50"
              style={{ background: "oklch(0.72 0.14 74)", color: "oklch(0.08 0 0)" }}
            >
              {saving ? "Recording…" : `Record ${optionLegs.length} leg${optionLegs.length === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              onClick={() => onDone({ ok: false, msg: "Cancelled." })}
              className="text-xs px-3 py-2 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
