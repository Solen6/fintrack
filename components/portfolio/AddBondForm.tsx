"use client";

import { useMemo, useState } from "react";
import type { BondType, DayCount } from "@/lib/types";
import { formatCurrency } from "@/lib/format";

interface Props {
  existingAccounts: string[];
  onSaved: () => void;
  onCancel: () => void;
}

const BOND_TYPES: Array<{ id: BondType; label: string; dayCount: DayCount }> = [
  { id: "treasury", label: "Treasury", dayCount: "actual/actual" },
  { id: "corporate", label: "Corporate", dayCount: "30/360" },
  { id: "muni", label: "Municipal", dayCount: "30/360" },
  { id: "agency", label: "Agency", dayCount: "30/360" },
  { id: "cd", label: "Brokered CD", dayCount: "actual/365" },
  { id: "etf", label: "Bond ETF / Fund", dayCount: "actual/actual" },
];

const FREQS: Array<{ v: number; label: string }> = [
  { v: 2, label: "Semiannual" },
  { v: 1, label: "Annual" },
  { v: 4, label: "Quarterly" },
  { v: 12, label: "Monthly" },
];

export function AddBondForm({ existingAccounts, onSaved, onCancel }: Props) {
  const [bondType, setBondType] = useState<BondType>("treasury");
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState(""); // CUSIP for bonds, ticker for ETFs
  const [face, setFace] = useState(""); // face value ($) for bonds
  const [cleanPrice, setCleanPrice] = useState(""); // clean price per 100 for bonds
  const [shares, setShares] = useState(""); // share count for ETFs
  const [perShare, setPerShare] = useState(""); // per-share cost for ETFs
  const [couponRate, setCouponRate] = useState("");
  const [couponFreq, setCouponFreq] = useState(2);
  const [maturity, setMaturity] = useState("");
  const [valuation, setValuation] = useState<"auto" | "manual" | "cost">("auto");
  const [manualPrice, setManualPrice] = useState("");
  const [account, setAccount] = useState(existingAccounts[0] ?? "");
  const [newAccount, setNewAccount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isEtf = bondType === "etf";

  const marketValue = useMemo(() => {
    if (isEtf) {
      const s = parseFloat(shares);
      const p = parseFloat(perShare);
      return Number.isFinite(s) && Number.isFinite(p) ? s * p : null;
    }
    const f = parseFloat(face);
    const px = parseFloat(cleanPrice);
    return Number.isFinite(f) && Number.isFinite(px) ? f * (px / 100) : null;
  }, [isEtf, shares, perShare, face, cleanPrice]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const acct = newAccount.trim() || account;
    if (!name.trim() || !acct) {
      setError("Name and account are required.");
      return;
    }

    let payload: Record<string, unknown>;
    if (isEtf) {
      const s = parseFloat(shares);
      if (!identifier.trim() || !Number.isFinite(s) || s <= 0) {
        setError("Ticker and a positive share count are required for a bond ETF.");
        return;
      }
      payload = {
        instrument_type: "bond",
        bond_type: "etf",
        ticker: identifier.trim().toUpperCase(),
        name: name.trim(),
        shares: s,
        cost_basis: parseFloat(perShare) || 0, // per-share
        account: acct,
        notes: notes.trim() || undefined,
      };
    } else {
      const f = parseFloat(face);
      const px = parseFloat(cleanPrice);
      if (!Number.isFinite(f) || f <= 0) {
        setError("Face value (par held, in dollars) is required.");
        return;
      }
      if (!maturity) {
        setError("Maturity date is required.");
        return;
      }
      const ident = (identifier.trim() || name.trim().slice(0, 9)).toUpperCase();
      const dayCount = BOND_TYPES.find((b) => b.id === bondType)?.dayCount ?? "actual/actual";
      payload = {
        instrument_type: "bond",
        bond_type: bondType,
        ticker: ident, // CUSIP doubles as the row's identifier
        cusip: identifier.trim().toUpperCase() || undefined,
        name: name.trim(),
        shares: f, // face value (par held)
        cost_basis: Number.isFinite(px) ? px / 100 : 0, // clean price / 100
        coupon_rate: parseFloat(couponRate) || 0,
        coupon_freq: couponFreq,
        maturity_date: maturity,
        day_count: dayCount,
        price_source: valuation,
        manual_price: valuation === "manual" ? parseFloat(manualPrice) || undefined : undefined,
        account: acct,
        notes: notes.trim() || undefined,
      };
    }

    setSaving(true);
    const res = await fetch("/api/holdings/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Failed to add bond");
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
          <h2 className="text-lg font-medium text-foreground">Add Bond</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Fixed income is tracked by face value and clean price. ETFs are tracked like equities.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Type *</label>
            <select className={inputClass} value={bondType} onChange={(e) => setBondType(e.target.value as BondType)}>
              {BOND_TYPES.map((b) => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>{isEtf ? "Ticker *" : "CUSIP"}</label>
            <input
              className={inputClass}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={isEtf ? "BND" : "91282CJK5"}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Name *</label>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isEtf ? "Vanguard Total Bond Market ETF" : "US Treasury 4.25% Nov 2034"}
            autoFocus
          />
        </div>

        {isEtf ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Shares *</label>
              <input className={inputClass} type="number" step="any" min="0" value={shares}
                onChange={(e) => setShares(e.target.value)} placeholder="100" />
            </div>
            <div>
              <label className={labelClass}>Avg Cost / Share</label>
              <input className={inputClass} type="number" step="any" min="0" value={perShare}
                onChange={(e) => setPerShare(e.target.value)} placeholder="72.50" />
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Face value (par held, $) *</label>
                <input className={inputClass} type="number" step="any" min="0" value={face}
                  onChange={(e) => setFace(e.target.value)} placeholder="10000" />
              </div>
              <div>
                <label className={labelClass}>Purchase price (per 100)</label>
                <input className={inputClass} type="number" step="any" min="0" value={cleanPrice}
                  onChange={(e) => setCleanPrice(e.target.value)} placeholder="97.00" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass}>Coupon %</label>
                <input className={inputClass} type="number" step="any" min="0" value={couponRate}
                  onChange={(e) => setCouponRate(e.target.value)} placeholder="4.25" />
              </div>
              <div>
                <label className={labelClass}>Frequency</label>
                <select className={inputClass} value={couponFreq} onChange={(e) => setCouponFreq(Number(e.target.value))}>
                  {FREQS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Maturity *</label>
                <input className={inputClass} type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Valuation</label>
                <select className={inputClass} value={valuation} onChange={(e) => setValuation(e.target.value as "auto" | "manual" | "cost")}>
                  <option value="auto">Auto (curve / par)</option>
                  <option value="manual">Manual price</option>
                  <option value="cost">Hold at cost</option>
                </select>
              </div>
              {valuation === "manual" && (
                <div>
                  <label className={labelClass}>Current price (per 100)</label>
                  <input className={inputClass} type="number" step="any" min="0" value={manualPrice}
                    onChange={(e) => setManualPrice(e.target.value)} placeholder="98.50" />
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground -mt-1">
              {bondType === "treasury" || bondType === "agency"
                ? "Auto marks this against the live Treasury yield curve."
                : bondType === "cd"
                ? "Auto holds a CD at par until maturity."
                : "Auto holds corporates/munis at cost — set a manual price for a live mark."}
            </p>
          </>
        )}

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

        {marketValue !== null && (
          <p className="text-xs text-muted-foreground">
            Cost basis ≈ <span className="text-foreground font-mono">{formatCurrency(marketValue)}</span>
          </p>
        )}
        {error && <p className="text-xs" style={{ color: "var(--negative)" }}>{error}</p>}

        <div className="flex items-center gap-3 pt-1">
          <button type="submit" disabled={saving}
            className="text-xs px-4 py-2 rounded-sm font-medium disabled:opacity-50"
            style={{ background: "oklch(0.72 0.14 74)", color: "oklch(0.08 0 0)" }}>
            {saving ? "Adding…" : "Add Bond"}
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
