"use client";

import { useState, useEffect } from "react";
import { formatCurrency, formatShares, formatPercent } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";

interface ClosedPosition {
  id: string;
  ticker: string;
  name: string;
  shares: number;
  cost_basis: number;
  sale_price: number;
  realized_gain: number;
  account: string;
  closed_at: string;
  notes: string | null;
  instrument_type?: string | null;
  multiplier?: number | null;
  direction?: string | null;
}

/** Local calendar date of a timestamp as YYYY-MM-DD (matches what the table shows). */
function localDateStr(ts: string): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface EditDraft {
  cost: string;  // clean price ×100 for face-value bonds, raw otherwise
  sale: string;
  date: string;  // YYYY-MM-DD
}

export function ClosedPositions() {
  const [positions, setPositions] = useState<ClosedPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>({ cost: "", sale: "", date: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  useEffect(() => {
    fetch("/api/holdings/closed")
      .then((r) => r.json())
      .then((d) => setPositions(d.closed ?? []))
      .finally(() => setLoading(false));
  }, []);

  const startEdit = (p: ClosedPosition) => {
    const faceBond = p.instrument_type === "bond";
    setDraft({
      cost: faceBond ? (p.cost_basis * 100).toFixed(2) : String(p.cost_basis),
      sale: faceBond ? (p.sale_price * 100).toFixed(2) : String(p.sale_price),
      date: localDateStr(p.closed_at),
    });
    setEditError("");
    setEditingId(p.id);
  };

  const saveEdit = async (p: ClosedPosition) => {
    const faceBond = p.instrument_type === "bond";
    const scale = faceBond ? 100 : 1;
    const cost = parseFloat(draft.cost) / scale;
    const sale = parseFloat(draft.sale) / scale;
    if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(sale) || sale < 0 || !draft.date) {
      setEditError("Cost, sale price (≥ 0), and date are required.");
      return;
    }

    const updates: Record<string, unknown> = { id: p.id };
    if (cost !== p.cost_basis) updates.cost_basis = cost;
    if (sale !== p.sale_price) updates.sale_price = sale;
    if (draft.date !== localDateStr(p.closed_at)) updates.closed_at = draft.date;
    if (Object.keys(updates).length === 1) {
      setEditingId(null); // nothing changed
      return;
    }

    setSavingEdit(true);
    setEditError("");
    const res = await fetch("/api/holdings/closed", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const d = await res.json();
    setSavingEdit(false);
    if (!res.ok) {
      setEditError(d.error ?? "Failed to save changes");
      return;
    }
    if (d.position) {
      setPositions((prev) => prev.map((row) => (row.id === p.id ? { ...row, ...d.position } : row)));
    }
    setEditingId(null);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground animate-pulse">Loading closed positions…</p>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No closed positions yet.</p>
      </div>
    );
  }

  const totalGain = positions.reduce((s, p) => s + p.realized_gain, 0);
  // Abs per row before summing — a short's cost_basis*shares is negative (a
  // credit received, not a cost), and summing signed would let longs and
  // shorts cancel out the denominator instead of both contributing capital.
  const totalCost = positions.reduce((s, p) => s + Math.abs(p.cost_basis * p.shares), 0);
  const totalPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-6 py-3 border-b border-border flex items-center gap-4">
        <span className="text-xs text-muted-foreground">
          {positions.length} closed position{positions.length !== 1 ? "s" : ""}
        </span>
        <span
          className="text-xs font-mono font-medium"
          style={{ color: totalGain >= 0 ? "var(--positive)" : "var(--negative)" }}
        >
          Total realized: <Sensitive>{totalGain >= 0 ? "+" : ""}{formatCurrency(totalGain)}</Sensitive> (<Sensitive>{formatPercent(totalPct)}</Sensitive>)
        </span>
        {editError && (
          <span className="text-xs" style={{ color: "var(--negative)" }}>{editError}</span>
        )}
      </div>
      <table className="w-full text-sm border-collapse min-w-[760px]">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-left">Ticker</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-left min-w-[140px]">Name</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right">Shares</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right">Cost Basis</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right">Sale Price</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right">Realized P/L</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right">Return %</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-center">Account</th>
            <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right">Closed</th>
            <th className="px-2 py-3 w-16" />
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const faceBond = p.instrument_type === "bond"; // shares = face, prices = clean/100
            const isDeriv = p.instrument_type === "option" || p.instrument_type === "future";
            const multiplier = p.multiplier || 1;
            const contracts = Math.abs(p.shares) / multiplier;
            const editing = editingId === p.id;

            // While editing, preview P/L live from the draft; otherwise show stored.
            const scale = faceBond ? 100 : 1;
            const dCost = editing ? parseFloat(draft.cost) / scale : p.cost_basis;
            const dSale = editing ? parseFloat(draft.sale) / scale : p.sale_price;
            const gain =
              editing && Number.isFinite(dCost) && Number.isFinite(dSale)
                ? (dSale - dCost) * p.shares
                : p.realized_gain;
            const color = gain >= 0 ? "var(--positive)" : "var(--negative)";
            // Abs denominator: a short's cost_basis*shares is negative (a
            // credit received), and dividing by a negative would flip the
            // sign of a real profit into a misleading negative return.
            const costTotal = (Number.isFinite(dCost) ? dCost : p.cost_basis) * p.shares;
            const returnPct = costTotal !== 0 ? (gain / Math.abs(costTotal)) * 100 : 0;

            const editInput =
              "w-20 px-1.5 py-1 text-xs text-right rounded-sm border border-border bg-transparent text-foreground focus:outline-none focus:border-[var(--primary)] font-mono";

            return (
              <tr key={p.id} className="border-b border-border/50">
                <td className="px-4 py-3 font-mono font-semibold text-foreground">{p.ticker}</td>
                <td className="px-4 py-3 text-muted-foreground">{p.name}</td>
                <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                  <Sensitive>
                    {faceBond ? formatCurrency(p.shares)
                      : isDeriv ? `${contracts % 1 === 0 ? contracts : contracts.toFixed(2)} (${p.direction === "SHORT" ? "short" : "long"})`
                      : formatShares(p.shares)}
                  </Sensitive>
                </td>
                <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                  {editing ? (
                    <input
                      className={editInput}
                      type="number"
                      step="any"
                      min="0"
                      value={draft.cost}
                      onChange={(e) => setDraft((d) => ({ ...d, cost: e.target.value }))}
                    />
                  ) : (
                    <Sensitive>{faceBond ? (p.cost_basis * 100).toFixed(2) : formatCurrency(p.cost_basis)}</Sensitive>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono text-foreground">
                  {editing ? (
                    <input
                      className={editInput}
                      type="number"
                      step="any"
                      min="0"
                      value={draft.sale}
                      onChange={(e) => setDraft((d) => ({ ...d, sale: e.target.value }))}
                    />
                  ) : (
                    <Sensitive>{faceBond ? (p.sale_price * 100).toFixed(2) : formatCurrency(p.sale_price)}</Sensitive>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono" style={{ color }}>
                  <Sensitive>{gain >= 0 ? "+" : ""}{formatCurrency(gain)}</Sensitive>
                </td>
                <td className="px-4 py-3 text-right font-mono" style={{ color }}>
                  <Sensitive>{formatPercent(returnPct)}</Sensitive>
                </td>
                <td className="px-4 py-3 text-center">
                  <span
                    className="inline-block text-xs px-2 py-0.5 rounded-sm"
                    style={{ background: "oklch(0.16 0 0)", color: "oklch(0.52 0.008 74)" }}
                  >
                    {p.account}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                  {editing ? (
                    <input
                      className={`${editInput} w-32 text-left`}
                      type="date"
                      value={draft.date}
                      onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                    />
                  ) : (
                    new Date(p.closed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  )}
                </td>
                <td className="px-2 py-3 text-right whitespace-nowrap">
                  {editing ? (
                    <>
                      <button
                        onClick={() => saveEdit(p)}
                        disabled={savingEdit}
                        className="text-xs px-1.5 py-1 disabled:opacity-50"
                        style={{ color: "var(--primary)" }}
                        title="Save"
                      >
                        {savingEdit ? "…" : "✓"}
                      </button>
                      <button
                        onClick={() => { setEditingId(null); setEditError(""); }}
                        disabled={savingEdit}
                        className="text-xs px-1.5 py-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                        title="Cancel"
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => startEdit(p)}
                      className="text-xs px-1.5 py-1 text-muted-foreground hover:text-foreground transition-colors"
                      title="Edit cost, sale price, or close date"
                    >
                      ✎
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
