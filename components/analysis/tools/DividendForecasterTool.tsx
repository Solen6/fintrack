"use client";

import { useMemo, useState } from "react";
import { formatCurrency, formatCurrencyCompact, formatPercent } from "@/lib/format";
import { Sensitive, usePrivacy, MONEY_MASK } from "@/lib/privacy";
import { cn } from "@/lib/utils";
import type { AnalysisFundamentalsResponse } from "@/lib/analytics/api-types";
import {
  ToolShell,
  Panel,
  Stat,
  StatRow,
  LoadingBlock,
  ErrorBlock,
  EmptyBlock,
  MethodologyNote,
} from "../ui";
import { useAnalysisData } from "../useAnalysisData";
import { LineChart, CHART } from "../charts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HORIZONS = [5, 10, 20, 30];

/** Format an ISO YYYY-MM-DD date as "Jul 25, 2026" without timezone drift. */
function fmtDate(iso: string): string {
  const parts = iso.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !m || !d || m < 1 || m > 12) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

interface PayerRow {
  ticker: string;
  yield: number;
  annualIncome: number;
  nextExDate: string | null;
}

interface UpcomingDividend {
  ticker: string;
  exDate: string;
  payDate: string | null;
  estPayment: number;
}

export function DividendForecasterTool() {
  const { data, loading, error, retry } =
    useAnalysisData<AnalysisFundamentalsResponse>("/api/analysis/fundamentals");
  const { hidden } = usePrivacy();

  const [years, setYears] = useState(20);
  const [growthPct, setGrowthPct] = useState(5);
  const [view, setView] = useState<"income" | "value">("income");

  const model = useMemo(() => {
    if (!data || data.empty || data.fundamentals.length === 0) return null;
    const funds = data.fundamentals;

    const portfolioIncome = funds.reduce((sum, f) => sum + f.value * (f.dividendYield ?? 0), 0);
    const portfolioYield = data.riskyValue > 0 ? portfolioIncome / data.riskyValue : 0;

    const payers: PayerRow[] = funds
      .filter((f) => (f.dividendYield ?? 0) > 0)
      .map((f) => ({
        ticker: f.ticker,
        yield: f.dividendYield ?? 0,
        annualIncome: f.value * (f.dividendYield ?? 0),
        nextExDate: f.nextDividend?.exDate ?? null,
      }))
      .sort((a, b) => b.annualIncome - a.annualIncome);

    const upcoming: UpcomingDividend[] = [];
    for (const f of funds) {
      const nd = f.nextDividend;
      if (!nd) continue;
      upcoming.push({
        ticker: f.ticker,
        exDate: nd.exDate,
        payDate: nd.payDate,
        estPayment: (nd.amountPerShare ?? 0) * f.shares,
      });
    }
    upcoming.sort((a, b) => a.exDate.localeCompare(b.exDate));

    return {
      portfolioIncome,
      portfolioYield,
      invested: data.riskyValue,
      payers,
      upcoming,
      nextEx: upcoming.length > 0 ? upcoming[0] : null,
      payerCount: payers.length,
      totalHoldings: funds.length,
    };
  }, [data]);

  // Compounding projection: reinvested (DRIP) vs. taken as cash.
  const projection = useMemo(() => {
    if (!model || model.invested <= 0 || model.portfolioIncome <= 0) return null;
    const y = model.portfolioYield;
    const g = growthPct / 100;

    let vDrip = model.invested;
    let vCash = model.invested;
    let cumDrip = 0;
    let cumCash = 0;
    const dripCum = [0];
    const cashCum = [0];
    const dripVal = [vDrip];
    const cashVal = [vCash];
    const rows: { year: number; value: number; income: number; cumDrip: number; cumCash: number }[] = [];

    for (let t = 1; t <= years; t++) {
      const incDrip = vDrip * y; // dividends earned this year on the reinvested balance
      const incCash = vCash * y;
      cumDrip += incDrip;
      cumCash += incCash;
      vDrip = vDrip * (1 + g) + incDrip; // price growth + dividends reinvested
      vCash = vCash * (1 + g); // price growth only; dividends withdrawn
      dripCum.push(cumDrip);
      cashCum.push(cumCash);
      dripVal.push(vDrip);
      cashVal.push(vCash);
      rows.push({ year: t, value: vDrip, income: incDrip, cumDrip, cumCash });
    }

    return {
      dripCum,
      cashCum,
      dripVal,
      cashVal,
      rows,
      endValue: vDrip,
      endValueCash: vCash,
      totalDrip: cumDrip,
      totalCash: cumCash,
      boost: cumDrip - cumCash,
    };
  }, [model, years, growthPct]);

  return (
    <ToolShell
      category="Income"
      title="Dividend Forecaster"
      subtitle="Projected forward income and yield today, plus how reinvested dividends compound over a horizon of your choosing."
      asOf={data?.asOf}
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={retry} />
      ) : !model ? (
        <EmptyBlock
          title="No holdings to forecast dividends for."
          hint="This tool needs at least one priceable equity or ETF holding. Cash, options, futures, and individual bonds are excluded."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <StatRow>
            <Stat
              label="Projected annual income"
              value={<Sensitive>{formatCurrencyCompact(model.portfolioIncome)}</Sensitive>}
              tone="positive"
              sub="forward, at current yields"
            />
            <Stat label="Portfolio yield" value={formatPercent(model.portfolioYield * 100, false)} sub="income ÷ invested value" />
            <Stat
              label="Next ex-date"
              value={model.nextEx ? fmtDate(model.nextEx.exDate) : "—"}
              sub={model.nextEx ? model.nextEx.ticker : "none scheduled"}
            />
            <Stat label="Dividend payers" value={model.payerCount} sub={`of ${model.totalHoldings} holdings`} />
          </StatRow>

          {/* ── Compounding projection ── */}
          {projection ? (
            <Panel
              title="Compounding projection"
              right={
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex gap-1.5">
                    {HORIZONS.map((h) => (
                      <Pill key={h} active={years === h} onClick={() => setYears(h)}>
                        {h}y
                      </Pill>
                    ))}
                  </div>
                  <PercentInput label="Growth" value={growthPct} onChange={setGrowthPct} />
                </div>
              }
            >
              <div className="mb-3 flex items-center gap-1 rounded-md border border-border bg-[oklch(0.16_0_0)] p-0.5 w-fit">
                <Toggle active={view === "income"} onClick={() => setView("income")}>
                  Cumulative dividends
                </Toggle>
                <Toggle active={view === "value"} onClick={() => setView("value")}>
                  Portfolio value
                </Toggle>
              </div>

              <LineChart
                height={260}
                baseline={view === "income" ? 0 : undefined}
                showEndDot
                yFormat={(n) => (hidden ? MONEY_MASK : formatCurrencyCompact(n))}
                series={
                  view === "income"
                    ? [
                        { name: "Reinvested", color: CHART.amber, values: projection.dripCum, fill: CHART.amberFill },
                        { name: "Taken as cash", color: CHART.steel, values: projection.cashCum, dashed: true },
                      ]
                    : [
                        { name: "Reinvested", color: CHART.amber, values: projection.dripVal, fill: CHART.amberFill },
                        { name: "Taken as cash", color: CHART.steel, values: projection.cashVal, dashed: true },
                      ]
                }
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <Legend
                  items={[
                    { label: "Dividends reinvested (DRIP)", color: CHART.amber },
                    { label: "Dividends taken as cash", color: CHART.steel },
                  ]}
                />
                <span className="font-mono text-[11px] tabular-nums" style={{ color: CHART.muted }}>
                  year 0 → {years} · {growthPct}% price growth · {formatPercent(model.portfolioYield * 100, false)} yield
                </span>
              </div>

              <div className="mt-4">
                <StatRow>
                  <Stat
                    label={`${years}y dividends · reinvested`}
                    value={<Sensitive>{formatCurrencyCompact(projection.totalDrip)}</Sensitive>}
                    tone="positive"
                  />
                  <Stat label={`${years}y dividends · as cash`} value={<Sensitive>{formatCurrencyCompact(projection.totalCash)}</Sensitive>} tone="muted" />
                  <Stat
                    label="Compounding boost"
                    value={<Sensitive>{formatCurrencyCompact(projection.boost)}</Sensitive>}
                    tone="positive"
                    sub="extra from reinvesting"
                  />
                  <Stat label="Ending value · reinvested" value={<Sensitive>{formatCurrencyCompact(projection.endValue)}</Sensitive>} sub={`from ${formatCurrencyCompact(model.invested)}`} />
                </StatRow>
              </div>
            </Panel>
          ) : (
            <Panel title="Compounding projection">
              <p className="m-0 text-[12.5px] text-muted-foreground">
                None of your holdings currently report a dividend yield, so there&apos;s no income stream to compound.
              </p>
            </Panel>
          )}

          {projection && (
            <Panel title="Year by year · reinvested">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-[12.5px]">
                  <thead>
                    <tr className="text-left" style={{ color: CHART.muted }}>
                      <th className="pb-2 font-medium">Year</th>
                      <th className="pb-2 text-right font-medium">Portfolio value</th>
                      <th className="pb-2 text-right font-medium">Dividends that year</th>
                      <th className="pb-2 text-right font-medium">Cumulative (DRIP)</th>
                      <th className="pb-2 text-right font-medium">Cumulative (cash)</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {projection.rows.map((r) => (
                      <tr key={r.year} className="border-t border-border">
                        <td className="py-1.5 font-sans">Year {r.year}</td>
                        <td className="py-1.5 text-right"><Sensitive>{formatCurrency(r.value)}</Sensitive></td>
                        <td className="py-1.5 text-right"><Sensitive>{formatCurrency(r.income)}</Sensitive></td>
                        <td className="py-1.5 text-right" style={{ color: CHART.positive }}><Sensitive>{formatCurrency(r.cumDrip)}</Sensitive></td>
                        <td className="py-1.5 text-right" style={{ color: CHART.muted }}><Sensitive>{formatCurrency(r.cumCash)}</Sensitive></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {/* ── Current snapshot ── */}
          <Panel title="Income by holding">
            {model.payers.length === 0 ? (
              <p className="m-0 text-[12.5px] text-muted-foreground">None of your holdings currently report a dividend yield.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[440px] text-[12.5px]">
                  <thead>
                    <tr className="text-left" style={{ color: CHART.muted }}>
                      <th className="pb-2 font-medium">Ticker</th>
                      <th className="pb-2 text-right font-medium">Yield</th>
                      <th className="pb-2 text-right font-medium">Annual income</th>
                      <th className="pb-2 text-right font-medium">Next ex-date</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {model.payers.map((p) => (
                      <tr key={p.ticker} className="border-t border-border">
                        <td className="py-1.5 font-sans font-medium">{p.ticker}</td>
                        <td className="py-1.5 text-right">{formatPercent(p.yield * 100, false)}</td>
                        <td className="py-1.5 text-right"><Sensitive>{formatCurrency(p.annualIncome)}</Sensitive></td>
                        <td className="py-1.5 text-right" style={{ color: CHART.muted }}>{p.nextExDate ? fmtDate(p.nextExDate) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Upcoming ex-dates">
            {model.upcoming.length === 0 ? (
              <p className="m-0 text-[12.5px] text-muted-foreground">No upcoming ex-dates are scheduled for your holdings.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[440px] text-[12.5px]">
                  <thead>
                    <tr className="text-left" style={{ color: CHART.muted }}>
                      <th className="pb-2 font-medium">Ex-date</th>
                      <th className="pb-2 font-medium">Ticker</th>
                      <th className="pb-2 text-right font-medium">Est. payment</th>
                      <th className="pb-2 text-right font-medium">Pay date</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {model.upcoming.map((u) => (
                      <tr key={`${u.ticker}-${u.exDate}`} className="border-t border-border">
                        <td className="py-1.5">{fmtDate(u.exDate)}</td>
                        <td className="py-1.5 font-sans font-medium">{u.ticker}</td>
                        <td className="py-1.5 text-right"><Sensitive>{formatCurrency(u.estPayment)}</Sensitive></td>
                        <td className="py-1.5 text-right" style={{ color: CHART.muted }}>{u.payDate ? fmtDate(u.payDate) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <MethodologyNote>
            <p>
              The snapshot at top is yield-based: forward annual income for each holding is its current market value ×
              its trailing dividend yield, summed; portfolio yield is total projected income ÷ your invested (non-cash)
              market value.
            </p>
            <p>
              The compounding projection grows your invested value at the price-growth rate you set ({growthPct}% a year)
              and holds the portfolio yield constant at today&apos;s {formatPercent(model.portfolioYield * 100, false)}.
              In the <strong>reinvested</strong> path, each year&apos;s dividends buy more (so the balance compounds at
              roughly growth + yield and income keeps rising); in the <strong>taken as cash</strong> path the balance
              grows on price alone and dividends are withdrawn. The gap between the two cumulative-income curves is the
              &quot;compounding boost&quot; — the extra income reinvestment produces. Holding yield constant means
              dividend raises are captured implicitly (a payout rising with price).
            </p>
            <p>
              This is a smooth, deterministic model — it assumes a constant growth rate and yield, ignores volatility,
              dividend cuts or suspensions, taxes and withholding, fees, and any change in your holdings. Long horizons
              are illustrative, not a forecast. Ex-dates and per-share amounts come from Yahoo (next scheduled dividend
              per ticker only).
            </p>
          </MethodologyNote>
        </div>
      )}
    </ToolShell>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-[12px] transition-colors duration-150",
        active
          ? "border-[oklch(0.72_0.14_74_/_0.5)] bg-[oklch(0.72_0.14_74_/_0.13)] text-primary"
          : "border-border bg-card text-muted-foreground hover:border-[oklch(0.28_0_0)] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-150",
        active ? "bg-primary text-[oklch(0.08_0_0)]" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PercentInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.08em]" style={{ color: CHART.muted }}>{label}</span>
      <div className="flex items-center rounded-sm border border-border bg-background focus-within:border-[oklch(0.72_0.14_74_/_0.5)]">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={30}
          step={0.5}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(Number.isFinite(n) && n >= 0 ? Math.min(30, n) : 0);
          }}
          aria-label={`${label} rate percent`}
          className="w-14 bg-transparent py-1 pl-2 text-right font-mono text-[12px] tabular-nums text-foreground outline-none"
        />
        <span className="pr-2 text-[11px]" style={{ color: CHART.muted }}>%</span>
      </div>
    </label>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-4">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: CHART.muted }}>
          <span className="h-2 w-4 rounded-full" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
