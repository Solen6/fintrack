"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCurrency, formatPercent } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";
import { planRebalance, TRADE_EPS, type RebalanceMode } from "@/lib/rebalance";
import type { AnalysisHistoryResponse } from "@/lib/analytics/api-types";
import {
  ToolShell,
  Panel,
  Stat,
  StatRow,
  MiniButton,
  LoadingBlock,
  ErrorBlock,
  EmptyBlock,
  MethodologyNote,
} from "../ui";
import { useAnalysisData } from "../useAnalysisData";
import { HBarList, CHART } from "../charts";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Reads a money input, treating blank/garbage/negative as nothing entered. */
function parseMoney(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

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
      subtitle="See how far each account has drifted from its own target weights — measured as a share of that account, cash included — and the exact buys and sells that bring it back in line. Add a deposit or put idle cash to work and the plan tells you where the money should go. Every account keeps its own targets."
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
              Each account above is its own sleeve, rebalanced independently. Every percentage is a
              share of that account&apos;s <em>total</em> value — invested holdings plus cash — so
              the columns always add up to the whole account.
            </p>
            <p>
              <strong>The two numbers in the Target column.</strong> The box is what you type: a
              share of the invested sleeve, read <em>relative to the other entries</em>, so the
              column doesn&apos;t have to add to 100 by hand. The smaller figure beneath it is what
              that works out to as a percent of the whole account — the column normalized to sum to
              100 within the sleeve, then scaled down by whatever share of the account is left
              sitting in cash. <strong>That lower figure is the real target</strong>: Drift and
              After&nbsp;% are both measured against it, and the trades aim at it. The two match
              only by coincidence — they line up exactly when your targets are still the current
              weights and no cash is being moved, and they separate as soon as either changes.{" "}
              <em>
                In particular, investing cash raises every holding&apos;s target: the money goes
                into securities and not into cash, so the invested sleeve becomes a larger share of
                the account and each target rises with it.
              </em>{" "}
              Drift is current&nbsp;% − target&nbsp;%, and the trade for a holding is the dollar
              move that lands it on that target: positive is a buy, negative a sell. Turnover is the
              larger of total buys and total sells (the one-way figure), and a move under $
              {TRADE_EPS.toFixed(0)} is treated as no trade.
            </p>
            <p>
              <strong>Cash.</strong> Cash is never a target — it&apos;s what funds the plan. A{" "}
              <strong>deposit</strong> is money arriving in the account: it counts as cash from the
              moment you enter it, which is why the cash row swells and every holding&apos;s current
              % dilutes before a single trade is placed. <strong>Idle cash</strong> is the balance
              already sitting there, and only the amount you ask for is put to work — the rest stays
              in cash. In <strong>buy only</strong> mode nothing is sold: the cash goes to the most
              underweight holdings first and keeps filling until it runs out, which is usually what
              you want for a deposit but can leave the most overweight names above target, shown as
              a non-zero drift after. <strong>Buy &amp; sell</strong> spends the same cash but also
              sells whatever is overweight, landing every holding exactly on target. With no deposit
              and no idle cash deployed, both modes are the same straight rebalance of what&apos;s
              already invested.
            </p>
            <p>
              Assumptions and limits: each account&apos;s targets persist only once you click{" "}
              <strong>Save targets</strong> for that account — edits before that are local to the
              browser tab and are lost on reload. Deposit and idle-cash amounts are never saved;
              they are planning inputs and reset on reload. Trades are computed against a single
              snapshot of value; execution prices, transaction costs, bid/ask spreads, taxes on
              realized gains, wash-sale rules, tax lots, and fractional-share or round-lot
              constraints are <strong>not</strong> modeled, and nothing moves between accounts.
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

  // Cash to put to work. Kept as raw strings so the fields can be cleared
  // rather than snapping back to 0, and deliberately NOT persisted — a
  // deposit is a one-off planning input, unlike the targets.
  const [depositRaw, setDepositRaw] = useState("");
  const [idleRaw, setIdleRaw] = useState("");
  const [mode, setMode] = useState<RebalanceMode>("buy-only");

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

  const cashOnHand = data?.cash ?? 0;
  const deposit = parseMoney(depositRaw);
  const idleDeploy = Math.min(parseMoney(idleRaw), cashOnHand);
  const hasCash = deposit + idleDeploy > 0;

  const model = useMemo(() => {
    if (!data || data.empty || data.assets.length === 0) return null;
    return planRebalance({
      holdings: data.assets.map((a) => ({
        ticker: a.ticker,
        name: a.name,
        value: a.value,
        targetShown: targets[a.ticker] ?? round2(a.weightWithCash * 100),
      })),
      cash: data.cash,
      deposit,
      idleDeploy,
      // With nothing to deploy the two modes are identical; pinning to `both`
      // keeps a stale buy-only toggle from silently blanking every trade once
      // the cash fields are cleared.
      mode: hasCash ? mode : "both",
    });
  }, [data, targets, deposit, idleDeploy, hasCash, mode]);

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
          <Panel title="Cash to put to work">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <MoneyField
                label="Deposit"
                hint="new money into this account"
                value={depositRaw}
                onChange={setDepositRaw}
                ariaLabel={`Deposit into ${account}`}
              />
              <MoneyField
                label="Idle cash to invest"
                hint={
                  cashOnHand > 0 ? (
                    <>
                      <Sensitive>{formatCurrency(cashOnHand)}</Sensitive> on hand
                    </>
                  ) : (
                    "no cash in this account"
                  )
                }
                value={idleRaw}
                onChange={setIdleRaw}
                disabled={cashOnHand <= 0}
                ariaLabel={`Idle cash to invest in ${account}`}
                action={
                  cashOnHand > 0 ? (
                    <MiniButton onClick={() => setIdleRaw(String(round2(cashOnHand)))}>
                      All
                    </MiniButton>
                  ) : undefined
                }
              />
              {hasCash && (
                <div className="flex flex-col gap-1.5">
                  <span
                    className="text-[10px] uppercase tracking-[0.08em]"
                    style={{ color: CHART.muted }}
                  >
                    Trades
                  </span>
                  <div className="flex gap-1.5">
                    <MiniButton primary={mode === "buy-only"} onClick={() => setMode("buy-only")}>
                      Buy only
                    </MiniButton>
                    <MiniButton primary={mode === "both"} onClick={() => setMode("both")}>
                      Buy &amp; sell
                    </MiniButton>
                  </div>
                </div>
              )}
            </div>
            <p className="mt-3.5 text-[11.5px] leading-relaxed" style={{ color: CHART.muted }}>
              {hasCash ? (
                <>
                  Putting <Sensitive>{formatCurrency(model.cashToInvest)}</Sensitive> to work
                  {deposit > 0 && idleDeploy > 0 && (
                    <>
                      {" "}
                      (<Sensitive>{formatCurrency(deposit)}</Sensitive> new +{" "}
                      <Sensitive>{formatCurrency(idleDeploy)}</Sensitive> idle)
                    </>
                  )}
                  .{" "}
                  {mode === "buy-only"
                    ? "Nothing is sold — it goes to the most underweight holdings first."
                    : "Overweight holdings are sold down so every target is hit exactly."}{" "}
                  <Sensitive>{formatCurrency(model.cashAfter)}</Sensitive> stays in cash.
                </>
              ) : cashOnHand > 0 ? (
                <>
                  Nothing in the plan yet — the trades below only shuffle what&apos;s already
                  invested. Enter a deposit, or put some of the{" "}
                  <Sensitive>{formatCurrency(cashOnHand)}</Sensitive> idle cash to work, and the
                  plan will tell you where it should go.
                </>
              ) : (
                <>
                  This account holds no cash. Enter a deposit to see how new money should be
                  distributed across your targets.
                </>
              )}
            </p>
          </Panel>

          <div className="flex justify-end">
            <span className="font-mono text-[11.5px] tabular-nums" style={{ color: CHART.muted }}>
              targets sum: {model.targetSum.toFixed(1)}%
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
              sub={`of ${model.rows.length} holdings`}
            />
            <Stat
              label="Turnover"
              value={<Sensitive>{formatCurrency(model.turnover)}</Sensitive>}
              sub="one-way $ traded"
            />
            {hasCash && (
              <>
                <Stat
                  label="Cash deployed"
                  value={<Sensitive>{formatCurrency(model.cashDeployed)}</Sensitive>}
                  sub={<><Sensitive>{formatCurrency(model.cashAfter)}</Sensitive> left in cash</>}
                />
                <Stat
                  label="Drift after"
                  value={formatPercent(model.maxDriftAfter, false)}
                  sub="largest gap once traded"
                  tone={model.maxDriftAfter > 0.05 ? "default" : "muted"}
                />
              </>
            )}
          </StatRow>

          <Panel title="Targets & trades">
            <div className="overflow-x-auto">
              <table
                className="w-full text-[12.5px]"
                style={{ minWidth: hasCash ? 620 : 520 }}
              >
                <thead>
                  <tr className="text-left" style={{ color: CHART.muted }}>
                    <th className="pb-2 font-medium">Ticker</th>
                    <th className="pb-2 text-right font-medium">Current %</th>
                    <th className="pb-2 text-right font-medium">Target %</th>
                    <th className="pb-2 text-right font-medium">Drift</th>
                    <th className="pb-2 text-right font-medium">Trade</th>
                    {hasCash && <th className="pb-2 text-right font-medium">After %</th>}
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
                    const onTarget = Math.abs(r.driftAfterPct) < 0.05;
                    return (
                      <tr key={r.ticker} className="border-t border-border">
                        <td className="py-1.5 font-sans font-medium" title={r.name}>
                          {r.ticker}
                        </td>
                        <td className="py-1.5 text-right">
                          {formatPercent(r.currentPct, false)}
                        </td>
                        <td className="py-1.5 text-right">
                          <div className="flex flex-col items-end gap-0.5">
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
                            {/* What the typed number actually works out to once
                                it's normalized against the other entries and
                                measured against the whole account — the figure
                                Current %, Drift and After % are all compared to.
                                Only equals the input by coincidence. */}
                            <span
                              className="text-[10.5px]"
                              style={{ color: CHART.muted }}
                              title={`${r.ticker}'s target as a share of the whole account, after normalizing the column (which sums to ${model.targetSum.toFixed(1)}) and setting aside the cash that isn't being invested. This is what Drift and After % measure against.`}
                            >
                              = {formatPercent(r.targetPct, false)}
                            </span>
                          </div>
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
                        {hasCash && (
                          <td
                            className="py-1.5 text-right"
                            // On target is the expected outcome, so it recedes;
                            // a name buy-only couldn't sell down stays legible.
                            style={onTarget ? { color: CHART.muted } : undefined}
                            title={
                              onTarget
                                ? "Lands on target"
                                : `Still ${formatPercent(r.driftAfterPct)} from target — buy only can't sell it down`
                            }
                          >
                            {formatPercent(r.afterPct, false)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {model.cashNow > 0 && (
                    <tr className="border-t border-border">
                      <td className="py-1.5 font-sans font-medium">Cash</td>
                      <td className="py-1.5 text-right">{formatPercent(model.cashPct, false)}</td>
                      <td className="py-1.5 text-right" style={{ color: CHART.muted }}>—</td>
                      <td className="py-1.5 text-right" style={{ color: CHART.muted }}>—</td>
                      <td className="py-1.5 text-right">
                        {model.cashDeployed > TRADE_EPS ? (
                          <span style={{ color: CHART.negative }}>
                            <Sensitive>{`−${formatCurrency(model.cashDeployed)}`}</Sensitive>
                          </span>
                        ) : (
                          <span style={{ color: CHART.muted }}>—</span>
                        )}
                      </td>
                      {hasCash && (
                        <td className="py-1.5 text-right" style={{ color: CHART.muted }}>
                          {formatPercent(model.cashPctAfter, false)}
                        </td>
                      )}
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

function MoneyField({
  label,
  hint,
  value,
  onChange,
  disabled,
  action,
  ariaLabel,
}: {
  label: string;
  hint: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  action?: React.ReactNode;
  ariaLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.08em]" style={{ color: CHART.muted }}>
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        <div className="relative">
          <span
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[12px]"
            style={{ color: CHART.muted }}
          >
            $
          </span>
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="0"
            aria-label={ariaLabel}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="w-32 rounded-sm border border-border bg-card py-1 pl-5 pr-2 text-right font-mono text-[12px] tabular-nums outline-none focus:border-[oklch(0.72_0.14_74_/_0.5)] disabled:opacity-40"
          />
        </div>
        {action}
      </div>
      <span className="text-[10.5px]" style={{ color: CHART.muted }}>
        {hint}
      </span>
    </div>
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
