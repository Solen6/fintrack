"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/lib/format";
import {
  FUTURES_SPECS,
  FOREX_SPECS,
  FOREX_STANDARD_LOT,
  initialMarginFor,
  notionalUsd,
} from "@/lib/contract-specs";
import type { AssetClass, InstrumentRef, OrderType, Side } from "@/lib/paper-types";

const ORDER_TABS: OrderType[] = ["MARKET", "LIMIT", "STOP"];
const isMargin = (a: AssetClass) => a === "FUTURE" || a === "FOREX";

export function TradeTicket({
  accountId,
  onPlaced,
  assetClass,
  futureSymbol,
  onFutureSymbolChange,
  fxSymbol,
  onFxSymbolChange,
}: {
  accountId: string;
  onPlaced: () => void;
  assetClass: Exclude<AssetClass, "OPTION">;
  /** When provided, the FUTURE contract is controlled externally (the deck's
   *  picker + market map). The internal contract dropdown is hidden. */
  futureSymbol?: string;
  onFutureSymbolChange?: (s: string) => void;
  /** Same, for the FOREX pair (the forex deck's picker + heat grid). */
  fxSymbol?: string;
  onFxSymbolChange?: (s: string) => void;
}) {
  const [side, setSide] = useState<Side>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [qty, setQty] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");

  const [stockSym, setStockSym] = useState("");
  const [internalFutSym, setInternalFutSym] = useState("ES=F");
  const [internalFxSym, setInternalFxSym] = useState("EURUSD");

  // FUTURE / FOREX symbol may be controlled by the parent (deck) or held internally.
  const controlledFut = futureSymbol !== undefined && onFutureSymbolChange !== undefined;
  const futSym = controlledFut ? futureSymbol! : internalFutSym;
  const setFutSym = controlledFut ? onFutureSymbolChange! : setInternalFutSym;

  const controlledFx = fxSymbol !== undefined && onFxSymbolChange !== undefined;
  const fxSym = controlledFx ? fxSymbol! : internalFxSym;
  const setFxSym = controlledFx ? onFxSymbolChange! : setInternalFxSym;

  const [estPrice, setEstPrice] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const symbol = assetClass === "STOCK" ? stockSym.trim().toUpperCase()
    : assetClass === "FUTURE" ? futSym
    : fxSym;

  const ref: InstrumentRef | null = useMemo(() => {
    if (!symbol) return null;
    return { assetClass, symbol };
  }, [assetClass, symbol]);

  // Reset side when switching asset class
  useEffect(() => { setSide("BUY"); setFeedback(null); }, [assetClass]);

  /* ── live est. price (debounced) ── */
  useEffect(() => {
    setEstPrice(null);
    if (!ref) return;
    const t = setTimeout(async () => {
      const p = new URLSearchParams({ assetClass, symbol: ref.symbol });
      try {
        const res = await fetch(`/api/paper/quote?${p}`);
        const json = await res.json();
        setEstPrice(typeof json.price === "number" ? json.price : null);
      } catch { setEstPrice(null); }
    }, 400);
    return () => clearTimeout(t);
  }, [ref, assetClass, symbol]);

  const reset = useCallback(() => {
    setQty(""); setLimitPrice(""); setStopPrice("");
    setStockSym("");
  }, []);

  const qtyN = Number(qty);
  const previewPrice = estPrice ?? 0;
  const notional = ref && qtyN > 0 && previewPrice > 0 ? notionalUsd(ref, previewPrice, qtyN) : null;
  const marginReq = ref && qtyN > 0 && previewPrice > 0 ? initialMarginFor(ref, previewPrice, qtyN) : null;
  const sellToCloseOnly = !isMargin(assetClass) && side === "SELL";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFeedback(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = { accountId, assetClass, side, orderType, qty: qtyN, symbol };
      if (orderType === "LIMIT") payload.limitPrice = Number(limitPrice);
      if (orderType === "STOP") payload.stopPrice = Number(stopPrice);

      const res = await fetch("/api/paper", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) { setFeedback({ kind: "err", msg: json.error ?? "Order failed." }); return; }

      if (json.filled) {
        const f = json.filled;
        const r = f.realized ? ` · realized ${formatCurrency(f.realized)}` : "";
        setFeedback({ kind: "ok", msg: `${f.side} ${f.qty} ${f.symbol} @ ${formatCurrency(f.price)}${r}.` });
      } else {
        const p = json.pending;
        setFeedback({ kind: "ok", msg: `${p.orderType} ${p.side} ${p.qty} ${p.symbol} resting — pending.` });
      }
      reset();
      onPlaced();
    } catch {
      setFeedback({ kind: "err", msg: "Order failed — network error." });
    } finally {
      setSubmitting(false);
    }
  }

  const longLabel = isMargin(assetClass) ? "BUY / LONG" : "BUY";
  const shortLabel = isMargin(assetClass) ? "SELL / SHORT" : "SELL";
  const qtyLabel = assetClass === "FOREX" ? "Units" : assetClass === "STOCK" ? "Shares" : "Contracts";

  return (
    <section className="rounded-md border border-border bg-card p-4 h-fit">
      <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Trade Ticket</h2>

      <form onSubmit={submit} className="flex flex-col gap-3">
        {/* side */}
        <div className="grid grid-cols-2 gap-2">
          {([["BUY", longLabel], ["SELL", shortLabel]] as [Side, string][]).map(([s, label]) => {
            const on = side === s;
            const color = s === "BUY" ? "var(--positive)" : "var(--negative)";
            return (
              <button key={s} type="button" onClick={() => setSide(s)}
                className="rounded-sm border py-1.5 text-sm font-medium transition-colors"
                style={{ borderColor: on ? color : "oklch(0.20 0 0)", color: on ? color : "oklch(0.64 0.008 74)", background: on ? "oklch(0.14 0 0)" : "transparent" }}>
                {label}
              </button>
            );
          })}
        </div>

        {/* instrument */}
        {assetClass === "STOCK" && (
          <Field label="Symbol">
            <input value={stockSym} onChange={(e) => setStockSym(e.target.value.toUpperCase())} placeholder="AAPL" className={inputCls} />
          </Field>
        )}
        {assetClass === "FUTURE" && (
          controlledFut ? (
            <Field label="Contract">
              <div className="flex items-center justify-between gap-2 rounded-sm border border-input bg-background px-3 py-1.5">
                <span className="text-sm font-medium text-foreground truncate">
                  {FUTURES_SPECS[futSym]?.name ?? futSym}
                </span>
                <span className="text-xs font-mono text-muted-foreground shrink-0">{futSym}</span>
              </div>
              <span className="text-xs text-muted-foreground">Pick a contract from the map or list above.</span>
            </Field>
          ) : (
            <Field label="Contract">
              <select value={futSym} onChange={(e) => setFutSym(e.target.value)} className={inputCls}>
                {Object.values(FUTURES_SPECS).map((f) => (
                  <option key={f.symbol} value={f.symbol}>{f.name} ({f.symbol}) · {f.category}</option>
                ))}
              </select>
            </Field>
          )
        )}
        {assetClass === "FOREX" && (
          controlledFx ? (
            <Field label="Pair">
              <div className="flex items-center justify-between gap-2 rounded-sm border border-input bg-background px-3 py-1.5">
                <span className="text-sm font-medium text-foreground truncate">
                  {FOREX_SPECS[fxSym]?.name ?? fxSym}
                </span>
                <span className="text-xs font-mono text-muted-foreground shrink-0">{fxSym}</span>
              </div>
              <span className="text-xs text-muted-foreground">Pick a pair from the grid or list above.</span>
            </Field>
          ) : (
            <Field label="Pair">
              <select value={fxSym} onChange={(e) => setFxSym(e.target.value)} className={inputCls}>
                {Object.values(FOREX_SPECS).map((p) => (
                  <option key={p.symbol} value={p.symbol}>{p.symbol} · {p.name}</option>
                ))}
              </select>
            </Field>
          )
        )}

        {/* order type */}
        <div className="grid grid-cols-3 gap-1 p-1 rounded-sm" style={{ background: "oklch(0.10 0 0)" }}>
          {ORDER_TABS.map((o) => {
            const on = orderType === o;
            return (
              <button key={o} type="button" onClick={() => setOrderType(o)}
                className="rounded-sm py-1.5 text-xs font-medium transition-colors"
                style={{ background: on ? "var(--card)" : "transparent", color: on ? "var(--primary)" : "oklch(0.64 0.008 74)" }}>
                {o[0] + o.slice(1).toLowerCase()}
              </button>
            );
          })}
        </div>

        <Field label={qtyLabel}>
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric"
            placeholder={assetClass === "FOREX" ? String(FOREX_STANDARD_LOT) : "10"} className={inputCls} />
        </Field>

        {orderType === "LIMIT" && (
          <Field label="Limit price">
            <input value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} />
          </Field>
        )}
        {orderType === "STOP" && (
          <Field label="Stop price">
            <input value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} />
          </Field>
        )}

        {/* preview */}
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Est. price {estPrice != null && <span className="font-mono">@ {formatCurrency(estPrice)}</span>}
            </span>
            <span className="font-mono text-foreground">{notional != null ? formatCurrency(notional) : "—"}</span>
          </div>
          {isMargin(assetClass) && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Margin required</span>
              <span className="font-mono text-foreground">{marginReq != null ? formatCurrency(marginReq) : "—"}</span>
            </div>
          )}
        </div>

        <button type="submit" disabled={submitting}
          className="rounded-sm py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: "var(--primary)" }}>
          {submitting ? "Placing…" : orderType === "MARKET" ? `Place ${side === "BUY" ? "Buy" : "Sell"} Order` : `Place ${orderType[0] + orderType.slice(1).toLowerCase()} Order`}
        </button>

        {feedback && (
          <p className="text-xs" style={{ color: feedback.kind === "ok" ? "var(--positive)" : "var(--negative)" }}>{feedback.msg}</p>
        )}

        <p className="text-xs text-muted-foreground leading-relaxed">
          {sellToCloseOnly && "Stocks are long-only here — Sell closes a position. "}
          Simulated account, no real money.{isMargin(assetClass) ? " Uses a simplified margin model." : ""}
        </p>
      </form>
    </section>
  );
}

const inputCls =
  "w-full rounded-sm border border-input bg-background px-3 py-1.5 text-sm font-mono text-foreground outline-none focus:border-ring";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
