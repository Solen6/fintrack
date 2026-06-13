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
import type { AssetClass, InstrumentRef, OptionType, OrderType, Side } from "@/lib/paper-types";

const ASSET_TABS: { key: AssetClass; label: string }[] = [
  { key: "STOCK", label: "Stocks" },
  { key: "OPTION", label: "Options" },
  { key: "FUTURE", label: "Futures" },
  { key: "FOREX", label: "Forex" },
];
const ORDER_TABS: OrderType[] = ["MARKET", "LIMIT", "STOP"];
const isMargin = (a: AssetClass) => a === "FUTURE" || a === "FOREX";

interface Strike { strike: number; type: OptionType; mark: number; iv: number | null }

export function TradeTicket({ accountId, onPlaced }: { accountId: string; onPlaced: () => void }) {
  const [assetClass, setAssetClass] = useState<AssetClass>("STOCK");
  const [side, setSide] = useState<Side>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [qty, setQty] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");

  // per-class symbol selection
  const [stockSym, setStockSym] = useState("");
  const [futSym, setFutSym] = useState("ES=F");
  const [fxSym, setFxSym] = useState("EURUSD");

  // option chain
  const [underlying, setUnderlying] = useState("");
  const [expiries, setExpiries] = useState<string[]>([]);
  const [expiry, setExpiry] = useState("");
  const [optionType, setOptionType] = useState<OptionType>("CALL");
  const [strikes, setStrikes] = useState<Strike[]>([]);
  const [strike, setStrike] = useState("");
  const [chainLoading, setChainLoading] = useState(false);

  const [estPrice, setEstPrice] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  // The canonical symbol for the currently selected instrument (non-option).
  const symbol = assetClass === "STOCK" ? stockSym.trim().toUpperCase()
    : assetClass === "FUTURE" ? futSym
    : assetClass === "FOREX" ? fxSym
    : "";

  const ref: InstrumentRef | null = useMemo(() => {
    if (assetClass === "OPTION") {
      if (!underlying || !expiry || !strike) return null;
      return { assetClass, symbol: "", underlying: underlying.toUpperCase(), expiry, strike: Number(strike), optionType };
    }
    if (!symbol) return null;
    return { assetClass, symbol };
  }, [assetClass, symbol, underlying, expiry, strike, optionType]);

  /* ── live est. price (debounced) ── */
  useEffect(() => {
    setEstPrice(null);
    if (!ref) return;
    const t = setTimeout(async () => {
      const p = new URLSearchParams({ assetClass });
      if (assetClass === "OPTION") {
        p.set("underlying", ref.underlying!); p.set("expiry", ref.expiry!);
        p.set("strike", String(ref.strike)); p.set("optionType", ref.optionType!);
      } else {
        p.set("symbol", ref.symbol);
      }
      try {
        const res = await fetch(`/api/paper/quote?${p}`);
        const json = await res.json();
        setEstPrice(typeof json.price === "number" ? json.price : null);
      } catch { setEstPrice(null); }
    }, 400);
    return () => clearTimeout(t);
  }, [ref, assetClass]);

  /* ── option: load expiries when underlying settles ── */
  useEffect(() => {
    if (assetClass !== "OPTION") return;
    const u = underlying.trim().toUpperCase();
    setExpiries([]); setExpiry(""); setStrikes([]); setStrike("");
    if (!u) return;
    const t = setTimeout(async () => {
      setChainLoading(true);
      try {
        const res = await fetch(`/api/paper/chain?underlying=${encodeURIComponent(u)}`);
        const json = await res.json();
        if (res.ok) setExpiries((json.expiries ?? []).map((e: { iso: string }) => e.iso));
      } catch { /* ignore */ } finally { setChainLoading(false); }
    }, 500);
    return () => clearTimeout(t);
  }, [underlying, assetClass]);

  /* ── option: load strikes when expiry/type chosen ── */
  useEffect(() => {
    if (assetClass !== "OPTION" || !expiry) return;
    const u = underlying.trim().toUpperCase();
    setStrikes([]); setStrike("");
    (async () => {
      setChainLoading(true);
      try {
        const res = await fetch(`/api/paper/chain?underlying=${encodeURIComponent(u)}&expiry=${expiry}`);
        const json = await res.json();
        if (res.ok) setStrikes(optionType === "CALL" ? json.calls : json.puts);
      } catch { /* ignore */ } finally { setChainLoading(false); }
    })();
  }, [expiry, optionType, assetClass, underlying]);

  const reset = useCallback(() => {
    setQty(""); setLimitPrice(""); setStopPrice("");
    setStockSym(""); setUnderlying(""); setExpiry(""); setStrike(""); setStrikes([]); setExpiries([]);
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
      const payload: Record<string, unknown> = { accountId, assetClass, side, orderType, qty: qtyN };
      if (assetClass === "OPTION") {
        payload.underlying = underlying.toUpperCase();
        payload.expiry = expiry; payload.strike = Number(strike); payload.optionType = optionType;
      } else {
        payload.symbol = symbol;
      }
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

  return (
    <section className="rounded-md border border-border bg-card p-4 h-fit">
      <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Trade Ticket</h2>

      {/* asset class tabs */}
      <div className="grid grid-cols-4 gap-1 mb-3 p-1 rounded-sm" style={{ background: "oklch(0.10 0 0)" }}>
        {ASSET_TABS.map((t) => {
          const on = assetClass === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => { setAssetClass(t.key); setSide("BUY"); setFeedback(null); }}
              className="rounded-sm py-1.5 text-xs font-medium transition-colors"
              style={{ background: on ? "var(--card)" : "transparent", color: on ? "var(--primary)" : "oklch(0.64 0.008 74)" }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

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

        {/* instrument selection per class */}
        {assetClass === "STOCK" && (
          <Field label="Symbol">
            <input value={stockSym} onChange={(e) => setStockSym(e.target.value.toUpperCase())} placeholder="AAPL" className={inputCls} />
          </Field>
        )}

        {assetClass === "FUTURE" && (
          <Field label="Contract">
            <select value={futSym} onChange={(e) => setFutSym(e.target.value)} className={inputCls}>
              {Object.values(FUTURES_SPECS).map((f) => (
                <option key={f.symbol} value={f.symbol}>{f.name} ({f.symbol}) · {f.category}</option>
              ))}
            </select>
          </Field>
        )}

        {assetClass === "FOREX" && (
          <Field label="Pair">
            <select value={fxSym} onChange={(e) => setFxSym(e.target.value)} className={inputCls}>
              {Object.values(FOREX_SPECS).map((p) => (
                <option key={p.symbol} value={p.symbol}>{p.symbol} · {p.name}</option>
              ))}
            </select>
          </Field>
        )}

        {assetClass === "OPTION" && (
          <>
            <Field label="Underlying">
              <input value={underlying} onChange={(e) => setUnderlying(e.target.value.toUpperCase())} placeholder="AAPL" className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              {(["CALL", "PUT"] as OptionType[]).map((t) => {
                const on = optionType === t;
                return (
                  <button key={t} type="button" onClick={() => setOptionType(t)}
                    className="rounded-sm border py-1.5 text-xs font-medium transition-colors"
                    style={{ borderColor: on ? "var(--primary)" : "oklch(0.20 0 0)", color: on ? "var(--primary)" : "oklch(0.64 0.008 74)", background: on ? "oklch(0.14 0 0)" : "transparent" }}>
                    {t}
                  </button>
                );
              })}
            </div>
            <Field label="Expiry">
              <select value={expiry} onChange={(e) => setExpiry(e.target.value)} disabled={expiries.length === 0} className={inputCls}>
                <option value="">{chainLoading ? "Loading…" : expiries.length ? "Select expiry" : "Enter underlying"}</option>
                {expiries.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </Field>
            <Field label="Strike">
              <select value={strike} onChange={(e) => setStrike(e.target.value)} disabled={strikes.length === 0} className={inputCls}>
                <option value="">{!expiry ? "Select expiry first" : chainLoading ? "Loading…" : strikes.length ? "Select strike" : "No strikes"}</option>
                {strikes.map((s) => (
                  <option key={s.strike} value={s.strike}>
                    {s.strike} — {formatCurrency(s.mark)}{s.iv != null ? ` (${s.iv}% IV)` : ""}
                  </option>
                ))}
              </select>
            </Field>
          </>
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

        <Field label={assetClass === "FOREX" ? "Units" : assetClass === "STOCK" || assetClass === "OPTION" ? (assetClass === "OPTION" ? "Contracts" : "Shares") : "Contracts"}>
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
            <span className="text-muted-foreground">Est. price {estPrice != null && <span className="font-mono">@ {formatCurrency(estPrice)}</span>}</span>
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
          {sellToCloseOnly && "Stocks & options are long-only here — Sell closes a position. "}
          Simulated account, no real money. Futures &amp; forex use a simplified margin model.
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
