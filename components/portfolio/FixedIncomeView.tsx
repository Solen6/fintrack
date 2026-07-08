"use client";

import { useMemo } from "react";
import type { HoldingWithMetrics } from "@/lib/types";
import { isBond } from "@/lib/types";
import { formatCurrency, formatCurrencyCompact, formatPercent } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";

interface Props {
  holdings: HoldingWithMetrics[];
}

const TYPE_LABEL: Record<string, string> = {
  treasury: "Treasury",
  corporate: "Corporate",
  muni: "Municipal",
  agency: "Agency",
  cd: "CD",
  etf: "ETF / Fund",
};

function maturityYear(iso?: string): number | null {
  if (!iso) return null;
  const y = Number(iso.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

export function FixedIncomeView({ holdings }: Props) {
  const bonds = useMemo(() => holdings.filter(isBond), [holdings]);
  // Rows with full analytics (real bonds; ETFs are funds without coupon/YTM).
  const priced = useMemo(() => bonds.filter((b) => b.bondType !== "etf" && b.bondMetrics), [bonds]);

  const stats = useMemo(() => {
    const totalMV = bonds.reduce((s, b) => s + b.value, 0);
    const pricedMV = priced.reduce((s, b) => s + b.value, 0);
    let wCoupon = 0, wYtm = 0, wDur = 0, income = 0, accrued = 0;
    for (const b of priced) {
      const m = b.bondMetrics!;
      const w = b.value;
      wCoupon += (b.couponRate ?? 0) * w;
      wYtm += m.ytm * w;
      wDur += m.modifiedDuration * w;
      income += m.annualIncome;
      accrued += m.accrued;
    }
    return {
      totalMV,
      count: bonds.length,
      avgCoupon: pricedMV > 0 ? wCoupon / pricedMV : 0,
      avgYtm: pricedMV > 0 ? wYtm / pricedMV : 0,
      avgDur: pricedMV > 0 ? wDur / pricedMV : 0,
      income,
      accrued,
    };
  }, [bonds, priced]);

  // Maturity ladder: market value per maturity year.
  const ladder = useMemo(() => {
    const byYear = new Map<number, number>();
    for (const b of priced) {
      const y = maturityYear(b.maturityDate);
      if (y == null) continue;
      byYear.set(y, (byYear.get(y) ?? 0) + b.value);
    }
    const rows = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, value]) => ({ year, value }));
    const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
    return { rows, max };
  }, [priced]);

  // Projected coupon income over the next 12 months.
  const incomeMonths = useMemo(() => {
    const now = new Date();
    const buckets: { label: string; key: string; amount: number }[] = [];
    const index = new Map<string, number>();
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      index.set(key, buckets.length);
      buckets.push({ label: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), key, amount: 0 });
    }
    const horizon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 12, 1));
    for (const b of priced) {
      const m = b.bondMetrics!;
      if (!m.nextCouponDate || !b.couponFreq || m.nextCouponAmount <= 0) continue;
      const stepMonths = Math.max(1, Math.round(12 / b.couponFreq));
      let d = new Date(m.nextCouponDate + "T00:00:00Z");
      const mat = b.maturityDate ? new Date(b.maturityDate + "T00:00:00Z") : null;
      for (let guard = 0; guard < 24 && d < horizon; guard++) {
        if (mat && d > mat) break;
        const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
        const idx = index.get(key);
        if (idx != null) buckets[idx].amount += m.nextCouponAmount;
        d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + stepMonths, d.getUTCDate()));
      }
    }
    const max = buckets.reduce((mx, x) => Math.max(mx, x.amount), 0);
    return { buckets, max };
  }, [priced]);

  if (bonds.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No fixed income yet — use “Add bond” to track a position.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Weighted stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-border rounded-sm overflow-hidden">
        <Stat label="Market value"><Sensitive>{formatCurrency(stats.totalMV)}</Sensitive></Stat>
        <Stat label="Positions">{stats.count}</Stat>
        <Stat label="Avg coupon">{stats.avgCoupon.toFixed(2)}%</Stat>
        <Stat label="Avg YTM">{stats.avgYtm.toFixed(2)}%</Stat>
        <Stat label="Avg duration">{stats.avgDur.toFixed(1)}y</Stat>
        <Stat label="Annual income"><Sensitive>{formatCurrency(stats.income)}</Sensitive></Stat>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Maturity ladder */}
        <section className="bg-card border border-border rounded-sm p-4">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Maturity ladder</h3>
          {ladder.rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">No dated maturities.</p>
          ) : (
            <div className="space-y-1.5">
              {ladder.rows.map((r) => (
                <div key={r.year} className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground w-10 shrink-0">{r.year}</span>
                  <div className="flex-1 h-4 bg-background rounded-sm overflow-hidden">
                    <div className="h-full rounded-sm" style={{
                      width: `${ladder.max > 0 ? (r.value / ladder.max) * 100 : 0}%`,
                      background: "var(--steel)",
                    }} />
                  </div>
                  <span className="text-xs font-mono text-foreground w-20 text-right shrink-0">
                    <Sensitive>{formatCurrency(r.value)}</Sensitive>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Income calendar */}
        <section className="bg-card border border-border rounded-sm p-4">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Projected coupon income · next 12 months</h3>
          <div className="flex gap-2">
            {/* $ Y-axis */}
            <div className="flex flex-col justify-between items-end h-28 w-12 shrink-0 text-[9px] font-mono text-muted-foreground">
              <span><Sensitive>{formatCurrencyCompact(incomeMonths.max)}</Sensitive></span>
              <span><Sensitive>{formatCurrencyCompact(incomeMonths.max / 2)}</Sensitive></span>
              <span>$0</span>
            </div>
            {/* bars over gridlines */}
            <div className="relative flex-1 h-28">
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                <div className="border-t border-border/40" />
                <div className="border-t border-border/40" />
                <div className="border-t border-border/40" />
              </div>
              <div className="relative flex items-end gap-1 h-full">
                {incomeMonths.buckets.map((m) => (
                  <div key={m.key} className="flex-1 h-full flex items-end" title={`${m.label}: ${formatCurrency(m.amount)}`}>
                    <div className="w-full rounded-sm" style={{
                      height: `${incomeMonths.max > 0 ? Math.max(m.amount > 0 ? 2 : 0, (m.amount / incomeMonths.max) * 100) : 0}%`,
                      background: m.amount > 0 ? "var(--primary)" : "transparent",
                    }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* month labels aligned under the bars */}
          <div className="flex gap-2 mt-1">
            <div className="w-12 shrink-0" />
            <div className="flex-1 flex gap-1">
              {incomeMonths.buckets.map((m) => (
                <span key={m.key} className="flex-1 text-center text-[9px] text-muted-foreground">{m.label}</span>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Holdings table */}
      <section className="bg-card border border-border rounded-sm overflow-x-auto">
        <table className="w-full text-xs min-w-[820px]">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="px-3 py-2 font-medium">Bond</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium text-right">Coupon</th>
              <th className="px-3 py-2 font-medium text-right">Maturity</th>
              <th className="px-3 py-2 font-medium text-right">Face</th>
              <th className="px-3 py-2 font-medium text-right">Price</th>
              <th className="px-3 py-2 font-medium text-right">Value</th>
              <th className="px-3 py-2 font-medium text-right">YTM</th>
              <th className="px-3 py-2 font-medium text-right">Cur. yield</th>
              <th className="px-3 py-2 font-medium text-right">Duration</th>
              <th className="px-3 py-2 font-medium text-right">Next coupon</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {bonds.map((b) => {
              const m = b.bondMetrics;
              const etf = b.bondType === "etf";
              return (
                <tr key={b.id} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2 font-sans text-foreground max-w-[220px] truncate" title={b.name}>{b.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{TYPE_LABEL[b.bondType ?? ""] ?? "Bond"}</td>
                  <td className="px-3 py-2 text-right">{etf ? "—" : `${(b.couponRate ?? 0).toFixed(2)}%`}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{etf ? "—" : fmtDate(b.maturityDate)}</td>
                  <td className="px-3 py-2 text-right"><Sensitive>{etf ? `${b.shares} sh` : formatCurrency(b.shares)}</Sensitive></td>
                  <td className="px-3 py-2 text-right">{etf ? formatCurrency(b.currentPrice) : (b.currentPrice * 100).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right text-foreground"><Sensitive>{formatCurrency(b.value)}</Sensitive></td>
                  <td className="px-3 py-2 text-right">{m ? formatPercent(m.ytm, false) : "—"}</td>
                  <td className="px-3 py-2 text-right">{m ? formatPercent(m.currentYield, false) : "—"}</td>
                  <td className="px-3 py-2 text-right">{m ? `${m.modifiedDuration.toFixed(1)}y` : "—"}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{m?.nextCouponDate ? fmtDate(m.nextCouponDate) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
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
