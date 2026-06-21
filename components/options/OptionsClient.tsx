"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChainResponse } from "@/app/api/options/chain/route";
import { buildLeg, instantiateStrategy, strategyById } from "@/lib/option-strategies";
import {
  aggregatePayoff,
  netGreeks,
  priceAxisMax,
  probabilityOfProfit,
  summarize,
  type Greeks,
  type Leg,
  type PayoffPoint,
  type PayoffSummary,
} from "@/lib/options-math";
import { PayoffChart } from "./PayoffChart";
import { StrategyPicker } from "./StrategyPicker";
import { LegEditor } from "./LegEditor";
import { OptionChainTable } from "./OptionChainTable";

type View = "loading" | "ready" | "error";
type Mode = "strategy" | "custom";

const DEFAULT_STRATEGY = "long-call";

export function OptionsClient() {
  const [holdings, setHoldings] = useState<string[]>([]);
  const [ticker, setTicker] = useState<string>("");
  const [tickerInput, setTickerInput] = useState<string>("");
  const [chain, setChain] = useState<ChainResponse | null>(null);
  const [mode, setMode] = useState<Mode>("strategy");
  const [strategyId, setStrategyId] = useState<string>(DEFAULT_STRATEGY);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [view, setView] = useState<View>("loading");
  const [error, setError] = useState<string>("");
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const loadChain = useCallback(async (t: string, opts: { mode: Mode; stratId: string; expiry?: number }) => {
    setView("loading");
    setError("");
    try {
      const qs = new URLSearchParams({ ticker: t });
      if (opts.expiry) qs.set("expiry", String(opts.expiry));
      const res = await fetch(`/api/options/chain?${qs}`);
      const data: ChainResponse = await res.json();
      if (!res.ok || data.error || !data.strikes?.length) {
        setError(data.error || `No options data for ${t}`);
        setChain(null);
        setView("error");
        return;
      }
      setChain(data);
      // Seed legs from the active strategy; custom mode starts empty.
      if (opts.mode === "strategy") {
        const def = strategyById(opts.stratId) ?? strategyById(DEFAULT_STRATEGY)!;
        setLegs(instantiateStrategy(def, data.strikes, data.spot, data.expiry));
      } else {
        setLegs([]);
      }
      setRefreshedAt(new Date());
      setView("ready");
    } catch {
      setError(`Failed to load options for ${t}`);
      setView("error");
    }
  }, []);

  // Bootstrap: holdings → default ticker → chain.
  useEffect(() => {
    (async () => {
      let first = "AAPL";
      try {
        const res = await fetch("/api/holdings");
        if (res.ok) {
          const { holdings: hs } = await res.json();
          const tickers = [...new Set<string>((hs as Array<{ ticker: string }>).map((h) => h.ticker))].sort();
          setHoldings(tickers);
          if (tickers.length) first = tickers[0];
        }
      } catch {
        /* fall back to AAPL */
      }
      setTicker(first);
      setTickerInput(first);
      loadChain(first, { mode: "strategy", stratId: DEFAULT_STRATEGY });
    })();
  }, [loadChain]);

  const selectStrategy = (id: string) => {
    setStrategyId(id);
    if (chain) {
      const def = strategyById(id)!;
      setLegs(instantiateStrategy(def, chain.strikes, chain.spot, chain.expiry));
    }
  };

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    if (m === "strategy" && chain) {
      const def = strategyById(strategyId)!;
      setLegs(instantiateStrategy(def, chain.strikes, chain.spot, chain.expiry));
    } else {
      setLegs([]); // custom starts from a clean slate; build by clicking the chain
    }
  };

  const submitTicker = (e: React.FormEvent) => {
    e.preventDefault();
    const t = tickerInput.trim().toUpperCase();
    if (!t || t === ticker) return;
    setTicker(t);
    loadChain(t, { mode, stratId: strategyId });
  };

  const pickTicker = (t: string) => {
    setTicker(t);
    setTickerInput(t);
    loadChain(t, { mode, stratId: strategyId });
  };

  const changeExpiry = (expiry: number) => loadChain(ticker, { mode, stratId: strategyId, expiry });

  /* ── custom-mode leg picking (mutates the single `legs` model) ── */
  const toggleLeg = useCallback((strike: number, type: "CALL" | "PUT") => {
    if (!chain) return;
    const t = type.toLowerCase() as "call" | "put";
    setLegs((prev) => {
      const idx = prev.findIndex((l) => l.type === t && l.strike === strike);
      if (idx >= 0) return prev.filter((_, j) => j !== idx);
      const row = chain.strikes.find((r) => r.strike === strike);
      if (!row) return prev;
      return [...prev, buildLeg(t, "long", row, 1, chain.spot, chain.expiry)];
    });
  }, [chain]);

  const flipLeg = useCallback((strike: number, type: "CALL" | "PUT") => {
    const t = type.toLowerCase();
    setLegs((prev) => prev.map((l) => (l.type === t && l.strike === strike ? { ...l, side: l.side === "long" ? "short" : "long" } : l)));
  }, []);

  // Strike→side map so the chain table can show leg dots in either mode.
  const legMap = useMemo(() => {
    const m = new Map<string, "BUY" | "SELL">();
    for (const l of legs) {
      if (l.type !== "stock") m.set(`${l.strike}-${l.type.toUpperCase()}`, l.side === "long" ? "BUY" : "SELL");
    }
    return m;
  }, [legs]);

  /* ── Derived analytics ── */
  const analytics = useMemo(() => {
    if (!chain || legs.length === 0 || !chain.spot) return null;
    const hi = priceAxisMax(legs, chain.spot);
    const points = aggregatePayoff(legs, hi);
    const summary = summarize(legs, points);
    const greeks = netGreeks(legs, chain.spot);
    const optLegs = legs.filter((l) => l.type !== "stock");
    let pop = NaN;
    if (optLegs.length) {
      const sigma = optLegs.reduce((s, l) => s + l.iv, 0) / optLegs.length;
      const T = Math.max((optLegs[0].expiry - Date.now() / 1000) / (365 * 86400), 0);
      pop = probabilityOfProfit(points, chain.spot, sigma, T);
    }
    return { points, summary, greeks, pop };
  }, [chain, legs]);

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-3 border-b border-border shrink-0 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium text-foreground leading-none">Options</h2>
          <form onSubmit={submitTicker}>
            <input
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              spellCheck={false}
              className="w-24 h-8 px-2.5 text-sm font-mono uppercase rounded-sm border border-border bg-background text-foreground focus:outline-none focus:border-primary"
              placeholder="TICKER"
              aria-label="Ticker symbol"
            />
          </form>
          {chain && (
            <span className="text-sm font-mono text-foreground">
              ${chain.spot.toFixed(2)}
              <span className="ml-1.5" style={{ color: chain.dayChangePct >= 0 ? "var(--positive)" : "var(--negative)" }}>
                {chain.dayChangePct >= 0 ? "+" : ""}{chain.dayChangePct.toFixed(2)}%
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {refreshedAt && (
            <span className="text-xs text-muted-foreground">
              as of {refreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={() => loadChain(ticker, { mode, stratId: strategyId, expiry: chain?.expiry })}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-sm hover:bg-accent"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Holdings quick-picks */}
      {holdings.length > 0 && (
        <div className="px-6 py-2 border-b border-border shrink-0 flex items-center gap-1.5 overflow-x-auto">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1 shrink-0">Holdings</span>
          {holdings.map((t) => (
            <button
              key={t}
              onClick={() => pickTicker(t)}
              className="px-2 py-0.5 text-xs font-mono rounded-sm border transition-colors shrink-0"
              style={{
                borderColor: t === ticker ? "var(--steel)" : "var(--border)",
                color: t === ticker ? "var(--steel)" : "var(--muted-foreground)",
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      {view === "loading" && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground animate-pulse">Loading {ticker} options…</p>
        </div>
      )}

      {view === "error" && (
        <div className="flex-1 flex items-center justify-center px-6">
          <p className="text-sm text-muted-foreground text-center">{error}<br /><span className="opacity-60">Try another ticker.</span></p>
        </div>
      )}

      {view === "ready" && chain && (
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {/* Controls: expiry · mode · strategy picker */}
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Expiry</span>
              <select
                value={chain.expiry}
                onChange={(e) => changeExpiry(parseInt(e.target.value, 10))}
                className="h-8 px-2 text-sm font-mono rounded-sm border border-border bg-background text-foreground focus:outline-none focus:border-primary"
                style={{ width: 168 }}
              >
                {chain.expirations.map((ts) => {
                  const dte = Math.round((ts - Date.now() / 1000) / 86400);
                  return (
                    <option key={ts} value={ts}>
                      {new Date(ts * 1000).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "2-digit" })} · {dte}d
                    </option>
                  );
                })}
              </select>
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Build by</span>
              <div className="flex rounded-sm overflow-hidden border border-border text-xs font-medium h-8">
                {(["strategy", "custom"] as Mode[]).map((m) => {
                  const active = mode === m;
                  return (
                    <button
                      key={m}
                      onClick={() => switchMode(m)}
                      className="px-3 transition-colors capitalize"
                      style={{ background: active ? "var(--primary)" : "transparent", color: active ? "oklch(0.08 0 0)" : "var(--muted-foreground)" }}
                    >
                      {m === "strategy" ? "Strategy" : "Click chain"}
                    </button>
                  );
                })}
              </div>
            </div>

            {mode === "strategy" && (
              <div className="flex-1 min-w-[280px]">
                <StrategyPicker selectedId={strategyId} onSelect={selectStrategy} />
              </div>
            )}
            {mode === "custom" && (
              <span className="text-xs text-muted-foreground pb-1.5">
                Click a call or put in the chain to add a leg · click its dot to flip Buy/Sell
              </span>
            )}
          </div>

          {/* Chain explorer + payoff/analytics */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 items-start">
            <div className="xl:col-span-3 rounded-md border border-border bg-card overflow-hidden">
              <OptionChainTable
                rows={chain.strikes}
                spot={chain.spot}
                loading={false}
                customMap={legMap}
                onToggle={mode === "custom" ? toggleLeg : undefined}
                onToggleSide={mode === "custom" ? flipLeg : undefined}
              />
            </div>

            <div className="xl:col-span-2 flex flex-col gap-4">
              {analytics ? (
                <>
                  <div className="rounded-md border border-border bg-card p-4">
                    <div className="flex items-baseline justify-between mb-2">
                      <h3 className="text-sm font-medium text-foreground">
                        {mode === "strategy" ? strategyById(strategyId)?.name : `${legs.length} leg${legs.length === 1 ? "" : "s"}`}
                      </h3>
                      <span className="text-xs text-muted-foreground">Payoff at expiry</span>
                    </div>
                    <PayoffChart points={analytics.points} spot={chain.spot} breakevens={analytics.summary.breakevens} />
                    <SummaryStrip a={analytics} />
                    <GreeksRow g={analytics.greeks} />
                    <p className="mt-3 text-[10px] text-muted-foreground leading-relaxed">
                      Model estimate · Black-Scholes, no dividends, r = 4.3% · premiums = bid/ask mid. Greeks &amp; probability are approximations, not advice.
                    </p>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Legs</span>
                    <LegEditor legs={legs} strikes={chain.strikes} spot={chain.spot} expiry={chain.expiry} onLegsChange={setLegs} />
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-border bg-card p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    {mode === "custom"
                      ? "Click a strike in the chain to start building a position"
                      : "Select a strategy to see its payoff"}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ─── Summary + Greeks ─── */

interface Analytics {
  points: PayoffPoint[];
  summary: PayoffSummary;
  greeks: Greeks;
  pop: number;
}

const money = (n: number) =>
  !Number.isFinite(n) ? "Unlimited" : (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

function SummaryStrip({ a }: { a: Analytics }) {
  const { summary, pop } = a;
  const rr =
    !Number.isFinite(summary.maxProfit) || !Number.isFinite(summary.maxLoss) || summary.maxLoss === 0
      ? "—"
      : (summary.maxProfit / Math.abs(summary.maxLoss)).toFixed(2) + "×";
  const costLabel = summary.netCost >= 0 ? "Net Debit" : "Net Credit";

  const items: Array<{ label: string; value: string; color?: string }> = [
    { label: costLabel, value: money(Math.abs(summary.netCost)) },
    { label: "Max Profit", value: money(summary.maxProfit), color: "var(--positive)" },
    { label: "Max Loss", value: money(summary.maxLoss), color: "var(--negative)" },
    { label: "Breakeven", value: summary.breakevens.length ? summary.breakevens.map((b) => "$" + b.toFixed(2)).join(" / ") : "—" },
    { label: "Reward : Risk", value: rr },
    { label: "Prob. of Profit", value: Number.isNaN(pop) ? "—" : (pop * 100).toFixed(0) + "%" },
  ];

  return (
    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 border-t border-border pt-3">
      {items.map((it) => (
        <div key={it.label}>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{it.label}</div>
          <div className="text-sm font-mono mt-0.5" style={{ color: it.color ?? "var(--foreground)" }}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

function GreeksRow({ g }: { g: Analytics["greeks"] }) {
  const items = [
    { label: "Δ Delta", value: g.delta.toFixed(2) },
    { label: "Γ Gamma", value: g.gamma.toFixed(3) },
    { label: "Θ Theta", value: "$" + g.theta.toFixed(2) + "/d" },
    { label: "V Vega", value: "$" + g.vega.toFixed(2) },
  ];
  return (
    <div className="mt-3 grid grid-cols-4 gap-x-4 border-t border-border pt-3">
      {items.map((it) => (
        <div key={it.label}>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{it.label}</div>
          <div className="text-sm font-mono mt-0.5 text-foreground">{it.value}</div>
        </div>
      ))}
    </div>
  );
}
