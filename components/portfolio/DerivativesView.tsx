"use client";

import { useMemo, useState } from "react";
import type { HoldingWithMetrics } from "@/lib/types";
import { isDerivative } from "@/lib/types";
import { formatCurrency, formatPercent } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";
import { recognizeStrategy } from "@/lib/option-strategies";
import {
  aggregatePayoff,
  netGreeks,
  priceAxisMax,
  probabilityOfProfit,
  summarize,
  type Greeks,
  type Leg,
  type PayoffSummary,
} from "@/lib/options-math";
import { PayoffChart } from "@/components/options/PayoffChart";
import { PnlHeatmap } from "@/components/options/PnlHeatmap";

interface Props {
  holdings: HoldingWithMetrics[];
  onClose?: (holding: HoldingWithMetrics) => void;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

function dte(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

/** Map a real holdings row into the options-math Leg the payoff engine uses. */
export function toLeg(h: HoldingWithMetrics): Leg {
  return {
    type: h.optionType === "PUT" ? "put" : "call",
    side: h.direction === "SHORT" ? "short" : "long",
    strike: h.strike ?? 0,
    expiry: h.expiry ? Math.floor(Date.parse(`${h.expiry.slice(0, 10)}T00:00:00Z`) / 1000) : 0,
    qty: Math.abs(h.shares) / (h.multiplier || 1),
    premium: h.costBasis,
    iv: h.iv ?? 0,
  };
}

/** $ with Infinity → "Unlimited" (uncapped payoff edges from summarize()). */
function moneyOrUnlimited(v: number): string {
  if (!Number.isFinite(v)) return "Unlimited";
  return formatCurrency(v);
}

type Group =
  | { kind: "combo"; key: string; rows: HoldingWithMetrics[] }
  | { kind: "single"; key: string; row: HoldingWithMetrics };

export function DerivativesView({ holdings, onClose }: Props) {
  const rows = useMemo(() => holdings.filter(isDerivative), [holdings]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const groups = useMemo<Group[]>(() => {
    const byCombo = new Map<string, HoldingWithMetrics[]>();
    const singles: HoldingWithMetrics[] = [];
    for (const r of rows) {
      if (r.comboId) {
        const g = byCombo.get(r.comboId);
        if (g) g.push(r); else byCombo.set(r.comboId, [r]);
      } else {
        singles.push(r);
      }
    }
    const out: Group[] = [];
    for (const [key, comboRows] of byCombo) {
      // A one-row "combo" (partially closed strategy) renders as a single.
      if (comboRows.length > 1) out.push({ kind: "combo", key, rows: comboRows });
      else singles.push(...comboRows);
    }
    for (const r of singles) out.push({ kind: "single", key: r.id, row: r });
    // Biggest absolute exposure first, combos by their summed value.
    return out.sort((a, b) => {
      const va = a.kind === "combo" ? a.rows.reduce((s, r) => s + Math.abs(r.value), 0) : Math.abs(a.row.value);
      const vb = b.kind === "combo" ? b.rows.reduce((s, r) => s + Math.abs(r.value), 0) : Math.abs(b.row.value);
      return vb - va;
    });
  }, [rows]);

  const stats = useMemo(() => {
    const totalValue = rows.reduce((s, r) => s + r.value, 0);
    const totalGain = rows.reduce((s, r) => s + r.gainDollar, 0);
    const longs = rows.filter((r) => r.direction !== "SHORT").length;
    const shorts = rows.filter((r) => r.direction === "SHORT").length;
    return { totalValue, totalGain, longs, shorts, count: rows.length };
  }, [rows]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          No options or futures yet — use “Add” → “Option” or “Future” to track a position.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-sm overflow-hidden">
        <Stat label="Market value"><Sensitive>{formatCurrency(stats.totalValue)}</Sensitive></Stat>
        <Stat label="Unrealized P/L">
          <span style={{ color: stats.totalGain >= 0 ? "var(--positive)" : "var(--negative)" }}>
            <Sensitive>{stats.totalGain >= 0 ? "+" : ""}{formatCurrency(stats.totalGain)}</Sensitive>
          </span>
        </Stat>
        <Stat label="Positions">{stats.count}</Stat>
        <Stat label="Long / Short">{stats.longs} / {stats.shorts}</Stat>
      </div>

      <div className="space-y-4">
        {groups.map((g) =>
          g.kind === "combo" ? (
            <ComboCard
              key={g.key}
              rows={g.rows}
              expanded={expanded.has(g.key)}
              onToggle={() => toggle(g.key)}
              onClose={onClose}
            />
          ) : (
            <SingleCard
              key={g.key}
              row={g.row}
              expanded={expanded.has(g.key)}
              onToggle={() => toggle(g.key)}
              onClose={onClose}
            />
          ),
        )}
      </div>
    </div>
  );
}

/* ─── Multi-leg strategy card ─── */

function ComboCard({
  rows,
  expanded,
  onToggle,
  onClose,
}: {
  rows: HoldingWithMetrics[];
  expanded: boolean;
  onToggle: () => void;
  onClose?: (h: HoldingWithMetrics) => void;
}) {
  const legs = useMemo(() => rows.map(toLeg), [rows]);
  const name = useMemo(() => recognizeStrategy(legs) ?? `${rows.length}-leg strategy`, [legs, rows.length]);
  const underlying = rows[0]?.underlying ?? rows[0]?.ticker ?? "";
  const expiry = rows[0]?.expiry;
  const value = rows.reduce((s, r) => s + r.value, 0);
  const gain = rows.reduce((s, r) => s + r.gainDollar, 0);
  // Entry cost from the signed encoding: Σ shares × costBasis (>0 debit, <0 credit).
  const entryCost = rows.reduce((s, r) => s + r.shares * r.costBasis, 0);
  const credit = entryCost < 0;
  const gainColor = gain >= 0 ? "var(--positive)" : "var(--negative)";
  const days = dte(expiry);

  return (
    <section className="bg-card border border-border rounded-sm overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 flex-wrap text-left hover:bg-accent/40 transition-colors"
        aria-expanded={expanded}
      >
        <span className="text-sm font-medium text-foreground">{name}</span>
        <span className="text-xs font-mono" style={{ color: "var(--steel)" }}>{underlying}</span>
        {expiry && (
          <span className="text-xs text-muted-foreground">
            exp {fmtDate(expiry)}{days != null && ` (${days <= 0 ? "expired" : `${days}d`})`}
          </span>
        )}
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
          style={{ background: "oklch(0.16 0 0)", color: credit ? "var(--positive)" : "oklch(0.64 0.008 74)" }}
        >
          {credit ? "Net Credit" : "Net Debit"} {formatCurrency(Math.abs(entryCost))}
        </span>
        <span className="ml-auto flex items-center gap-4 text-xs font-mono">
          <span className="text-foreground"><Sensitive>{formatCurrency(value)}</Sensitive></span>
          <span style={{ color: gainColor }}>
            <Sensitive>{gain >= 0 ? "+" : ""}{formatCurrency(gain)}</Sensitive>
          </span>
          <span className="text-muted-foreground" aria-hidden>{expanded ? "▾" : "▸"}</span>
        </span>
      </button>

      <LegsTable rows={rows} onClose={onClose} />

      {expanded && <PayoffPanel rows={rows} />}
    </section>
  );
}

/* ─── Standalone position card (single option or future) ─── */

function SingleCard({
  row,
  expanded,
  onToggle,
  onClose,
}: {
  row: HoldingWithMetrics;
  expanded: boolean;
  onToggle: () => void;
  onClose?: (h: HoldingWithMetrics) => void;
}) {
  const isOption = row.instrumentType === "option";
  const short = row.direction === "SHORT";
  const contracts = Math.abs(row.shares) / (row.multiplier || 1);
  const gainColor = row.gainDollar >= 0 ? "var(--positive)" : "var(--negative)";
  const days = isOption ? dte(row.expiry) : null;

  return (
    <section className="bg-card border border-border rounded-sm overflow-hidden">
      <button
        onClick={isOption ? onToggle : undefined}
        className={`w-full px-4 py-3 flex items-center gap-3 flex-wrap text-left transition-colors ${isOption ? "hover:bg-accent/40" : "cursor-default"}`}
        aria-expanded={isOption ? expanded : undefined}
      >
        <span className="text-sm font-medium text-foreground">
          {isOption
            ? `${short ? "Short" : "Long"} ${row.optionType === "PUT" ? "Put" : "Call"}`
            : `${short ? "Short" : "Long"} Future`}
        </span>
        <span className="text-xs font-mono" style={{ color: "var(--steel)" }}>{row.underlying ?? row.ticker}</span>
        {isOption && (
          <span className="text-xs text-muted-foreground">
            ${row.strike} · exp {fmtDate(row.expiry)}{days != null && ` (${days <= 0 ? "expired" : `${days}d`})`}
          </span>
        )}
        <span className="text-xs font-mono text-muted-foreground">
          {contracts % 1 === 0 ? contracts : contracts.toFixed(2)}x @ {formatCurrency(row.costBasis)}
        </span>
        <span className="ml-auto flex items-center gap-4 text-xs font-mono">
          <span className="text-muted-foreground">{formatCurrency(row.currentPrice)}</span>
          <span className="text-foreground"><Sensitive>{formatCurrency(row.value)}</Sensitive></span>
          <span style={{ color: gainColor }}>
            <Sensitive>{row.gainDollar >= 0 ? "+" : ""}{formatCurrency(row.gainDollar)}</Sensitive>
            {" "}(<Sensitive>{formatPercent(row.gainPercent)}</Sensitive>)
          </span>
          <span
            className="inline-block text-xs px-2 py-0.5 rounded-sm font-sans"
            style={{ background: "oklch(0.16 0 0)", color: "oklch(0.52 0.008 74)" }}
          >
            {row.account}
          </span>
          {onClose && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onClose(row); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onClose(row); } }}
              className="text-xs px-1.5 py-0.5 rounded-sm hover:bg-accent transition-colors font-sans"
              style={{ color: "var(--negative)" }}
              title="Close position"
            >
              Close
            </span>
          )}
          {isOption && <span className="text-muted-foreground" aria-hidden>{expanded ? "▾" : "▸"}</span>}
        </span>
      </button>

      {isOption && expanded && <PayoffPanel rows={[row]} />}
    </section>
  );
}

/* ─── Legs table under a strategy card ─── */

function LegsTable({ rows, onClose }: { rows: HoldingWithMetrics[]; onClose?: (h: HoldingWithMetrics) => void }) {
  return (
    <div className="overflow-x-auto border-t border-border">
      <table className="w-full text-xs min-w-[700px]">
        <thead>
          <tr className="text-left text-muted-foreground border-b border-border">
            <th className="px-4 py-1.5 font-medium">Leg</th>
            <th className="px-3 py-1.5 font-medium text-right">Strike</th>
            <th className="px-3 py-1.5 font-medium text-right">Contracts</th>
            <th className="px-3 py-1.5 font-medium text-right">Entry</th>
            <th className="px-3 py-1.5 font-medium text-right">Live</th>
            <th className="px-3 py-1.5 font-medium text-right">P/L</th>
            <th className="px-3 py-1.5 font-medium text-center">Account</th>
            {onClose && <th className="px-3 py-1.5 font-medium text-center">Actions</th>}
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((r) => {
            const short = r.direction === "SHORT";
            const contracts = Math.abs(r.shares) / (r.multiplier || 1);
            const gainColor = r.gainDollar >= 0 ? "var(--positive)" : "var(--negative)";
            return (
              <tr key={r.id} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-1.5">
                  <span style={{ color: short ? "var(--negative)" : "var(--positive)" }}>
                    {short ? "Sell" : "Buy"}
                  </span>{" "}
                  <span className="text-foreground">{r.optionType === "PUT" ? "Put" : "Call"}</span>
                </td>
                <td className="px-3 py-1.5 text-right text-foreground">{formatCurrency(r.strike ?? 0)}</td>
                <td className="px-3 py-1.5 text-right">{contracts % 1 === 0 ? contracts : contracts.toFixed(2)}</td>
                <td className="px-3 py-1.5 text-right">{formatCurrency(r.costBasis)}</td>
                <td className="px-3 py-1.5 text-right text-foreground">{formatCurrency(r.currentPrice)}</td>
                <td className="px-3 py-1.5 text-right" style={{ color: gainColor }}>
                  <Sensitive>{r.gainDollar >= 0 ? "+" : ""}{formatCurrency(r.gainDollar)}</Sensitive>
                </td>
                <td className="px-3 py-1.5 text-center">
                  <span
                    className="inline-block text-[10px] px-1.5 py-0.5 rounded-sm font-sans"
                    style={{ background: "oklch(0.16 0 0)", color: "oklch(0.52 0.008 74)" }}
                  >
                    {r.account}
                  </span>
                </td>
                {onClose && (
                  <td className="px-3 py-1.5 text-center">
                    <button
                      onClick={() => onClose(r)}
                      className="text-xs px-1.5 py-0.5 rounded-sm hover:bg-accent transition-colors font-sans"
                      style={{ color: "var(--negative)" }}
                      title="Close leg"
                    >
                      Close
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Payoff panel — same analytics block the options builder shows.
       Also reused by the portfolio heatmap's selected-option insights. ─── */

export function PayoffPanel({ rows }: { rows: HoldingWithMetrics[] }) {
  const [view, setView] = useState<"line" | "matrix">("line");
  const legs = useMemo(() => rows.map(toLeg), [rows]);
  const spot = rows.find((r) => r.underlyingSpot != null)?.underlyingSpot;
  const hasIv = legs.every((l) => l.iv > 0);
  const sameExpiry = new Set(legs.map((l) => l.expiry)).size === 1;

  const analytics = useMemo(() => {
    if (!spot || legs.length === 0) return null;
    const hi = priceAxisMax(legs, spot);
    const points = aggregatePayoff(legs, hi);
    const summary = summarize(legs, points);
    const greeks = hasIv ? netGreeks(legs, spot) : null;
    let pop = NaN;
    if (hasIv) {
      const sigma = legs.reduce((s, l) => s + l.iv, 0) / legs.length;
      const T = Math.max((legs[0].expiry - Date.now() / 1000) / (365 * 86400), 0);
      pop = probabilityOfProfit(points, spot, sigma, T);
    }
    return { points, summary, greeks, pop };
  }, [legs, spot, hasIv]);

  if (!spot || !analytics) {
    return (
      <div className="border-t border-border px-4 py-4">
        <p className="text-xs text-muted-foreground">
          Payoff chart needs a live spot price for the underlying — refresh prices and try again.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-border px-4 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Payoff at expiry</span>
        {hasIv && sameExpiry && (
          <div className="flex items-center rounded-sm border border-border overflow-hidden">
            {(["line", "matrix"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="text-[10px] px-2 py-0.5 transition-colors duration-150"
                style={{
                  background: view === v ? "oklch(0.16 0 0)" : "transparent",
                  color: view === v ? "var(--primary)" : "oklch(0.64 0.008 74)",
                }}
              >
                {v === "line" ? "Line" : "Over time"}
              </button>
            ))}
          </div>
        )}
      </div>

      {view === "matrix" && hasIv && sameExpiry ? (
        <PnlHeatmap legs={legs} spot={spot} expiry={legs[0].expiry} />
      ) : (
        <PayoffChart points={analytics.points} spot={spot} breakevens={analytics.summary.breakevens} />
      )}

      <StatsStrip summary={analytics.summary} pop={analytics.pop} />
      {analytics.greeks && <GreeksStrip g={analytics.greeks} />}
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Model estimate · Black-Scholes, no dividends · entry premiums = your recorded cost basis.
      </p>
    </div>
  );
}

function StatsStrip({ summary, pop }: { summary: PayoffSummary; pop: number }) {
  const credit = summary.netCost < 0;
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border rounded-sm overflow-hidden text-center">
      <Stat label={credit ? "Net credit" : "Net debit"}>{formatCurrency(Math.abs(summary.netCost))}</Stat>
      <Stat label="Max profit">
        <span style={{ color: "var(--positive)" }}>{moneyOrUnlimited(summary.maxProfit)}</span>
      </Stat>
      <Stat label="Max loss">
        <span style={{ color: "var(--negative)" }}>{moneyOrUnlimited(summary.maxLoss)}</span>
      </Stat>
      <Stat label={`Breakeven${summary.breakevens.length === 1 ? "" : "s"}`}>
        {summary.breakevens.length ? summary.breakevens.map((b) => b.toFixed(2)).join(" / ") : "—"}
      </Stat>
      <Stat label="Prob. of profit">{Number.isFinite(pop) ? `${(pop * 100).toFixed(0)}%` : "—"}</Stat>
    </div>
  );
}

function GreeksStrip({ g }: { g: Greeks }) {
  return (
    <div className="flex items-center gap-4 text-[11px] font-mono text-muted-foreground">
      <span>Δ {g.delta.toFixed(1)}</span>
      <span>Γ {g.gamma.toFixed(3)}</span>
      <span>Θ {g.theta.toFixed(2)}/day</span>
      <span>ν {g.vega.toFixed(2)}</span>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-card px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-mono text-foreground mt-0.5">{children}</div>
    </div>
  );
}
