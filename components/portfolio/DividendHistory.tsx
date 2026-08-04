"use client";

import { Fragment, useState, useEffect, useCallback, useMemo } from "react";
import { formatCurrency } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";
import { AddDividendModal } from "./AddDividendModal";
import type { HoldingWithMetrics } from "@/lib/types";

interface DividendRecord {
  id: string;
  holdingId: string;
  /** Income date — the pay date when known, else the ex-date as a placeholder. */
  date: string;
  /** Ex-date: the ownership deadline. Entitlement, not income. */
  exDate?: string;
  /** Payable date. Null = not published (every ETF, and history older than the
      currently-declared dividend) — those rows stay Pending. */
  payDate?: string | null;
  /** True only when a pay date is known AND has arrived. */
  paid?: boolean;
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
/** "2026-07-31" → "Jul 31". UTC-parsed so a timezone can't shift the day. */
function shortDate(ds: string): string {
  const [y, m, dd] = ds.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
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

/* `bonds` arrives already scoped to the selected account; `account` scopes the
   dividend records, which this component fetches itself. */
export function DividendHistory({ bonds = [], account = "all" }: { bonds?: HoldingWithMetrics[]; account?: string }) {
  const [allDividends, setAllDividends] = useState<DividendRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<RowAction>(null);
  const [working, setWorking] = useState<string | null>(null); // id being processed
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/holdings/dividends")
      .then((r) => r.json())
      .then((d) => setAllDividends(d.dividends ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Records with no account can't be attributed to one, so they only appear in
  // the combined "All Accounts" view.
  const dividends = useMemo(
    () => (account === "all" ? allDividends : allDividends.filter((d) => d.account === account)),
    [allDividends, account],
  );

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
  const { rows, divTotal, divPending, pendingCount, couponReceived } = useMemo(() => {
    const now = Date.now();
    const start = new Date(now - 365 * 86_400_000);
    const end = new Date(now + 365 * 86_400_000);
    const todayISO = isoUTC(new Date(now));

    /* A dividend is income on its PAY date, not its ex-date. Anything without
       a pay date that has arrived is `upcoming` — it shows a Pending badge and
       is excluded from the received total, exactly like an unpaid coupon. */
    const divRows: IncomeRow[] = dividends.map((d) => ({
      key: `div-${d.id}`,
      date: d.date,
      ticker: d.ticker,
      name: d.name,
      amount: d.amount,
      account: d.account,
      kind: "dividend",
      upcoming: d.paid === false,
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
    // Received vs pending are reported separately rather than one blended
    // number — money that hasn't been paid out shouldn't inflate income, but it
    // shouldn't be invisible either.
    const paidDivs = dividends.filter((d) => d.paid !== false);
    const unpaidDivs = dividends.filter((d) => d.paid === false);
    const divTotal = paidDivs.reduce((s, d) => s + (d.amount ?? 0), 0);
    const divPending = unpaidDivs.reduce((s, d) => s + (d.amount ?? 0), 0);
    const couponReceived = couponRows.filter((c) => !c.upcoming).reduce((s, c) => s + (c.amount ?? 0), 0);
    return { rows: all, divTotal, divPending, pendingCount: unpaidDivs.length, couponReceived };
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
          {divPending > 0 && (
            <span
              className="text-xs font-mono"
              style={{ color: "oklch(0.66 0.008 74)" }}
              title={`${pendingCount} dividend${pendingCount === 1 ? " has" : "s have"} gone ex-dividend but not yet paid (or have no published pay date). Excluded from the Dividends total until paid.`}
            >
              Pending: <Sensitive>{formatCurrency(divPending)}</Sensitive>
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
            <p className="text-sm text-muted-foreground">
              {account === "all" ? "No income recorded yet." : `No income recorded in ${account}.`}
            </p>
            <p className="text-xs" style={{ color: "oklch(0.52 0.008 74)" }}>
              Dividends are logged when a holding goes ex-dividend and count as income on their pay date; bond coupons appear from each bond’s schedule.
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

                /* The key belongs on the mapped element — the Fragment — not on
                   the <tr> inside it, or React reconciles these rows by index.
                   That now matters: switching account scope re-filters `rows`. */
                return (
                  <Fragment key={row.key}>
                    <tr className="border-b border-border/50 group">
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(`${row.date}T00:00:00`).toLocaleDateString("en-US", {
                          month: "short", day: "numeric", year: "numeric",
                        })}
                        {/* When the date shown IS the pay date, say so, and keep
                            the ex-date visible — it's what proves entitlement.
                            A row with no pay date is dated by its ex-date, and
                            is labelled that way so the two never get confused. */}
                        {d && (
                          <span className="block text-[10px]" style={{ color: "oklch(0.50 0.008 74)" }}>
                            {d.payDate
                              ? `pay date${d.exDate ? ` · ex ${shortDate(d.exDate)}` : ""}`
                              : d.exDate
                                ? "ex-date · pay date unknown"
                                : ""}
                          </span>
                        )}
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
                        ) : row.upcoming ? (
                          /* Gone ex-dividend but not paid out yet (or no pay
                             date published) — announced money, not income. */
                          <span
                            className="inline-block text-xs px-2 py-0.5 rounded-sm"
                            style={{ background: "oklch(0.18 0.02 74)", color: "oklch(0.72 0.10 74)" }}
                            title={
                              d?.payDate
                                ? `Pays ${shortDate(d.payDate)} — not yet received`
                                : "No published pay date — not counted as income until one is known"
                            }
                          >
                            Pending{d?.payDate ? ` · ${shortDate(d.payDate)}` : ""}
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
                      <tr className="border-b border-border/50">
                        <td colSpan={6} className="px-4 py-1.5 text-xs" style={{ color: "var(--negative)" }}>
                          {err}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
