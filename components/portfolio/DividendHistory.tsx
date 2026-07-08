"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { formatCurrency } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";
import { AddDividendModal } from "./AddDividendModal";
import type { HoldingWithMetrics } from "@/lib/types";

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

/** A unified income event — a real dividend record or a computed bond coupon. */
interface IncomeRow {
  key: string;
  date: string;
  ticker: string;
  name: string | null;
  amount: number | null;
  account: string | null;
  kind: "dividend" | "coupon";
  upcoming?: boolean;
  dividend?: DividendRecord;
}

type RowAction = { type: "correct" | "delete"; id: string } | null;

/* ─── Coupon schedule (computed — no coupon ledger yet, Phase 5) ─── */
function isoUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addMonthsUTC(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}
/** Coupon payments for one bond within [start, end], stepping back from maturity. */
function couponEvents(bond: HoldingWithMetrics, start: Date, end: Date): { date: string; amount: number }[] {
  const face = bond.shares;
  const rate = bond.couponRate ?? 0;
  const freq = bond.couponFreq ?? 2;
  if (!bond.maturityDate || rate <= 0 || freq <= 0) return [];
  const perPayment = face * (rate / 100) / freq;
  const stepMonths = Math.max(1, Math.round(12 / freq));
  const issue = bond.issueDate ? new Date(`${bond.issueDate.slice(0, 10)}T00:00:00Z`) : null;
  const out: { date: string; amount: number }[] = [];
  let d = new Date(`${bond.maturityDate.slice(0, 10)}T00:00:00Z`);
  for (let i = 0; i < 400 && d.getTime() >= start.getTime(); i++) {
    if (d.getTime() <= end.getTime() && (!issue || d.getTime() >= issue.getTime())) {
      out.push({ date: isoUTC(d), amount: perPayment });
    }
    d = addMonthsUTC(d, -stepMonths);
  }
  return out;
}

export function DividendHistory({ bonds = [] }: { bonds?: HoldingWithMetrics[] }) {
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
      const res = await fetch(`/api/holdings/dividends/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.id, deleteOnly: true }),
      });
      if (!res.ok) {
        await fetch(`/api/holdings/dividends?id=${record.id}`, { method: "DELETE" });
      }
      load();
    } finally {
      setWorking(null);
      setPending(null);
    }
  }

  // Merge dividends + computed coupon payments (past 12mo → next 12mo).
  const { rows, divTotal, couponReceived } = useMemo(() => {
    const now = Date.now();
    const start = new Date(now - 365 * 86_400_000);
    const end = new Date(now + 365 * 86_400_000);
    const todayISO = isoUTC(new Date(now));

    const divRows: IncomeRow[] = dividends.map((d) => ({
      key: `div-${d.id}`,
      date: d.date,
      ticker: d.ticker,
      name: d.name,
      amount: d.amount,
      account: d.account,
      kind: "dividend",
      dividend: d,
    }));

    const couponRows: IncomeRow[] = [];
    for (const b of bonds) {
      for (const c of couponEvents(b, start, end)) {
        couponRows.push({
          key: `cpn-${b.id}-${c.date}`,
          date: c.date,
          ticker: b.ticker,
          name: b.name,
          amount: c.amount,
          account: b.account,
          kind: "coupon",
          upcoming: c.date > todayISO,
        });
      }
    }

    const all = [...divRows, ...couponRows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const divTotal = dividends.reduce((s, d) => s + (d.amount ?? 0), 0);
    const couponReceived = couponRows.filter((c) => !c.upcoming).reduce((s, c) => s + (c.amount ?? 0), 0);
    return { rows: all, divTotal, couponReceived };
  }, [dividends, bonds]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground animate-pulse">Loading income…</p>
      </div>
    );
  }

  return (
    <>
      {showAdd && <AddDividendModal onClose={() => setShowAdd(false)} onAdded={load} />}

      <div className="flex-1 overflow-auto">
        <div className="px-6 py-3 border-b border-border flex items-center gap-4 flex-wrap">
          <span className="text-xs text-muted-foreground">
            {rows.length} income event{rows.length !== 1 ? "s" : ""}
          </span>
          {divTotal > 0 && (
            <span className="text-xs font-mono font-medium" style={{ color: "var(--positive)" }}>
              Dividends: <Sensitive>{formatCurrency(divTotal)}</Sensitive>
            </span>
          )}
          {couponReceived > 0 && (
            <span className="text-xs font-mono font-medium" style={{ color: "oklch(0.74 0.09 240)" }}>
              Coupons (12mo): <Sensitive>{formatCurrency(couponReceived)}</Sensitive>
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

        {rows.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-1 py-16">
            <p className="text-sm text-muted-foreground">No income recorded yet.</p>
            <p className="text-xs" style={{ color: "oklch(0.52 0.008 74)" }}>
              Dividends are logged when a holding goes ex-dividend; bond coupons appear from each bond’s schedule.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse min-w-[720px]">
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
              {rows.map((row) => {
                const d = row.dividend;
                const isPending = d ? pending?.id === d.id : false;
                const isWorking = d ? working === d.id : false;
                const err = d && rowError?.id === d.id ? rowError.msg : null;

                return (
                  <>
                    <tr key={row.key} className="border-b border-border/50 group">
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(`${row.date}T00:00:00`).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-foreground">
                        {row.ticker}
                        {d?.isManual && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground font-sans font-normal">manual</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{row.name ?? "—"}</td>
                      <td
                        className="px-4 py-3 text-right font-mono"
                        style={{ color: row.upcoming ? "oklch(0.55 0.008 74)" : "var(--foreground)" }}
                      >
                        {row.amount != null ? <Sensitive>{formatCurrency(row.amount)}</Sensitive> : "—"}
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        {row.kind === "coupon" ? (
                          <span
                            className="inline-block text-xs px-2 py-0.5 rounded-sm"
                            style={{ background: "oklch(0.22 0.04 240)", color: "oklch(0.74 0.09 240)" }}
                          >
                            Coupon{row.upcoming ? " · upcoming" : ""}
                          </span>
                        ) : d?.reinvested == null ? (
                          <span className="text-xs text-muted-foreground">Dividend</span>
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
                        {row.kind !== "dividend" || !d ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : !isPending ? (
                          <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                              {pending?.type === "correct"
                                ? `→ ${d.reinvested ? "Cash" : "Reinvested"}?`
                                : "Remove?"}
                            </span>
                            <button
                              onClick={() => pending?.type === "correct" ? handleCorrect(d.id) : handleDelete(d)}
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
                      <tr key={`${row.key}-err`} className="border-b border-border/50">
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
