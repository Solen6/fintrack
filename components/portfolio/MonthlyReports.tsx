"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency, formatPercent, formatShares } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";
import type {
  CashFlowReport,
  PortfolioReport,
  TaxReport,
  ReportEvent,
} from "@/lib/monthly-reports";

/* Monthly report archive (Accounts → Reports). Reports are generated
   automatically by the daily snapshot cron on the first market days after a
   month closes — this view only reads the stored payloads (/api/reports).
   The sidebar's account selection scopes which account's statement shows;
   "All accounts" maps to the '__all__' rollup. */

const ALL_ACCOUNTS = "__all__"; // keep in sync with lib/monthly-reports.ts

interface ReportRow {
  account: string;
  report_type: "cash_flow" | "portfolio" | "tax";
  payload: CashFlowReport | PortfolioReport | TaxReport;
  generated_at: string;
}

interface ReportsResponse {
  periods: string[];
  period: string | null;
  reports: ReportRow[];
  needsMigration?: boolean;
}

const MUTED = "oklch(0.64 0.008 74)";
const DIM = "oklch(0.52 0.008 74)";

// Activity-feed type colors (matches the PortfolioDeck badge conventions).
const TYPE_BADGE: Record<string, { bg: string; fg: string }> = {
  BUY: { bg: "oklch(0.22 0.05 240)", fg: "oklch(0.72 0.09 240)" },
  SELL: { bg: "oklch(0.22 0.07 28)", fg: "var(--negative)" },
  DIV: { bg: "oklch(0.22 0.06 74)", fg: "var(--primary)" },
  DEPOSIT: { bg: "oklch(0.27 0.06 152)", fg: "var(--positive)" },
};
const NEUTRAL_BADGE = { bg: "oklch(0.16 0 0)", fg: MUTED };

function monthLabel(period: string): string {
  return new Date(`${period}-01T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function dateLabel(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function gainColor(n: number): string | undefined {
  if (n > 0) return "var(--positive)";
  if (n < 0) return "var(--negative)";
  return undefined;
}

export function MonthlyReports({ account }: { account: string }) {
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Monotonic request id — a slow older response must not overwrite the month
  // the user selected last.
  const reqRef = useRef(0);
  const load = useCallback((p?: string | null) => {
    const req = ++reqRef.current;
    setLoading(true);
    setError(null);
    fetch(`/api/reports${p ? `?period=${p}` : ""}`)
      .then((r) => r.json())
      .then((d: ReportsResponse & { error?: string }) => {
        if (reqRef.current !== req) return;
        if (d.error) throw new Error(d.error);
        setData(d);
        setPeriod(d.period);
      })
      .catch((e: Error) => {
        if (reqRef.current === req) setError(e.message || "Failed to load reports");
      })
      .finally(() => {
        if (reqRef.current === req) setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Mirror the generator's account normalization (blank → "Unassigned") so
  // legacy rows still find their statement. NOTE: "all" is the sidebar's
  // pre-existing All-Accounts sentinel across this tab — an account literally
  // named "all" collides there app-wide, not just here.
  const scope = account === "all" ? ALL_ACCOUNTS : (account ?? "").trim() || "Unassigned";
  const scoped = useMemo(
    () => (data?.reports ?? []).filter((r) => r.account === scope),
    [data, scope],
  );
  const cashFlow = scoped.find((r) => r.report_type === "cash_flow")?.payload as
    | CashFlowReport
    | undefined;
  const portfolio = scoped.find((r) => r.report_type === "portfolio")?.payload as
    | PortfolioReport
    | undefined;
  const tax = scoped.find((r) => r.report_type === "tax")?.payload as TaxReport | undefined;
  // Newest of the three rows — cash_flow/tax refresh through day 7 while
  // portfolio freezes, so row order must not decide the header date.
  const generatedAt = scoped.reduce<string | null>(
    (m, r) => (!m || r.generated_at > m ? r.generated_at : m),
    null,
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground animate-pulse">Loading reports…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm" style={{ color: "var(--negative)" }}>{error}</p>
      </div>
    );
  }

  if (data?.needsMigration) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-1 py-16">
        <p className="text-sm text-muted-foreground">Monthly reports are not set up yet.</p>
        <p className="text-xs" style={{ color: DIM }}>
          Run supabase/monthly-reports.sql in the Supabase SQL Editor — reports then generate
          automatically after each month closes.
        </p>
      </div>
    );
  }

  if (!data || data.periods.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-1 py-16">
        <p className="text-sm text-muted-foreground">No monthly reports yet.</p>
        <p className="text-xs" style={{ color: DIM }}>
          Reports generate automatically on the first market days after a month closes.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-6 py-4 flex flex-col gap-4 max-w-[1200px]">
        {/* Header */}
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-foreground tracking-wide">
            Monthly Report — {scope === ALL_ACCOUNTS ? "All accounts" : scope}
          </h2>
          <select
            value={period ?? ""}
            onChange={(e) => load(e.target.value)}
            aria-label="Report month"
            className="text-xs rounded border border-border bg-background text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {data.periods.map((p) => (
              <option key={p} value={p}>{monthLabel(p)}</option>
            ))}
          </select>
          {generatedAt && (
            <span className="ml-auto text-xs text-muted-foreground">
              Generated {new Date(generatedAt).toLocaleDateString("en-US", {
                month: "short", day: "numeric", year: "numeric",
              })}
            </span>
          )}
        </div>

        {scoped.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 py-16">
            <p className="text-sm text-muted-foreground">
              No {period ? monthLabel(period) : ""} report for this account.
            </p>
            <p className="text-xs" style={{ color: DIM }}>
              Accounts added after a month closes have no statement for it.
            </p>
          </div>
        ) : (
          <>
            {portfolio && <PortfolioSection r={portfolio} />}
            {cashFlow && <CashFlowSection r={cashFlow} />}
            {tax && <TaxSection r={tax} />}
          </>
        )}
      </div>
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground">{title}</h3>
        {hint && <span className="text-xs" style={{ color: DIM }}>{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="bg-card px-3 py-2.5 flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-mono tabular-nums" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

function StatGrid({ children, cols = 4 }: { children: React.ReactNode; cols?: number }) {
  return (
    <div
      className={`grid gap-px rounded-sm overflow-hidden ${cols === 6 ? "grid-cols-3 lg:grid-cols-6" : "grid-cols-2 lg:grid-cols-4"}`}
      style={{ background: "var(--border)" }}
    >
      {children}
    </div>
  );
}

// Full literals so Tailwind's scanner sees the class names (text-${align}
// would be invisible to it and silently unstyled).
const th = (align: "left" | "right" = "left") =>
  `px-4 py-2 text-xs text-muted-foreground font-medium ${align === "right" ? "text-right" : "text-left"}`;
const td = "px-4 py-2";

// ── Portfolio section ────────────────────────────────────────────────────────

function PortfolioSection({ r }: { r: PortfolioReport }) {
  const me = r.monthEnd;
  return (
    <Section
      title="Portfolio Performance"
      hint={`Positions as of ${dateLabel(r.positionsAsOf)}`}
    >
      <StatGrid cols={6}>
        <Stat
          label="Month-end value"
          value={me.total != null ? <Sensitive>{formatCurrency(me.total)}</Sensitive> : "—"}
        />
        <Stat
          label="Monthly return"
          value={me.monthReturnPct != null ? <Sensitive>{formatPercent(me.monthReturnPct)}</Sensitive> : "—"}
          color={me.monthReturnPct != null ? gainColor(me.monthReturnPct) : undefined}
        />
        <Stat label="Market value" value={<Sensitive>{formatCurrency(r.totals.value)}</Sensitive>} />
        <Stat label="Cost basis" value={<Sensitive>{formatCurrency(r.totals.costBasis)}</Sensitive>} />
        <Stat
          label="Unrealized G/L"
          value={
            <>
              <Sensitive>{formatCurrency(r.totals.gain)}</Sensitive>
              {r.totals.gainPct != null ? <> (<Sensitive>{formatPercent(r.totals.gainPct)}</Sensitive>)</> : ""}
            </>
          }
          color={gainColor(r.totals.gain)}
        />
        <Stat label="Cash" value={<Sensitive>{formatCurrency(r.totals.cash)}</Sensitive>} />
      </StatGrid>

      {r.positions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[760px]">
            <thead>
              <tr className="border-b border-border">
                <th className={th()}>Ticker</th>
                <th className={th()}>Name</th>
                <th className={th()}>Sector</th>
                <th className={th("right")}>Shares</th>
                <th className={th("right")}>Cost/Share</th>
                <th className={th("right")}>Price</th>
                <th className={th("right")}>Value</th>
                <th className={th("right")}>Gain/Loss</th>
                <th className={th("right")}>%</th>
              </tr>
            </thead>
            <tbody>
              {r.positions.map((p) => (
                <tr key={p.ticker} className="border-b border-border/50">
                  <td className={`${td} font-mono font-semibold text-foreground`}>{p.ticker}</td>
                  <td className={`${td} text-muted-foreground max-w-[220px] truncate`}>{p.name}</td>
                  <td className={`${td} text-xs text-muted-foreground`}>{p.sector || "—"}</td>
                  <td className={`${td} text-right font-mono`}><Sensitive>{formatShares(p.shares)}</Sensitive></td>
                  <td className={`${td} text-right font-mono`}><Sensitive>{formatCurrency(p.costPerShare)}</Sensitive></td>
                  <td className={`${td} text-right font-mono`}>
                    <Sensitive>{formatCurrency(p.price)}</Sensitive>
                    {!p.priced && <span title="No live quote — cost basis shown" style={{ color: DIM }}> *</span>}
                  </td>
                  <td className={`${td} text-right font-mono`}><Sensitive>{formatCurrency(p.value)}</Sensitive></td>
                  <td className={`${td} text-right font-mono`} style={{ color: gainColor(p.gain) }}>
                    <Sensitive>{formatCurrency(p.gain)}</Sensitive>
                  </td>
                  <td className={`${td} text-right font-mono`} style={{ color: gainColor(p.gain) }}>
                    {p.gainPct != null ? <Sensitive>{formatPercent(p.gainPct)}</Sensitive> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Allocation title="Sector allocation" rows={r.allocation.bySector.map((s) => ({ label: s.sector, value: s.value, weightPct: s.weightPct }))} />
        {r.allocation.byType && (
          <Allocation
            title="Account-type allocation"
            rows={r.allocation.byType.map((t) => ({
              label: t.type.charAt(0).toUpperCase() + t.type.slice(1),
              value: t.value,
              weightPct: t.weightPct,
            }))}
          />
        )}
      </div>
    </Section>
  );
}

function Allocation({ title, rows }: { title: string; rows: { label: string; value: number; weightPct: number }[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</span>
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2 text-xs">
          <span className="w-40 truncate text-muted-foreground">{row.label}</span>
          <div className="flex-1 h-1.5 rounded-sm overflow-hidden" style={{ background: "oklch(0.16 0 0)" }}>
            <div
              className="h-full"
              style={{
                width: `${Math.min(100, Math.max(0, row.weightPct))}%`,
                background: row.label === "Cash" ? "var(--primary)" : "oklch(0.55 0.06 240)",
              }}
            />
          </div>
          <span className="w-16 text-right font-mono tabular-nums">{row.weightPct.toFixed(2)}%</span>
          <span className="w-24 text-right font-mono tabular-nums text-muted-foreground">
            <Sensitive>{formatCurrency(row.value)}</Sensitive>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Cash-flow section ────────────────────────────────────────────────────────

const INFLOW_LINES: { key: keyof CashFlowReport["inflows"]; label: string }[] = [
  { key: "deposits", label: "Deposits" },
  { key: "saleProceeds", label: "Sale proceeds" },
  { key: "dividends", label: "Dividends (cash)" },
  { key: "interest", label: "Interest" },
  { key: "transfersIn", label: "Transfers in" },
  { key: "other", label: "Other" },
];
const OUTFLOW_LINES: { key: keyof CashFlowReport["outflows"]; label: string }[] = [
  { key: "purchases", label: "Securities purchased" },
  { key: "withdrawals", label: "Withdrawals" },
  { key: "fees", label: "Fees" },
  { key: "transfersOut", label: "Transfers out" },
  { key: "other", label: "Other" },
];

function CashFlowSection({ r }: { r: CashFlowReport }) {
  const shown = r.events.slice(0, 15);
  return (
    <Section title="Cash Flow & Savings" hint={r.hasLedger ? undefined : "Transactions ledger not deployed — deposits/buys absent"}>
      <StatGrid>
        <Stat label="Total inflows" value={<Sensitive>{formatCurrency(r.inflows.total)}</Sensitive>} color={r.inflows.total > 0 ? "var(--positive)" : undefined} />
        <Stat label="Total outflows" value={<Sensitive>{formatCurrency(r.outflows.total)}</Sensitive>} color={r.outflows.total > 0 ? "var(--negative)" : undefined} />
        <Stat label="Net cash flow" value={<Sensitive>{formatCurrency(r.netCashFlow)}</Sensitive>} color={gainColor(r.netCashFlow)} />
        <Stat label="Savings rate" value={r.savingsRate != null ? <Sensitive>{formatPercent(r.savingsRate, false)}</Sensitive> : "—"} />
      </StatGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FlowTable title="Inflows" lines={INFLOW_LINES.map((l) => ({ label: l.label, value: r.inflows[l.key] }))} total={r.inflows.total} positive />
        <FlowTable title="Outflows" lines={OUTFLOW_LINES.map((l) => ({ label: l.label, value: r.outflows[l.key] }))} total={r.outflows.total} />
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        {r.cash.start != null && (
          <span>
            Cash {r.cash.startDate ? dateLabel(r.cash.startDate) : "start"}:{" "}
            <span className="font-mono text-foreground"><Sensitive>{formatCurrency(r.cash.start)}</Sensitive></span>
          </span>
        )}
        {r.cash.end != null && (
          <span>
            Cash {r.cash.endDate ? dateLabel(r.cash.endDate) : "end"}:{" "}
            <span className="font-mono text-foreground"><Sensitive>{formatCurrency(r.cash.end)}</Sensitive></span>
          </span>
        )}
        {r.dividendsReinvested > 0 && (
          <span>
            Reinvested dividends (no cash impact):{" "}
            <span className="font-mono text-foreground"><Sensitive>{formatCurrency(r.dividendsReinvested)}</Sensitive></span>
          </span>
        )}
      </div>

      {shown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[700px]">
            <thead>
              <tr className="border-b border-border">
                <th className={th()}>Date</th>
                <th className={th()}>Type</th>
                <th className={th()}>Description</th>
                <th className={th("right")}>Shares</th>
                <th className={th("right")}>Price</th>
                <th className={th("right")}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e, i) => (
                <EventRow key={`${e.date}-${e.type}-${i}`} e={e} />
              ))}
            </tbody>
          </table>
          {r.eventCount > shown.length && (
            <p className="px-4 py-2 text-xs" style={{ color: DIM }}>
              Showing {shown.length} of {r.eventCount} events.
            </p>
          )}
        </div>
      )}
      <p className="text-xs" style={{ color: DIM }}>{r.coverageNote}</p>
    </Section>
  );
}

function FlowTable({ title, lines, total, positive }: {
  title: string;
  lines: { label: string; value: number }[];
  total: number;
  positive?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</span>
      {lines.filter((l) => l.value !== 0).map((l) => (
        <div key={l.label} className="flex items-center justify-between text-xs py-0.5">
          <span className="text-muted-foreground">{l.label}</span>
          <span className="font-mono tabular-nums"><Sensitive>{formatCurrency(l.value)}</Sensitive></span>
        </div>
      ))}
      <div className="flex items-center justify-between text-xs py-1 border-t border-border/50 mt-1">
        <span className="text-muted-foreground font-medium">Total</span>
        <span
          className="font-mono tabular-nums font-medium"
          style={{ color: total > 0 ? (positive ? "var(--positive)" : "var(--negative)") : undefined }}
        >
          <Sensitive>{formatCurrency(total)}</Sensitive>
        </span>
      </div>
    </div>
  );
}

function EventRow({ e }: { e: ReportEvent }) {
  const badge = TYPE_BADGE[e.type] ?? NEUTRAL_BADGE;
  return (
    <tr className="border-b border-border/50">
      <td className={`${td} text-xs text-muted-foreground whitespace-nowrap`}>{dateLabel(e.date)}</td>
      <td className={td}>
        <span className="inline-block text-xs px-2 py-0.5 rounded-sm" style={{ background: badge.bg, color: badge.fg }}>
          {e.type}
        </span>
      </td>
      <td className={`${td} text-xs text-muted-foreground max-w-[280px] truncate`}>
        {e.symbol && <span className="font-mono font-semibold text-foreground mr-2">{e.symbol}</span>}
        {e.description}
      </td>
      <td className={`${td} text-right font-mono text-xs`}>{e.shares != null ? <Sensitive>{formatShares(e.shares)}</Sensitive> : "—"}</td>
      <td className={`${td} text-right font-mono text-xs`}>{e.price != null ? <Sensitive>{formatCurrency(e.price)}</Sensitive> : "—"}</td>
      <td className={`${td} text-right font-mono text-xs`} style={{ color: e.amount !== 0 ? gainColor(e.amount) : undefined }}>
        {/* DRIP: no cash moved — ↻ gross, matching the activity feed (parens
            would read as a negative amount). */}
        {e.amount !== 0 ? (
          <Sensitive>{formatCurrency(e.amount)}</Sensitive>
        ) : e.type === "DIV" && e.gross > 0 ? (
          <span style={{ color: MUTED }}>↻ <Sensitive>{formatCurrency(e.gross)}</Sensitive></span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

// ── Tax section ──────────────────────────────────────────────────────────────

function TaxSection({ r }: { r: TaxReport }) {
  return (
    <Section title="Realized Gains & Income" hint="Tax-readiness summary">
      <StatGrid>
        <Stat label="Realized gain/loss" value={<Sensitive>{formatCurrency(r.realized.totalGain)}</Sensitive>} color={gainColor(r.realized.totalGain)} />
        <Stat label="Dividend income" value={<Sensitive>{formatCurrency(r.income.totalGross)}</Sensitive>} />
        <Stat label="Interest" value={<Sensitive>{formatCurrency(r.income.interest)}</Sensitive>} />
        <Stat label="Fees" value={<Sensitive>{formatCurrency(r.fees.total)}</Sensitive>} color={r.fees.total > 0 ? "var(--negative)" : undefined} />
      </StatGrid>

      {r.realized.lots.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[700px]">
            <thead>
              <tr className="border-b border-border">
                <th className={th()}>Date</th>
                <th className={th()}>Ticker</th>
                <th className={th("right")}>Shares</th>
                <th className={th("right")}>Cost/Share</th>
                <th className={th("right")}>Sale Price</th>
                <th className={th("right")}>Proceeds</th>
                <th className={th("right")}>Gain/Loss</th>
              </tr>
            </thead>
            <tbody>
              {r.realized.lots.map((l, i) => (
                <tr key={`${l.ticker}-${l.date}-${i}`} className="border-b border-border/50">
                  <td className={`${td} text-xs text-muted-foreground whitespace-nowrap`}>{dateLabel(l.date)}</td>
                  <td className={`${td} font-mono font-semibold text-foreground`}>{l.ticker}</td>
                  <td className={`${td} text-right font-mono`}><Sensitive>{formatShares(l.shares)}</Sensitive></td>
                  <td className={`${td} text-right font-mono`}><Sensitive>{formatCurrency(l.costPerShare)}</Sensitive></td>
                  <td className={`${td} text-right font-mono`}><Sensitive>{formatCurrency(l.salePrice)}</Sensitive></td>
                  <td className={`${td} text-right font-mono`}><Sensitive>{formatCurrency(l.proceeds)}</Sensitive></td>
                  <td className={`${td} text-right font-mono`} style={{ color: gainColor(l.gain) }}>
                    <Sensitive>{formatCurrency(l.gain)}</Sensitive>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {r.income.dividends.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[600px]">
            <thead>
              <tr className="border-b border-border">
                <th className={th()}>Ticker</th>
                <th className={th("right")}>Payments</th>
                <th className={th("right")}>Gross</th>
                <th className={th("right")}>Cash</th>
                <th className={th("right")}>Reinvested</th>
              </tr>
            </thead>
            <tbody>
              {r.income.dividends.map((d) => (
                <tr key={d.ticker} className="border-b border-border/50">
                  <td className={`${td} font-mono font-semibold text-foreground`}>{d.ticker}</td>
                  <td className={`${td} text-right font-mono`}>{d.payments}</td>
                  <td className={`${td} text-right font-mono`}><Sensitive>{formatCurrency(d.gross)}</Sensitive></td>
                  <td className={`${td} text-right font-mono`}><Sensitive>{formatCurrency(d.cash)}</Sensitive></td>
                  <td className={`${td} text-right font-mono`}><Sensitive>{formatCurrency(d.reinvested)}</Sensitive></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs" style={{ color: DIM }}>{r.realized.holdingPeriodNote}</p>
    </Section>
  );
}
