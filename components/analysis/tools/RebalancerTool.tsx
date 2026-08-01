"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCurrency, formatPercent } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";
import type { AnalysisHistoryResponse } from "@/lib/analytics/api-types";
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
import { HBarList, CHART } from "../charts";

/** Trades smaller than this (in dollars) are treated as noise, not a trade. */
const TRADE_EPS = 1;

const round2 = (n: number) => Math.round(n * 100) / 100;

interface RawHolding {
  account: string;
  instrument_type: string | null;
  bond_type: string | null;
}

/** Same priceable-sleeve filter /api/analysis/history applies server-side
    (equities + bond ETFs; no options/futures/individual bonds) — used here
    only to decide which accounts get a section at all. */
function isRebalanceable(h: RawHolding): boolean {
  const it = h.instrument_type ?? "equity";
  if (it === "option" || it === "future") return false;
  if (it === "bond" && h.bond_type !== "etf") return false;
  return true;
}

export function RebalancerTool() {
  // The account list itself (not any account's holdings) — each account gets
  // its own independent section below, each with its own data fetch and its
  // own saved targets. null = still loading.
  const [accounts, setAccounts] = useState<string[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/holdings")
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        const rows = (json.holdings ?? []) as RawHolding[];
        const names = new Set<string>();
        for (const h of rows) {
          if (h.account && isRebalanceable(h)) names.add(h.account);
        }
        setAccounts([...names].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {
        if (alive) setAccountsError("Couldn't load accounts");
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <ToolShell
      category="Allocation"
      title="Rebalancer"
      subtitle="See how far each account has drifted from its own target weights — measured as a share of that account, cash included — and the exact buys and sells that bring its invested sleeve back in line. Every account keeps its own targets."
    >
      {accounts === null ? (
        accountsError ? <ErrorBlock message={accountsError} /> : <LoadingBlock />
      ) : accounts.length === 0 ? (
        <EmptyBlock
          title="No priceable holdings to rebalance."
          hint="The rebalancer needs at least one equity or ETF position in an account's invested sleeve. Cash accounts, options, futures, and individual bonds are excluded."
        />
      ) : (
        <div className="flex flex-col gap-8">
          {accounts.map((account) => (
            <AccountRebalancePanel key={account} account={account} />
          ))}

          <MethodologyNote>
            <p>
              Each account above is its own sleeve, rebalanced independently — its Current % is
              that holding&apos;s value ÷ that account&apos;s total value (invested holdings + cash),
              and its Target % is what you type for that account, normalized to sum to 100{" "}
              <em>within that account&apos;s invested sleeve</em> and then scaled down by whatever
              share of the account sits in cash, since cash is never reallocated — Cash is shown as
              its own row with its current % for reference, but it has no target and isn&apos;t part
              of the drift/trade math. Drift is current&nbsp;% − scaled-target&nbsp;%. The trade for
              a holding is the dollar move that lands it on its target within the sleeve —
              (sleeve-target − current) × invested value — where a positive figure is a buy and a
              negative one a sell. Turnover is the sum of the absolute trades divided by two (buys
              and sells net out), and a move under ${TRADE_EPS.toFixed(0)} is treated as no trade.
            </p>
            <p>
              Assumptions and limits: each account&apos;s targets persist only once you click{" "}
              <strong>Save targets</strong> for that account — edits before that are local to the
              browser tab and are lost on reload. Trades are computed against a single snapshot of
              the invested value; execution prices, transaction costs, bid/ask spreads, taxes on
              realized gains, wash-sale rules, tax lots, and fractional-share or round-lot
              constraints are <strong>not</strong> modeled. Cash is not reallocated: the cash sleeve
              neither funds buys nor absorbs sells, so the plan rebalances only the priceable
              holdings within each account among themselves — nothing moves between accounts.
              Options, futures, and individual bonds are excluded.
            </p>
          </MethodologyNote>
        </div>
      )}
    </ToolShell>
  );
}

function AccountRebalancePanel({ account }: { account: string }) {
  const { data, loading, error, retry } = useAnalysisData<AnalysisHistoryResponse>(
    `/api/analysis/history?days=365&account=${encodeURIComponent(account)}`,
  );

  // Target weights (percent) keyed by ticker, scoped to this account. Seeded
  // from this account's saved targets (once loaded) falling back to each
  // holding's current weight for any ticker with no saved value, so there's
  // no flash and new holdings default sensibly. `savedTargets === null` means
  // "still loading" — seeding waits for it so a saved value never gets
  // clobbered by the current-weight fallback racing ahead of the fetch.
  const [targets, setTargets] = useState<Record<string, number>>({});
  const [savedTargets, setSavedTargets] = useState<Record<string, number> | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSavedTargets(null);
    fetch(`/api/analysis/rebalance-targets?account=${encodeURIComponent(account)}`)
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (alive) setSavedTargets(json?.targets ?? {});
      })
      .catch(() => {
        if (alive) setSavedTargets({});
      });
    return () => {
      alive = false;
    };
  }, [account]);

  useEffect(() => {
    if (!data || data.empty || data.assets.length === 0) return;
    if (savedTargets === null) return;
    const init: Record<string, number> = {};
    for (const a of data.assets) {
      init[a.ticker] = savedTargets[a.ticker] ?? round2(a.weightWithCash * 100);
    }
    setTargets(init);
  }, [data, savedTargets]);

  const saveTargets = async () => {
    setSaveState("saving");
    setSaveError(null);
    try {
      const res = await fetch("/api/analysis/rebalance-targets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, targets }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
      setSavedTargets(json.targets ?? targets);
      setSaveState("saved");
    } catch (e) {
      setSaveState("error");
      setSaveError(e instanceof Error ? e.message : "Failed to save");
    }
  };

  const model = useMemo(() => {
    if (!data || data.empty || data.assets.length === 0) return null;
    const assets = data.assets;
    const riskyValue = data.riskyValue;
    const cash = data.cash;
    const totalValue = riskyValue + cash;
    // Share of the account that's even eligible for reallocation — cash is
    // pinned (never traded), so a sleeve target of 100% still only ever
    // claims this fraction of the account. Keeps Current %/Target % on the
    // same "% of account (incl. cash)" basis as everywhere else.
    const riskyFraction = totalValue > 0 ? riskyValue / totalValue : 0;
    const cashPct = totalValue > 0 ? (cash / totalValue) * 100 : 0;

    const withTarget = assets.map((a) => ({
      ticker: a.ticker,
      name: a.name,
      weightWithCash: a.weightWithCash,
      value: a.value,
      targetShown: targets[a.ticker] ?? round2(a.weightWithCash * 100),
    }));

    // Normalize entered targets to sum 100 WITHIN the sleeve (so the numbers
    // need not be balanced by hand), then scale that sleeve fraction down by
    // riskyFraction to express it as a % of the whole account.
    const sum = withTarget.reduce((s, r) => s + r.targetShown, 0);

    const rows = withTarget
      .map((r) => {
        const currentPct = r.weightWithCash * 100;
        const sleeveFrac = sum > 0 ? r.targetShown / sum : 0;
        const targetPct = sleeveFrac * riskyFraction * 100;
        const driftPct = currentPct - targetPct;
        const tradeDollar = sleeveFrac * riskyValue - r.value; // + buy / − sell
        return {
          ticker: r.ticker,
          name: r.name,
          currentPct,
          targetShown: r.targetShown,
          targetPct,
          driftPct,
          tradeDollar,
        };
      })
      .sort((x, y) => y.currentPct - x.currentPct);

    const maxDrift = rows.reduce((m, r) => Math.max(m, Math.abs(r.driftPct)), 0);
    const nTrades = rows.filter((r) => Math.abs(r.tradeDollar) > TRADE_EPS).length;
    const turnover = rows.reduce((s, r) => s + Math.abs(r.tradeDollar), 0) / 2;

    return { rows, sum, maxDrift, nTrades, turnover, count: rows.length, cash, cashPct };
  }, [data, targets]);

  const onTargetChange = (ticker: string, raw: string) => {
    const v = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(v)) return;
    setTargets((t) => ({ ...t, [ticker]: Math.max(0, v) }));
    setSaveState("idle");
  };

  const resetToCurrent = () => {
    if (!data) return;
    const next: Record<string, number> = {};
    for (const a of data.assets) next[a.ticker] = round2(a.weightWithCash * 100);
    setTargets(next);
    setSaveState("idle");
  };

  const equalWeight = () => {
    if (!data || data.assets.length === 0) return;
    const per = round2(100 / data.assets.length);
    const next: Record<string, number> = {};
    for (const a of data.assets) next[a.ticker] = per;
    setTargets(next);
    setSaveState("idle");
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2.5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[15px] font-semibold text-foreground">{account}</h2>
          {data?.asOf && (
            <span className="font-mono text-[11px] tabular-nums" style={{ color: CHART.muted }}>
              as of {data.asOf}
            </span>
          )}
        </div>
        {model && (
          <div className="flex flex-wrap items-center gap-2">
            <ToolbarButton onClick={resetToCurrent}>Reset to current</ToolbarButton>
            <ToolbarButton onClick={equalWeight}>Equal weight</ToolbarButton>
            <ToolbarButton onClick={saveTargets} disabled={saveState === "saving"}>
              {saveState === "saving" ? "Saving…" : "Save targets"}
            </ToolbarButton>
            {saveState === "saved" && (
              <span className="text-[11.5px]" style={{ color: CHART.positive }}>Saved</span>
            )}
            {saveState === "error" && (
              <span className="text-[11.5px]" style={{ color: CHART.negative }}>{saveError}</span>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} onRetry={retry} />
      ) : !model ? (
        <EmptyBlock
          title="No priceable holdings in this account."
          hint="The rebalancer needs at least one equity or ETF position. Options, futures, and individual bonds are excluded."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            <span className="font-mono text-[11.5px] tabular-nums" style={{ color: CHART.muted }}>
              targets sum: {model.sum.toFixed(1)}%
            </span>
          </div>

          <StatRow>
            <Stat
              label="Max drift"
              value={formatPercent(model.maxDrift, false)}
              sub="largest gap to target"
            />
            <Stat
              label="Trades needed"
              value={model.nTrades}
              sub={`of ${model.count} holdings`}
            />
            <Stat
              label="Turnover"
              value={<Sensitive>{formatCurrency(model.turnover)}</Sensitive>}
              sub="one-way $ traded"
            />
          </StatRow>

          <Panel title="Targets & trades">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-[12.5px]">
                <thead>
                  <tr className="text-left" style={{ color: CHART.muted }}>
                    <th className="pb-2 font-medium">Ticker</th>
                    <th className="pb-2 text-right font-medium">Current %</th>
                    <th className="pb-2 text-right font-medium">Target %</th>
                    <th className="pb-2 text-right font-medium">Drift</th>
                    <th className="pb-2 text-right font-medium">Trade</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {model.rows.map((r) => {
                    const driftColor =
                      Math.abs(r.driftPct) < 0.05
                        ? CHART.muted
                        : r.driftPct > 0
                          ? CHART.negative
                          : CHART.positive;
                    const isTrade = Math.abs(r.tradeDollar) > TRADE_EPS;
                    return (
                      <tr key={r.ticker} className="border-t border-border">
                        <td className="py-1.5 font-sans font-medium" title={r.name}>
                          {r.ticker}
                        </td>
                        <td className="py-1.5 text-right">
                          {formatPercent(r.currentPct, false)}
                        </td>
                        <td className="py-1.5 text-right">
                          <input
                            type="number"
                            min={0}
                            step="0.1"
                            inputMode="decimal"
                            aria-label={`Target weight for ${r.ticker} in ${account}`}
                            value={r.targetShown}
                            onChange={(e) => onTargetChange(r.ticker, e.target.value)}
                            className="w-20 rounded-sm border border-border bg-card px-2 py-1 text-right font-mono text-[12px] tabular-nums outline-none focus:border-[oklch(0.72_0.14_74_/_0.5)]"
                          />
                        </td>
                        <td className="py-1.5 text-right" style={{ color: driftColor }}>
                          {formatPercent(r.driftPct)}
                        </td>
                        <td className="py-1.5 text-right">
                          {isTrade ? (
                            <span
                              style={{ color: r.tradeDollar >= 0 ? CHART.positive : CHART.negative }}
                            >
                              <Sensitive>
                                {`${r.tradeDollar >= 0 ? "+" : ""}${formatCurrency(r.tradeDollar)}`}
                              </Sensitive>
                            </span>
                          ) : (
                            <span style={{ color: CHART.muted }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {model.cash > 0 && (
                    <tr className="border-t border-border">
                      <td className="py-1.5 font-sans font-medium">Cash</td>
                      <td className="py-1.5 text-right">{formatPercent(model.cashPct, false)}</td>
                      <td className="py-1.5 text-right" style={{ color: CHART.muted }}>—</td>
                      <td className="py-1.5 text-right" style={{ color: CHART.muted }}>—</td>
                      <td className="py-1.5 text-right" style={{ color: CHART.muted }}>—</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Drift by holding">
            <HBarList
              signed
              formatValue={(n) => formatPercent(n)}
              items={model.rows.map((r) => ({
                label: r.ticker,
                value: r.driftPct,
                color: r.driftPct >= 0 ? CHART.negative : CHART.positive,
              }))}
            />
            <Legend
              items={[
                { label: "Underweight → buy", color: CHART.positive },
                { label: "Overweight → sell", color: CHART.negative },
              ]}
            />
          </Panel>
        </div>
      )}
    </section>
  );
}

function ToolbarButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-sm border border-border bg-card px-3 py-1.5 text-[12px] text-foreground transition-colors duration-150 hover:border-[oklch(0.28_0_0)] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-4">
      {items.map((it) => (
        <span
          key={it.label}
          className="inline-flex items-center gap-1.5 text-[11.5px]"
          style={{ color: CHART.muted }}
        >
          <span className="h-2 w-4 rounded-full" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
