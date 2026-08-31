"use client";

import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";
import { NOTE_MAX } from "@/lib/notes";
import type { HoldingWithMetrics } from "@/lib/types";

interface Props {
  existingAccounts: string[];
  cashByAccount?: Record<string, { label: string; balance: number }>;
  holdings: HoldingWithMetrics[];
  /** Pre-select the account the user was already looking at. */
  defaultFrom?: string;
  onSaved: () => void;
  onCancel: () => void;
}

type Mode = "cash" | "position";

const isEquity = (h: HoldingWithMetrics) => (h.instrumentType ?? "equity") === "equity";
const fmtShares = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, "").replace(/\.$/, ""));

/* Move cash or shares between two of the user's own accounts. Cash moves the
   balance; a position moves IN KIND — the shares keep their cost basis and
   acquisition date, so nothing is realized and no holding period restarts.
   (Distinct from Deposit / Withdraw, which move money in and out of the
   portfolio as a whole.) */
export function TransferForm({
  existingAccounts, cashByAccount = {}, holdings, defaultFrom, onSaved, onCancel,
}: Props) {
  const [mode, setMode] = useState<Mode>("cash");
  const [from, setFrom] = useState(
    defaultFrom && existingAccounts.includes(defaultFrom) ? defaultFrom : existingAccounts[0] ?? "",
  );
  const [to, setTo] = useState(() => existingAccounts.find((a) => a !== (defaultFrom ?? existingAccounts[0])) ?? "");
  const [newTo, setNewTo] = useState("");
  const [amount, setAmount] = useState("");
  const [holdingId, setHoldingId] = useState("");
  const [shares, setShares] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isCash = mode === "cash";
  const destOptions = existingAccounts.filter((a) => a !== from);
  // A brand-new destination only makes sense for cash — an in-kind share move
  // needs somewhere the position can already be valued alongside.
  const creatingTo = isCash && to === "";
  const dest = creatingTo ? newTo.trim() : to;

  const fromCash = cashByAccount[from]?.balance ?? 0;
  const toCash = dest ? cashByAccount[dest]?.balance ?? 0 : 0;

  const movable = useMemo(
    () => holdings.filter((h) => h.account === from && isEquity(h) && h.shares > 0)
      .sort((a, b) => a.ticker.localeCompare(b.ticker)),
    [holdings, from],
  );
  const selected = movable.find((h) => h.id === holdingId) ?? null;

  // How the destination will absorb the shares: folded into an existing
  // position at a blended cost, or landing as its own new row.
  const mergeInto = useMemo(
    () => (selected && dest
      ? holdings.find((h) => h.account === dest && isEquity(h) && h.ticker === selected.ticker) ?? null
      : null),
    [holdings, dest, selected],
  );

  const amt = parseFloat(amount);
  const hasAmt = Number.isFinite(amt) && amt > 0;
  const shareCount = shares.trim() === "" ? (selected?.shares ?? 0) : parseFloat(shares);
  const hasShares = Number.isFinite(shareCount) && shareCount > 0;
  const movedValue = selected && hasShares ? shareCount * selected.currentPrice : 0;
  const blended = mergeInto && selected && hasShares
    ? (mergeInto.shares * mergeInto.costBasis + shareCount * selected.costBasis) / (mergeInto.shares + shareCount)
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!from || !dest) { setError("Pick both accounts."); return; }
    if (from === dest) { setError("Pick two different accounts."); return; }

    let url: string;
    let payload: Record<string, unknown>;
    if (isCash) {
      if (!hasAmt) { setError("Transfer amount must be a positive number."); return; }
      if (amt > fromCash) { setError(`Cannot transfer more than the ${from} balance.`); return; }
      url = "/api/cash/transfer";
      payload = { from, to: dest, amount: amt };
    } else {
      if (!selected) { setError("Pick a position to transfer."); return; }
      if (!hasShares) { setError("Share count must be a positive number."); return; }
      if (shareCount > selected.shares + 1e-9) {
        setError(`Cannot transfer more than the ${fmtShares(selected.shares)} shares held.`); return;
      }
      url = "/api/holdings/transfer";
      payload = { id: selected.id, to: dest, shares: shareCount, price: selected.currentPrice };
    }

    setSaving(true);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, ...(note.trim() ? { note: note.trim() } : {}) }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Transfer failed");
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
    <div className="flex-1 flex items-start justify-center pt-12 px-6 overflow-y-auto">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4 pb-12">
        <h2 className="text-lg font-medium text-foreground">Transfer Between Accounts</h2>

        <div className="flex gap-2">
          <button type="button" aria-pressed={isCash} className={pill(isCash)}
            onClick={() => { setMode("cash"); setError(""); }}>
            Cash
          </button>
          <button type="button" aria-pressed={!isCash} className={pill(!isCash)}
            onClick={() => { setMode("position"); setError(""); if (to === "") setTo(destOptions[0] ?? ""); }}>
            Position
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          {isCash
            ? "Move money between two of your own accounts. It is not a deposit or a withdrawal — your total return is untouched, and each account still records the flow."
            : "Move shares in kind, the way a broker transfer does. Cost basis and acquisition date travel with the shares, so nothing is sold and no holding period restarts."}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">From *</label>
            <select
              className={inputClass}
              value={from}
              onChange={(e) => {
                const v = e.target.value;
                setFrom(v);
                setHoldingId(""); setShares(""); setError("");
                if (v === to) setTo(existingAccounts.find((a) => a !== v) ?? "");
              }}
            >
              {existingAccounts.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">To *</label>
            <select className={inputClass} value={to} onChange={(e) => { setTo(e.target.value); setError(""); }}>
              {destOptions.map((a) => <option key={a} value={a}>{a}</option>)}
              {isCash && <option value="">+ New account</option>}
            </select>
          </div>
        </div>

        {creatingTo && (
          <input
            className={inputClass}
            value={newTo}
            onChange={(e) => setNewTo(e.target.value)}
            placeholder="New account name — HYSA"
          />
        )}

        {isCash ? (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Amount *</label>
            <input
              className={inputClass}
              type="number" step="any" min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1000.00"
              autoFocus
            />
          </div>
        ) : (
          <>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Position *</label>
              {movable.length > 0 ? (
                <select
                  className={inputClass}
                  value={holdingId}
                  onChange={(e) => { setHoldingId(e.target.value); setShares(""); setError(""); }}
                >
                  <option value="">Select a position…</option>
                  {movable.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.ticker} — {fmtShares(h.shares)} sh
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-muted-foreground border border-border rounded-sm px-3 py-2">
                  {from} holds no stocks or ETFs to transfer. Bonds and options/futures can&apos;t be moved this way.
                </p>
              )}
            </div>

            {selected && (
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <label className="text-xs text-muted-foreground">Shares *</label>
                  <button
                    type="button"
                    onClick={() => setShares(fmtShares(selected.shares))}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Max {fmtShares(selected.shares)}
                  </button>
                </div>
                <input
                  className={inputClass}
                  type="number" step="any" min="0"
                  value={shares}
                  onChange={(e) => setShares(e.target.value)}
                  placeholder={fmtShares(selected.shares)}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Leave blank to move the whole position.
                </p>
              </div>
            )}
          </>
        )}

        <div>
          <label htmlFor="transfer-note" className="text-xs text-muted-foreground mb-1 block">
            Note <span className="text-[10px]">(optional)</span>
          </label>
          <input
            id="transfer-note"
            className={inputClass}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
            placeholder={isCash ? "Funding the Roth" : "Consolidating into one account"}
            maxLength={NOTE_MAX}
          />
          <div className="flex items-baseline justify-between mt-1 gap-2">
            <span className="text-[10px] text-muted-foreground">
              Shows on both sides of the transfer in your activity feed and reports.
            </span>
            {note.length > NOTE_MAX - 40 && (
              <span className="text-[10px] font-mono text-muted-foreground shrink-0">{NOTE_MAX - note.length}</span>
            )}
          </div>
        </div>

        {/* Preview — what each side looks like after the move. */}
        {isCash && from && dest && (
          <div className="space-y-1.5 text-xs rounded-sm border border-border px-3 py-2" style={{ background: "oklch(0.10 0 0)" }}>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{from} cash</span>
              <span className="font-mono text-foreground">
                <Sensitive>{formatCurrency(fromCash)}</Sensitive>
                {hasAmt && (
                  <span style={{ color: "var(--negative)" }}>
                    {" → "}<Sensitive>{formatCurrency(fromCash - amt)}</Sensitive>
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{dest} cash</span>
              <span className="font-mono text-foreground">
                <Sensitive>{formatCurrency(toCash)}</Sensitive>
                {hasAmt && (
                  <span style={{ color: "var(--positive)" }}>
                    {" → "}<Sensitive>{formatCurrency(toCash + amt)}</Sensitive>
                  </span>
                )}
              </span>
            </div>
          </div>
        )}

        {!isCash && selected && dest && hasShares && (
          <div className="space-y-1.5 text-xs rounded-sm border border-border px-3 py-2" style={{ background: "oklch(0.10 0 0)" }}>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Moving</span>
              <span className="font-mono text-foreground">
                {fmtShares(Math.min(shareCount, selected.shares))} {selected.ticker} ·{" "}
                <Sensitive>{formatCurrency(movedValue)}</Sensitive>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{from} keeps</span>
              <span className="font-mono text-foreground">
                {fmtShares(Math.max(0, selected.shares - shareCount))} {selected.ticker}
              </span>
            </div>
            <div className="pt-1 border-t border-border text-[10px] text-muted-foreground leading-relaxed">
              {mergeInto && blended !== null ? (
                <>
                  {dest} already holds {fmtShares(mergeInto.shares)} {selected.ticker} — these fold into one
                  position at a blended cost of <span className="font-mono">{formatCurrency(blended)}</span>/sh
                  (from <span className="font-mono">{formatCurrency(mergeInto.costBasis)}</span>).
                </>
              ) : (
                <>
                  Lands in {dest} as its own position at{" "}
                  <span className="font-mono">{formatCurrency(selected.costBasis)}</span>/sh — the same cost basis
                  it has now. Nothing is realized.
                </>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-xs" style={{ color: "var(--negative)" }}>{error}</p>}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || (!isCash && movable.length === 0)}
            className="text-xs px-4 py-2 rounded-sm font-medium disabled:opacity-50"
            style={{ background: "oklch(0.72 0.14 74)", color: "oklch(0.08 0 0)" }}
          >
            {saving ? "Transferring…" : isCash ? "Transfer Cash" : "Transfer Shares"}
          </button>
          <button type="button" onClick={onCancel} className="text-xs px-3 py-2 rounded-sm text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
