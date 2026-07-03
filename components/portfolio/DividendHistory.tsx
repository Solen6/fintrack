"use client";

import { useState, useEffect, useCallback } from "react";
import { formatCurrency } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";
import { AddDividendModal } from "./AddDividendModal";

interface DividendRecord {
  id: string;
  holdingId: string;
  date: string;
  ticker: string;
  name: string | null;
  amount: number | null;
  reinvested: boolean | null;
  detail: string | null;
  sharesDelta: number;
  cashDelta: number;
  account: string | null;
  isManual: boolean;
}

type RowAction = { type: "correct" | "delete"; id: string } | null;

export function DividendHistory() {
  const [dividends, setDividends] = useState<DividendRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<RowAction>(null);
  const [working, setWorking] = useState<string | null>(null); // id being processed
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/holdings/dividends")
      .then((r) => r.json())
      .then((d) => setDividends(d.dividends ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCorrect(id: string) {
    setWorking(id);
    setRowError(null);
    try {
      const res = await fetch("/api/holdings/dividends/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRowError({ id, msg: data.error ?? "Correction failed" });
      } else {
        load();
      }
    } finally {
      setWorking(null);
      setPending(null);
    }
  }

  async function handleDelete(record: DividendRecord) {
    setWorking(record.id);
    setRowError(null);
    try {
      // Reverse the effect before deleting the row.
      const res = await fetch(`/api/holdings/dividends/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Passing a dedicated "delete" action — server treats this as reverse-only.
        body: JSON.stringify({ id: record.id, deleteOnly: true }),
      });
      // Fallback: if the server doesn't support deleteOnly yet, just delete the row.
      if (!res.ok) {
        await fetch(`/api/holdings/dividends?id=${record.id}`, { method: "DELETE" });
      }
      load();
    } finally {
      setWorking(null);
      setPending(null);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground animate-pulse">Loading dividends…</p>
      </div>
    );
  }

  const total = dividends.reduce((s, d) => s + (d.amount ?? 0), 0);

  return (
    <>
      {showAdd && (
        <AddDividendModal onClose={() => setShowAdd(false)} onAdded={load} />
      )}

      <div className="flex-1 overflow-auto">
        <div className="px-6 py-3 border-b border-border flex items-center gap-4">
          <span className="text-xs text-muted-foreground">
            {dividends.length} dividend{dividends.length !== 1 ? "s" : ""}
          </span>
          {dividends.length > 0 && (
            <span className="text-xs font-mono font-medium" style={{ color: "var(--positive)" }}>
              Total received: <Sensitive>{formatCurrency(total)}</Sensitive>
            </span>
          )}
          <div className="ml-auto">
            <button
              onClick={() => setShowAdd(true)}
              className="text-xs px-3 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
            >
              + Add dividend
            </button>
          </div>
        </div>

        {dividends.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-1 py-16">
            <p className="text-sm text-muted-foreground">No dividends recorded yet.</p>
            <p className="text-xs" style={{ color: "oklch(0.52 0.008 74)" }}>
              Dividends are logged automatically the day a holding goes ex-dividend.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse min-w-[700px]">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-left">Date</th>
                <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-left">Security</th>
                <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-left min-w-[140px]">Name</th>
                <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-right">Amount</th>
                <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-center">Type</th>
                <th className="px-4 py-3 text-xs text-muted-foreground font-medium text-center w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dividends.map((d) => {
                const isPending = pending?.id === d.id;
                const isWorking = working === d.id;
                const err = rowError?.id === d.id ? rowError.msg : null;

                return (
                  <>
                    <tr key={d.id} className="border-b border-border/50 group">
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(`${d.date}T00:00:00`).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-foreground">
                        {d.ticker}
                        {d.isManual && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground font-sans font-normal">manual</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{d.name ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-mono text-foreground">
                        {d.amount != null ? <Sensitive>{formatCurrency(d.amount)}</Sensitive> : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {d.reinvested == null ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <span
                            className="inline-block text-xs px-2 py-0.5 rounded-sm"
                            style={
                              d.reinvested
                                ? { background: "oklch(0.27 0.06 152)", color: "var(--positive)" }
                                : { background: "oklch(0.16 0 0)", color: "oklch(0.64 0.008 74)" }
                            }
                          >
                            {d.reinvested ? "Reinvested" : "Cash"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {!isPending ? (
                          <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {/* Correct button — flip cash↔DRIP */}
                            {d.reinvested != null && (
                              <button
                                title={d.reinvested ? "Correct: change to Cash" : "Correct: change to Reinvested"}
                                onClick={() => { setPending({ type: "correct", id: d.id }); setRowError(null); }}
                                className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                                disabled={isWorking}
                              >
                                ↔
                              </button>
                            )}
                            {/* Delete button — remove entry */}
                            <button
                              title="Remove this dividend entry"
                              onClick={() => { setPending({ type: "delete", id: d.id }); setRowError(null); }}
                              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                              disabled={isWorking}
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-[10px] text-muted-foreground">
                              {pending.type === "correct"
                                ? `→ ${d.reinvested ? "Cash" : "Reinvested"}?`
                                : "Remove?"}
                            </span>
                            <button
                              onClick={() => pending.type === "correct" ? handleCorrect(d.id) : handleDelete(d)}
                              disabled={isWorking}
                              className="text-[10px] px-1.5 py-0.5 rounded font-medium transition-opacity disabled:opacity-40"
                              style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
                            >
                              {isWorking ? "…" : "Yes"}
                            </button>
                            <button
                              onClick={() => { setPending(null); setRowError(null); }}
                              disabled={isWorking}
                              className="text-[10px] px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                            >
                              No
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {err && (
                      <tr key={`${d.id}-err`} className="border-b border-border/50">
                        <td colSpan={6} className="px-4 py-1.5 text-xs" style={{ color: "var(--negative)" }}>
                          {err}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
