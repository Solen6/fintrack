"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { StrategyPicker } from "@/components/options/StrategyPicker";
import { PayoffChart } from "@/components/options/PayoffChart";
import {
  aggregatePayoff,
  breakevens as calcBreakevens,
  summarize,
  netGreeks,
  probabilityOfProfit,
  priceAxisMax,
  type Leg,
  type PayoffSummary,
  type Greeks,
} from "@/lib/options-math";
import {
  STRATEGIES,
  instantiateStrategy,
  buildLeg,
  type ChainStrike,
} from "@/lib/option-strategies";

/* ── Types ── */
interface ExpiryOption { iso: string; unix: number }
interface RawStrike { strike: number; mark: number; iv: number | null }

interface ChainRow {
  strike: number;
  callMark: number | null;
  callIV: number | null;  // percent (e.g. 28.4)
  putMark: number | null;
  putIV: number | null;   // percent
}

interface Analytics {
  points: ReturnType<typeof aggregatePayoff>;
  bks: number[];
  smry: PayoffSummary;
  greeks: Greeks;
  pop: number;
}

const inputCls =
  "rounded-sm border border-input bg-background px-3 py-1.5 text-sm font-mono text-foreground outline-none focus:border-ring";

const ORDER_TYPES = ["MARKET", "LIMIT", "STOP"] as const;
type OrderType = (typeof ORDER_TYPES)[number];

/* ── OptionsChain ── */
export function OptionsChain({
  accountId,
  onPlaced,
}: {
  accountId: string;
  onPlaced: () => void;
}) {
  const [underlying, setUnderlying] = useState("");
  const [spot, setSpot] = useState<number | null>(null);
  const [expiries, setExpiries] = useState<ExpiryOption[]>([]);
  const [expiry, setExpiry] = useState<ExpiryOption | null>(null);
  const [chainRows, setChainRows] = useState<ChainRow[]>([]);
  const [chainLoading, setChainLoading] = useState(false);

  const [useStrategy, setUseStrategy] = useState(true);
  const [strategyId, setStrategyId] = useState("long-call");
  // strategy mode: per-leg strike override (null = use auto-picked strike)
  const [legStrikeOverrides, setLegStrikeOverrides] = useState<(number | null)[]>([]);
  // which leg the user is currently reassigning via table click (null = none)
  const [focusedLegIndex, setFocusedLegIndex] = useState<number | null>(null);
  // custom mode: set of "strike-CALL" or "strike-PUT" → side BUY/SELL
  const [customMap, setCustomMap] = useState<Map<string, "BUY" | "SELL">>(new Map());

  const [qty, setQty] = useState("1");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [limitPrice, setLimitPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  /* ── load expiries when underlying settles (debounced 500ms) ── */
  useEffect(() => {
    const u = underlying.trim().toUpperCase();
    setExpiries([]); setExpiry(null); setChainRows([]); setSpot(null);
    if (!u) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/paper/chain?underlying=${encodeURIComponent(u)}`);
        const json = await res.json();
        if (!res.ok) return;
        const exp: ExpiryOption[] = (json.expiries ?? []).map((e: { iso: string; unix: number }) => e);
        setExpiries(exp);
        setSpot(json.spot ?? null);
        if (exp.length > 0) setExpiry(exp[0]);
      } catch { /* ignore */ }
    }, 500);
    return () => clearTimeout(t);
  }, [underlying]);

  /* ── load chain when expiry changes ── */
  useEffect(() => {
    if (!expiry || !underlying.trim()) return;
    const u = underlying.trim().toUpperCase();
    setChainRows([]);
    (async () => {
      setChainLoading(true);
      try {
        const res = await fetch(`/api/paper/chain?underlying=${encodeURIComponent(u)}&expiry=${expiry.iso}`);
        const json = await res.json();
        if (!res.ok) return;
        setSpot((s) => json.spot ?? s);
        const map = new Map<number, ChainRow>();
        for (const c of (json.calls ?? []) as RawStrike[]) {
          map.set(c.strike, { strike: c.strike, callMark: c.mark, callIV: c.iv, putMark: null, putIV: null });
        }
        for (const p of (json.puts ?? []) as RawStrike[]) {
          const existing = map.get(p.strike);
          if (existing) { existing.putMark = p.mark; existing.putIV = p.iv; }
          else map.set(p.strike, { strike: p.strike, callMark: null, callIV: null, putMark: p.mark, putIV: p.iv });
        }
        setChainRows([...map.values()].sort((a, b) => a.strike - b.strike));
      } catch { /* ignore */ } finally { setChainLoading(false); }
    })();
  }, [expiry, underlying]);

  /* ── reset leg overrides when strategy or expiry changes ── */
  useEffect(() => { setLegStrikeOverrides([]); setFocusedLegIndex(null); }, [strategyId]);
  useEffect(() => { setLegStrikeOverrides([]); setFocusedLegIndex(null); }, [expiry?.iso]);

  /* ── ChainStrike rows for the math engine ── */
  const chainStrikeRows = useMemo((): ChainStrike[] =>
    chainRows.map((r) => ({
      strike: r.strike,
      callBid: (r.callMark ?? 0) * 0.98,
      callAsk: (r.callMark ?? 0) * 1.02,
      callIV: (r.callIV ?? 30) / 100,
      callOI: 0,
      putBid: (r.putMark ?? 0) * 0.98,
      putAsk: (r.putMark ?? 0) * 1.02,
      putIV: (r.putIV ?? 30) / 100,
      putOI: 0,
    })),
    [chainRows]
  );

  /* ── active legs ── */
  const activeLegs = useMemo((): Leg[] => {
    if (!expiry || !spot || chainStrikeRows.length === 0) return [];
    const qtyN = Math.max(1, Number(qty) || 1);
    if (useStrategy) {
      const def = STRATEGIES.find((s) => s.id === strategyId);
      if (!def) return [];
      // filter stock legs — paper trading can't submit them here
      const optLegs = instantiateStrategy(def, chainStrikeRows, spot, expiry.unix, qtyN)
        .filter((l) => l.type !== "stock");
      // apply per-leg strike overrides
      return optLegs.map((leg, i) => {
        const overrideStrike = legStrikeOverrides[i];
        if (overrideStrike == null) return leg;
        const row = chainStrikeRows.find((r) => r.strike === overrideStrike);
        if (!row) return leg;
        return buildLeg(leg.type as "call" | "put", leg.side as "long" | "short", row, qtyN, spot, expiry.unix);
      });
    }
    // custom
    return [...customMap.entries()].flatMap(([key, side]) => {
      const [strikeStr, typeStr] = key.split("-");
      const strike = Number(strikeStr);
      const type = typeStr.toLowerCase() as "call" | "put";
      const row = chainStrikeRows.find((r) => r.strike === strike);
      if (!row) return [];
      return [buildLeg(type, side === "BUY" ? "long" : "short", row, qtyN, spot, expiry.unix)];
    });
  }, [useStrategy, strategyId, legStrikeOverrides, customMap, chainStrikeRows, spot, expiry, qty]);

  /* ── analytics ── */
  const analytics = useMemo((): Analytics | null => {
    if (activeLegs.length === 0 || !spot || !expiry) return null;
    const hi = priceAxisMax(activeLegs, spot);
    const points = aggregatePayoff(activeLegs, hi);
    const bks = calcBreakevens(points);
    const smry = summarize(activeLegs, points);
    const greeks = netGreeks(activeLegs, spot);
    // avg IV across option legs for PoP
    const optLegs = activeLegs.filter((l) => l.type !== "stock");
    const avgIV = optLegs.length > 0
      ? optLegs.reduce((s, l) => s + l.iv, 0) / optLegs.length
      : 0.3;
    const T = Math.max((expiry.unix - Date.now() / 1000) / (365 * 86400), 0);
    const pop = avgIV > 0 && T > 0 ? probabilityOfProfit(points, spot, avgIV, T) : NaN;
    return { points, bks, smry, greeks, pop };
  }, [activeLegs, spot, expiry]);

  /* ── highlighted leg keys ── */
  const highlightKeys = useMemo(() => {
    const set = new Set<string>();
    for (const l of activeLegs) {
      if (l.type !== "stock") {
        const side = l.side === "long" ? "BUY" : "SELL";
        set.add(`${l.strike}-${l.type.toUpperCase()}-${side}`);
      }
    }
    return set;
  }, [activeLegs]);

  /* ── custom leg toggle ── */
  const toggleCustom = useCallback((strike: number, type: "CALL" | "PUT") => {
    const key = `${strike}-${type}`;
    setCustomMap((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, "BUY");
      }
      return next;
    });
  }, []);

  const toggleCustomSide = useCallback((strike: number, type: "CALL" | "PUT") => {
    const key = `${strike}-${type}`;
    setCustomMap((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.set(key, prev.get(key) === "BUY" ? "SELL" : "BUY");
      return next;
    });
  }, []);

  /* ── strike picker: called when user clicks a chain row in strategy mode ── */
  const handleSelectStrike = useCallback((strike: number) => {
    if (focusedLegIndex === null) return;
    setLegStrikeOverrides((prev) => {
      const next = [...prev];
      next[focusedLegIndex] = strike;
      return next;
    });
    setFocusedLegIndex(null);
  }, [focusedLegIndex]);

  /* ── submit ── */
  async function submit() {
    if (submitting || !activeLegs.length || !underlying.trim() || !expiry) return;
    setFeedback(null);
    setSubmitting(true);
    try {
      const qtyN = Math.max(1, Number(qty) || 1);
      const errors: string[] = [];
      for (const leg of activeLegs) {
        if (leg.type === "stock") continue;
        const payload: Record<string, unknown> = {
          accountId,
          assetClass: "OPTION",
          side: leg.side === "long" ? "BUY" : "SELL",
          orderType,
          qty: qtyN,
          underlying: underlying.toUpperCase(),
          expiry: expiry.iso,
          strike: leg.strike,
          optionType: leg.type === "call" ? "CALL" : "PUT",
        };
        if (orderType === "LIMIT") payload.limitPrice = Number(limitPrice);
        if (orderType === "STOP") payload.stopPrice = Number(limitPrice);
        const res = await fetch("/api/paper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) errors.push(json.error ?? "Order failed");
      }
      if (errors.length > 0) {
        setFeedback({ kind: "err", msg: errors.join(" · ") });
      } else {
        const count = activeLegs.filter((l) => l.type !== "stock").length;
        setFeedback({ kind: "ok", msg: `${count} leg${count > 1 ? "s" : ""} submitted.` });
        if (!useStrategy) setCustomMap(new Map());
        onPlaced();
      }
    } catch {
      setFeedback({ kind: "err", msg: "Network error — order not placed." });
    } finally {
      setSubmitting(false);
    }
  }

  const canTrade = activeLegs.filter((l) => l.type !== "stock").length > 0
    && !!underlying.trim() && !!expiry;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Top card: inputs + strategy picker ── */}
      <div className="rounded-md border border-border bg-card p-4 flex flex-col gap-4">
        {/* Controls row */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 shrink-0">
            <span className="text-xs text-muted-foreground">Underlying</span>
            <input
              value={underlying}
              onChange={(e) => setUnderlying(e.target.value.toUpperCase())}
              placeholder="AAPL"
              className={inputCls}
              style={{ width: 96 }}
            />
          </label>

          {spot != null && (
            <span className="text-sm font-mono text-muted-foreground pb-1.5">
              Spot <span className="text-foreground">{formatCurrency(spot)}</span>
            </span>
          )}

          <label className="flex flex-col gap-1 shrink-0">
            <span className="text-xs text-muted-foreground">Expiry</span>
            <select
              value={expiry?.iso ?? ""}
              onChange={(e) => setExpiry(expiries.find((x) => x.iso === e.target.value) ?? null)}
              disabled={expiries.length === 0}
              className={inputCls}
              style={{ width: 144 }}
            >
              <option value="">{expiries.length ? "Select expiry" : underlying.trim() ? "Loading…" : "Enter ticker first"}</option>
              {expiries.map((e) => <option key={e.iso} value={e.iso}>{e.iso}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1 shrink-0">
            <span className="text-xs text-muted-foreground">Contracts</span>
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="numeric"
              placeholder="1"
              className={inputCls}
              style={{ width: 72 }}
            />
          </label>

          <label className="flex flex-col gap-1 shrink-0">
            <span className="text-xs text-muted-foreground">Order</span>
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as OrderType)}
              className={inputCls}
            >
              {ORDER_TYPES.map((o) => <option key={o} value={o}>{o[0] + o.slice(1).toLowerCase()}</option>)}
            </select>
          </label>

          {(orderType === "LIMIT" || orderType === "STOP") && (
            <label className="flex flex-col gap-1 shrink-0">
              <span className="text-xs text-muted-foreground">{orderType === "LIMIT" ? "Limit" : "Stop"} price</span>
              <input
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className={inputCls}
                style={{ width: 88 }}
              />
            </label>
          )}

          <div className="flex flex-col gap-1 shrink-0 ml-auto">
            <span className="text-xs text-muted-foreground opacity-0">action</span>
            <button
              onClick={submit}
              disabled={!canTrade || submitting}
              className="rounded-sm px-5 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: "var(--primary)", color: "oklch(0.08 0 0)" }}
            >
              {submitting ? "Placing…" : "Place Trade"}
            </button>
          </div>
        </div>

        {feedback && (
          <p className="text-xs -mt-1" style={{ color: feedback.kind === "ok" ? "var(--positive)" : "var(--negative)" }}>
            {feedback.msg}
          </p>
        )}

        {/* Strategy / Custom toggle */}
        <div className="flex items-center gap-3">
          <div className="flex rounded-sm border border-border overflow-hidden text-xs shrink-0">
            {(["Strategy", "Custom"] as const).map((label) => {
              const active = label === "Strategy" ? useStrategy : !useStrategy;
              return (
                <button
                  key={label}
                  onClick={() => {
                    setUseStrategy(label === "Strategy");
                    if (label === "Custom") setCustomMap(new Map());
                  }}
                  className="px-3 py-1.5 transition-colors"
                  style={{
                    background: active ? "oklch(0.16 0 0)" : "transparent",
                    color: active ? "var(--primary)" : "var(--muted-foreground)",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {!useStrategy && (
            <span className="text-xs text-muted-foreground">
              Click chain rows to add legs · click again to toggle Buy / Sell
            </span>
          )}
        </div>

        {useStrategy && (
          <StrategyPicker selectedId={strategyId} onSelect={setStrategyId} />
        )}

        {/* Leg chips — click to focus a leg and then pick its strike from the chain */}
        {useStrategy && activeLegs.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">Legs</span>
            {activeLegs.map((leg, i) => {
              const focused = focusedLegIndex === i;
              const hasOverride = (legStrikeOverrides[i] ?? null) !== null;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setFocusedLegIndex(focused ? null : i)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-sm border text-xs font-mono transition-colors"
                  style={{
                    borderColor: focused ? "var(--primary)" : hasOverride ? "var(--steel)" : "var(--border)",
                    background: focused ? "oklch(0.14 0.04 74 / 0.4)" : "oklch(0.10 0 0)",
                    color: leg.side === "long" ? "var(--positive)" : "var(--negative)",
                  }}
                  title={focused ? "Click to cancel" : "Click, then click a chain row to change strike"}
                >
                  {leg.side === "long" ? "B" : "S"} {leg.type.toUpperCase()} ${leg.strike}
                  {focused && <span className="ml-0.5 text-[9px]" style={{ color: "var(--primary)" }}>✎</span>}
                </button>
              );
            })}
            {focusedLegIndex !== null && (
              <span className="text-xs text-muted-foreground">← click a row in the chain to change its strike</span>
            )}
          </div>
        )}
      </div>

      {/* ── Chain table + Payoff/Analytics ── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 items-start">
        {/* Chain table — 3 of 5 columns */}
        <div className="xl:col-span-3 rounded-md border border-border bg-card overflow-hidden">
          <ChainTable
            rows={chainRows}
            spot={spot ?? 0}
            loading={chainLoading}
            underlying={underlying.trim()}
            highlightKeys={highlightKeys}
            activeLegs={activeLegs}
            customMap={useStrategy ? undefined : customMap}
            onToggle={useStrategy ? undefined : toggleCustom}
            onToggleSide={useStrategy ? undefined : toggleCustomSide}
            onSelectStrike={useStrategy && focusedLegIndex !== null ? handleSelectStrike : undefined}
            focusedLegType={
              useStrategy && focusedLegIndex !== null
                ? (activeLegs[focusedLegIndex]?.type as "call" | "put" | undefined)
                : undefined
            }
          />
        </div>

        {/* Payoff + analytics — 2 of 5 columns */}
        <div className="xl:col-span-2 flex flex-col gap-4">
          {analytics ? (
            <>
              <div className="rounded-md border border-border bg-card p-4">
                <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Payoff at Expiry</h3>
                <PayoffChart points={analytics.points} spot={spot ?? 0} breakevens={analytics.bks} />
              </div>
              <AnalyticsPanel analytics={analytics} />
            </>
          ) : (
            <div className="rounded-md border border-border bg-card p-8 text-center">
              <p className="text-sm text-muted-foreground">
                {underlying.trim()
                  ? expiry
                    ? chainRows.length > 0
                      ? "Select a strategy or click chain rows to build a position"
                      : chainLoading ? "Loading chain…" : "Chain loading…"
                    : "Select an expiry date"
                  : "Enter a ticker to get started"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Chain table ── */
function ChainTable({
  rows,
  spot,
  loading,
  underlying,
  highlightKeys,
  activeLegs,
  customMap,
  onToggle,
  onToggleSide,
  onSelectStrike,
  focusedLegType,
}: {
  rows: ChainRow[];
  spot: number;
  loading: boolean;
  underlying: string;
  highlightKeys: Set<string>;
  activeLegs: Leg[];
  customMap?: Map<string, "BUY" | "SELL">;
  onToggle?: (strike: number, type: "CALL" | "PUT") => void;
  onToggleSide?: (strike: number, type: "CALL" | "PUT") => void;
  onSelectStrike?: (strike: number) => void;
  focusedLegType?: "call" | "put";
}) {
  const atmRef = useRef<HTMLTableRowElement | null>(null);

  // Auto-scroll to ATM on chain load
  useEffect(() => {
    if (rows.length > 0 && atmRef.current) {
      atmRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [rows]);

  if (!underlying) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Enter a ticker above to load the options chain
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 flex flex-col gap-1.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="skeleton h-8 rounded-sm" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        Select an expiry to view the chain
      </div>
    );
  }

  // Find the ATM row index
  let atmIdx = 0;
  let bestD = Infinity;
  rows.forEach((r, i) => {
    const d = Math.abs(r.strike - spot);
    if (d < bestD) { bestD = d; atmIdx = i; }
  });

  return (
    <div className="overflow-y-auto" style={{ maxHeight: 520 }}>
      <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
        <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
          <tr style={{ background: "oklch(0.10 0 0)" }}>
            {/* Calls header (right-aligned) */}
            <th className="text-right py-2 px-3 font-medium text-muted-foreground w-14">IV %</th>
            <th className="text-right py-2 px-3 font-medium text-muted-foreground w-16">Mark</th>
            <th className="py-2 px-1 w-5"></th>
            <th
              className="text-center py-2 px-4 font-semibold text-xs"
              style={{
                color: focusedLegType === "call" ? "var(--foreground)" : "var(--primary)",
                background: focusedLegType === "call" ? "oklch(0.18 0.06 74 / 0.5)" : "transparent",
                transition: "background 0.2s",
              }}
            >
              {focusedLegType === "call" ? "← PICK CALL" : "CALLS"}
            </th>
            {/* Strike */}
            <th
              className="text-center py-2 px-4 font-semibold text-xs"
              style={{ background: "oklch(0.13 0 0)", color: "var(--foreground)" }}
            >
              STRIKE
            </th>
            {/* Puts header (left-aligned) */}
            <th
              className="text-center py-2 px-4 font-semibold text-xs"
              style={{
                color: focusedLegType === "put" ? "var(--foreground)" : "var(--primary)",
                background: focusedLegType === "put" ? "oklch(0.18 0.06 74 / 0.5)" : "transparent",
                transition: "background 0.2s",
              }}
            >
              {focusedLegType === "put" ? "PICK PUT →" : "PUTS"}
            </th>
            <th className="py-2 px-1 w-5"></th>
            <th className="text-left py-2 px-3 font-medium text-muted-foreground w-16">Mark</th>
            <th className="text-left py-2 px-3 font-medium text-muted-foreground w-14">IV %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isAtm = i === atmIdx;
            const itmCall = row.strike < spot;   // ITM for calls: strike below spot
            const itmPut = row.strike > spot;    // ITM for puts: strike above spot

            const callKey = `${row.strike}-CALL`;
            const putKey = `${row.strike}-PUT`;
            const callHighBuy = highlightKeys.has(`${row.strike}-call-BUY`);
            const callHighSell = highlightKeys.has(`${row.strike}-call-SELL`);
            const putHighBuy = highlightKeys.has(`${row.strike}-put-BUY`);
            const putHighSell = highlightKeys.has(`${row.strike}-put-SELL`);
            const callHigh = callHighBuy || callHighSell;
            const putHigh = putHighBuy || putHighSell;

            // custom map side
            const callCustomSide = customMap?.get(callKey);
            const putCustomSide = customMap?.get(putKey);
            const callSelected = callCustomSide !== undefined;
            const putSelected = putCustomSide !== undefined;

            const anyHighlight = callHigh || putHigh || callSelected || putSelected;

            const rowBg = isAtm
              ? "oklch(0.15 0.008 74 / 0.6)"
              : anyHighlight
              ? "oklch(0.13 0.005 74 / 0.4)"
              : "transparent";

            const callBg = itmCall ? "oklch(0.14 0 0 / 0.5)" : "transparent";
            const putBg = itmPut ? "oklch(0.14 0 0 / 0.5)" : "transparent";

            return (
              <tr
                key={row.strike}
                ref={isAtm ? atmRef : undefined}
                onClick={onSelectStrike ? () => onSelectStrike(row.strike) : undefined}
                style={{
                  background: rowBg,
                  borderBottom: "1px solid oklch(0.18 0 0)",
                  cursor: onSelectStrike ? "pointer" : "default",
                }}
                className={onSelectStrike ? "hover:brightness-125" : ""}
              >
                {/* Call IV */}
                <td className="py-2 px-3 text-right font-mono text-muted-foreground" style={{ background: callBg }}>
                  {row.callIV != null ? row.callIV.toFixed(1) : "—"}
                </td>

                {/* Call Mark (clickable in custom mode) */}
                <td
                  className="py-2 px-3 text-right font-mono"
                  style={{
                    background: callBg,
                    color: callHigh || callSelected
                      ? (callHighSell || callCustomSide === "SELL" ? "var(--negative)" : "var(--positive)")
                      : "var(--foreground)",
                    cursor: onToggle ? "pointer" : "default",
                    fontWeight: callHigh || callSelected ? 600 : 400,
                  }}
                  onClick={() => row.callMark != null && onToggle?.(row.strike, "CALL")}
                  title={onToggle && row.callMark != null ? (callSelected ? "Click to remove leg" : "Click to add buy call") : undefined}
                >
                  {row.callMark != null ? row.callMark.toFixed(2) : "—"}
                </td>

                {/* Call selection dot */}
                <td className="py-2 px-1 text-center" style={{ width: 20, background: callBg }}>
                  {(callHigh || callSelected) && (
                    <button
                      className="rounded-full w-3.5 h-3.5 inline-flex items-center justify-center text-[8px] font-bold transition-opacity"
                      style={{
                        background: callHighSell || callCustomSide === "SELL" ? "var(--negative)" : "var(--positive)",
                        color: "oklch(0.08 0 0)",
                      }}
                      onClick={() => callSelected && onToggleSide?.(row.strike, "CALL")}
                      title={callSelected ? `Toggle Buy/Sell (currently ${callCustomSide})` : undefined}
                    >
                      {callHighSell || callCustomSide === "SELL" ? "S" : "B"}
                    </button>
                  )}
                </td>

                {/* Calls label col (empty body cell for header alignment) */}
                <td className="py-2 px-4" />

                {/* Strike */}
                <td
                  className="py-2 px-4 text-center font-mono font-medium"
                  style={{
                    background: isAtm ? "oklch(0.16 0.012 74 / 0.8)" : "oklch(0.12 0 0)",
                    color: isAtm ? "var(--primary)" : "var(--foreground)",
                    position: "relative",
                  }}
                >
                  {row.strike.toFixed(0)}
                  {isAtm && (
                    <span
                      className="absolute -top-px left-0 right-0 h-px"
                      style={{ background: "var(--primary)", opacity: 0.5 }}
                    />
                  )}
                </td>

                {/* Puts label col */}
                <td className="py-2 px-4" />

                {/* Put selection dot */}
                <td className="py-2 px-1 text-center" style={{ width: 20, background: putBg }}>
                  {(putHigh || putSelected) && (
                    <button
                      className="rounded-full w-3.5 h-3.5 inline-flex items-center justify-center text-[8px] font-bold transition-opacity"
                      style={{
                        background: putHighSell || putCustomSide === "SELL" ? "var(--negative)" : "var(--positive)",
                        color: "oklch(0.08 0 0)",
                      }}
                      onClick={() => putSelected && onToggleSide?.(row.strike, "PUT")}
                      title={putSelected ? `Toggle Buy/Sell (currently ${putCustomSide})` : undefined}
                    >
                      {putHighSell || putCustomSide === "SELL" ? "S" : "B"}
                    </button>
                  )}
                </td>

                {/* Put Mark (clickable) */}
                <td
                  className="py-2 px-3 text-left font-mono"
                  style={{
                    background: putBg,
                    color: putHigh || putSelected
                      ? (putHighSell || putCustomSide === "SELL" ? "var(--negative)" : "var(--positive)")
                      : "var(--foreground)",
                    cursor: onToggle ? "pointer" : "default",
                    fontWeight: putHigh || putSelected ? 600 : 400,
                  }}
                  onClick={() => row.putMark != null && onToggle?.(row.strike, "PUT")}
                  title={onToggle && row.putMark != null ? (putSelected ? "Click to remove leg" : "Click to add buy put") : undefined}
                >
                  {row.putMark != null ? row.putMark.toFixed(2) : "—"}
                </td>

                {/* Put IV */}
                <td className="py-2 px-3 text-left font-mono text-muted-foreground" style={{ background: putBg }}>
                  {row.putIV != null ? row.putIV.toFixed(1) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── Analytics panel ── */
function AnalyticsPanel({ analytics }: { analytics: Analytics }) {
  const { smry, greeks, pop, bks } = analytics;
  const fmtPL = (n: number) =>
    Math.abs(n) === Infinity ? "Unlimited" : formatCurrency(Math.abs(n));

  return (
    <div className="rounded-md border border-border bg-card p-4 flex flex-col gap-4">
      <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Strategy Summary</h3>

      {/* P/L + PoP grid */}
      <div className="grid grid-cols-2 gap-3">
        <SummaryCell
          label="Max Profit"
          value={fmtPL(smry.maxProfit)}
          color={smry.maxProfit > 0 ? "var(--positive)" : undefined}
        />
        <SummaryCell
          label="Max Loss"
          value={fmtPL(smry.maxLoss)}
          color={smry.maxLoss < 0 ? "var(--negative)" : undefined}
        />
        <SummaryCell
          label="Prob. of Profit"
          value={isNaN(pop) ? "—" : `${(pop * 100).toFixed(1)}%`}
        />
        <SummaryCell
          label={smry.netCost >= 0 ? "Net Debit" : "Net Credit"}
          value={formatCurrency(Math.abs(smry.netCost))}
          color={smry.netCost < 0 ? "var(--positive)" : undefined}
        />
      </div>

      {/* Breakevens */}
      {bks.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">
            Breakeven{bks.length > 1 ? "s" : ""}
          </p>
          <p className="text-sm font-mono" style={{ color: "var(--primary)" }}>
            {bks.map((b) => `$${b.toFixed(2)}`).join("  ·  ")}
          </p>
        </div>
      )}

      {/* Greeks */}
      <div>
        <p className="text-xs text-muted-foreground mb-2">Greeks</p>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "Δ Delta", value: greeks.delta.toFixed(2) },
            { label: "Γ Gamma", value: greeks.gamma.toFixed(4) },
            { label: "Θ Theta", value: greeks.theta.toFixed(2) },
            { label: "V Vega", value: greeks.vega.toFixed(2) },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="rounded-sm border border-border p-2 text-center flex flex-col gap-0.5"
              style={{ background: "oklch(0.10 0 0)" }}
            >
              <span className="text-[9px] text-muted-foreground">{label}</span>
              <span className="text-xs font-mono text-foreground">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Black-Scholes (no dividends, flat rate). Payoff at expiry only. Simulated — no real money.
      </p>
    </div>
  );
}

function SummaryCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-sm border border-border p-2.5" style={{ background: "oklch(0.10 0 0)" }}>
      <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-mono font-medium" style={color ? { color } : {}}>
        {value}
      </p>
    </div>
  );
}
