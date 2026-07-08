"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatCurrency, formatPercent } from "@/lib/format";
import type { Leg } from "@/lib/options-math";
import { OptionsBuilder } from "@/components/options/OptionsBuilder";
import { EquityCurve } from "./EquityCurve";
import { FuturesDeck } from "./FuturesDeck";
import { ForexDeck } from "./ForexDeck";
import { StocksDeck } from "./StocksDeck";
import { PositionsDeck, comboLabel } from "./PositionsDeck";
import type { AssetClass, MarginSummary, PaperAccountMeta, PaperOrder, PaperPosition, RealizedTrade } from "@/lib/paper-types";

interface State {
  account: PaperAccountMeta;
  accounts: PaperAccountMeta[];
  competitionAccounts: { id: string; name: string; competitionId: string }[];
  positions: PaperPosition[];
  orders: PaperOrder[];
  realizedTotal: number;
  realized: RealizedTrade[];
  summary: MarginSummary;
}

const CLASS_LABEL: Record<AssetClass, string> = { STOCK: "Stocks", OPTION: "Options", FUTURE: "Futures", FOREX: "Forex" };
const CLASS_ORDER: AssetClass[] = ["STOCK", "OPTION", "FUTURE", "FOREX"];
type PaperTab = "POSITIONS" | AssetClass;
const ASSET_TABS: { key: PaperTab; label: string }[] = [
  { key: "POSITIONS", label: "Positions" },
  { key: "STOCK", label: "Stocks" },
  { key: "OPTION", label: "Options" },
  { key: "FUTURE", label: "Futures" },
  { key: "FOREX", label: "Forex" },
];

export function PaperClient({ initialAccountId }: { initialAccountId?: string | null } = {}) {
  const [state, setState] = useState<State | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [assetClass, setAssetClass] = useState<PaperTab>("POSITIONS");

  const load = useCallback(async (id?: string | null) => {
    setLoading(true);
    setLoadError(null);
    try {
      const q = id ? `?account=${encodeURIComponent(id)}` : "";
      const res = await fetch(`/api/paper${q}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load paper account.");
      setState(json);
      setAccountId(json.account.id);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load paper account.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(initialAccountId ?? undefined); }, [load, initialAccountId]);

  const reload = useCallback(() => { load(accountId); setRefreshKey((k) => k + 1); }, [load, accountId]);

  /* ── account actions ── */
  async function createAccount() {
    const name = window.prompt("New account name:");
    if (!name?.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/paper/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const json = await res.json();
      if (!res.ok) { alert(json.error); return; }
      await load(json.account.id);
    } finally { setBusy(false); }
  }
  async function renameAccount() {
    if (!state) return;
    const name = window.prompt("Rename account:", state.account.name);
    if (!name?.trim() || name === state.account.name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/paper/accounts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: state.account.id, name }) });
      if (!res.ok) { alert((await res.json()).error); return; }
      await load(state.account.id);
    } finally { setBusy(false); }
  }
  async function resetAccount() {
    if (!state || !window.confirm(`Reset "${state.account.name}" to its starting cash? This wipes all positions and orders.`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/paper/accounts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: state.account.id, reset: true }) });
      if (!res.ok) { alert((await res.json()).error); return; }
      reload();
    } finally { setBusy(false); }
  }
  async function deleteAccount() {
    if (!state || !window.confirm(`Delete "${state.account.name}" permanently?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/paper/accounts?account=${encodeURIComponent(state.account.id)}`, { method: "DELETE" });
      if (!res.ok) { alert((await res.json()).error); return; }
      await load(null);
    } finally { setBusy(false); }
  }

  async function closePosition(p: PaperPosition) {
    if (!state || !window.confirm(`Close ${p.qty} ${p.name} at market?`)) return;
    setBusy(true);
    try {
      const side = p.direction === "LONG" ? "SELL" : "BUY";
      const payload: Record<string, unknown> = { accountId: state.account.id, assetClass: p.assetClass, side, orderType: "MARKET", qty: p.qty };
      if (p.assetClass === "OPTION") {
        payload.underlying = p.underlying; payload.expiry = p.expiry; payload.strike = p.strike; payload.optionType = p.optionType;
      } else {
        payload.symbol = p.symbol;
      }
      const res = await fetch("/api/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { alert((await res.json()).error); return; }
      reload();
    } finally { setBusy(false); }
  }

  async function cancelOrder(id: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/paper/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: id }) });
      if (!res.ok) { alert((await res.json()).error); return; }
      reload();
    } finally { setBusy(false); }
  }

  /* ── Place a multi-leg option strategy as one combo (Options builder) ── */
  const placeStrategy = useCallback(
    async (legs: Leg[], info: { underlying: string; strategyName: string; netCost: number }) => {
      try {
        const res = await fetch("/api/paper/combo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId,
            underlying: info.underlying,
            strategyName: info.strategyName,
            legs: legs.map((l) => ({ type: l.type, side: l.side, strike: l.strike, qty: l.qty, expiry: l.expiry })),
          }),
        });
        const json = await res.json();
        if (!res.ok) return { ok: false, msg: json.error ?? "Trade rejected." };
        reload();
        const c = json.combo;
        const cost = c.netCost < 0 ? `+${formatCurrency(Math.abs(c.netCost))} credit` : `${formatCurrency(c.netCost)} debit`;
        const reserved = c.margin > 0 ? ` · ${formatCurrency(c.margin)} reserved` : "";
        return { ok: true, msg: `${info.strategyName} placed · ${cost}${reserved}.` };
      } catch (e) {
        return { ok: false, msg: e instanceof Error ? e.message : "Trade failed." };
      }
    },
    [accountId, reload],
  );

  async function closeStrategy(comboId: string, label: string) {
    if (!state || !window.confirm(`Close ${label} at market?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/paper/combo?comboId=${encodeURIComponent(comboId)}`, { method: "DELETE" });
      if (!res.ok) { alert((await res.json()).error); return; }
      reload();
    } finally { setBusy(false); }
  }

  if (loading && !state) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-[1400px] flex flex-col gap-5">
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton rounded-md" style={{ height: 84 }} />)}
          </div>
          <div className="skeleton rounded-md" style={{ height: 320 }} />
        </div>
      </div>
    );
  }

  if (loadError || !state) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-md text-center flex flex-col gap-3">
          <p className="text-sm text-foreground">Paper account unavailable</p>
          <p className="text-xs text-muted-foreground">{loadError}</p>
          <button onClick={() => load()} className="self-center text-xs px-3 py-1.5 rounded-sm" style={{ background: "var(--primary)", color: "oklch(0.08 0 0)" }}>Try again</button>
        </div>
      </div>
    );
  }

  const s = state.summary;
  // A competition sandbox isn't in the (main-only) account list — selecting one
  // shows a COMPETITION badge and hides account management (no reset/delete).
  const isComp = !state.accounts.some((a) => a.id === state.account.id);
  const compId = state.competitionAccounts.find((a) => a.id === state.account.id)?.competitionId;
  const pending = state.orders.filter((o) => o.status === "PENDING");
  const history = state.orders.filter((o) => o.status !== "PENDING");
  // Combos (multi-leg strategies) render together; everything else groups by class.
  const comboMap = new Map<string, PaperPosition[]>();
  const singles: PaperPosition[] = [];
  for (const p of state.positions) {
    if (p.comboId) {
      const arr = comboMap.get(p.comboId) ?? [];
      arr.push(p);
      comboMap.set(p.comboId, arr);
    } else {
      singles.push(p);
    }
  }
  const combos = [...comboMap.entries()].map(([id, rows]) => ({ id, rows }));
  const grouped = CLASS_ORDER
    .map((c) => ({ cls: c, rows: singles.filter((p) => p.assetClass === c) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-[1400px] flex flex-col gap-5">
        {/* header: account switcher (main + competition accounts) + actions */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={state.account.id}
            onChange={(e) => load(e.target.value)}
            disabled={busy}
            className="rounded-sm border border-input bg-card px-3 py-1.5 text-sm font-medium text-foreground outline-none focus:border-ring"
          >
            <optgroup label="Accounts">
              {state.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </optgroup>
            {state.competitionAccounts.length > 0 && (
              <optgroup label="Competitions">
                {state.competitionAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </optgroup>
            )}
          </select>
          {isComp ? (
            <>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-sm" style={{ background: "oklch(0.16 0.04 74)", color: "var(--primary)" }}>COMPETITION</span>
              {compId && <Link href={`/competitions?id=${compId}`} className="text-xs text-muted-foreground hover:text-foreground transition-colors">View standings →</Link>}
            </>
          ) : (
            <div className="flex items-center gap-1 text-xs">
              <HdrBtn onClick={createAccount} disabled={busy}>New</HdrBtn>
              <HdrBtn onClick={renameAccount} disabled={busy}>Rename</HdrBtn>
              <HdrBtn onClick={resetAccount} disabled={busy}>Reset</HdrBtn>
              <HdrBtn onClick={deleteAccount} disabled={busy || state.accounts.length <= 1}>Delete</HdrBtn>
            </div>
          )}
          {s.marginCall && (
            <span className="ml-auto text-xs font-medium px-2.5 py-1 rounded-sm" style={{ background: "oklch(0.16 0.05 25)", color: "var(--negative)" }}>
              ⚠ Margin Call — equity below maintenance
            </span>
          )}
          <button onClick={reload} className={`text-xs text-muted-foreground hover:text-foreground transition-colors ${s.marginCall ? "" : "ml-auto"}`}>Refresh</button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
          <Kpi label="Equity" value={formatCurrency(s.equity)} />
          <Kpi label="Total P / L" value={formatCurrency(s.totalPL)} tone={s.totalPL >= 0 ? "pos" : "neg"} sub={formatPercent(s.totalPLPct)} />
          <Kpi label="Cash" value={formatCurrency(s.cash)} />
          <Kpi label="Buying Power" value={formatCurrency(s.buyingPower)} />
          <Kpi label="Margin Used" value={formatCurrency(s.marginUsed)} sub={`Realized ${formatCurrency(state.realizedTotal)}`} />
        </div>

        {/* Asset-class tab bar */}
        <div className="flex items-center gap-1 p-1 rounded-sm w-fit" style={{ background: "oklch(0.10 0 0)" }}>
          {ASSET_TABS.map((t) => {
            const on = assetClass === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setAssetClass(t.key)}
                className="rounded-sm px-3 py-1.5 text-xs font-medium transition-colors"
                style={{
                  background: on ? "var(--card)" : "transparent",
                  color: on ? "var(--primary)" : "oklch(0.64 0.008 74)",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {assetClass === "POSITIONS" ? (
          /* ── Positions: unified view across every asset class ── */
          <div className="flex flex-col gap-4">
            <PositionsDeck
              accountId={state.account.id}
              positions={state.positions}
              realized={state.realized ?? []}
              orders={state.orders}
              equity={s.equity}
              cash={s.cash}
              busy={busy}
              onClose={closePosition}
              onCloseStrategy={closeStrategy}
              onPlaced={reload}
              pending={pending}
              onCancelOrder={cancelOrder}
            />
            <EquityCurve accountId={state.account.id} refreshKey={refreshKey} />
            {/* Pending orders live in the deck's HUD here — history tape only. */}
            <OrdersPanels pending={pending} history={history} busy={busy} cancelOrder={cancelOrder} showPending={false} />
          </div>
        ) : assetClass === "OPTION" ? (
          /* ── Options: the same strategy builder as the Options tab, now tradeable ── */
          <div className="flex flex-col gap-4">
            <div className="rounded-md border border-border overflow-hidden flex flex-col" style={{ height: 820 }}>
              <OptionsBuilder trade={{ onPlaceTrade: placeStrategy }} />
            </div>
            <PositionsAndOrders
              combos={combos}
              grouped={grouped}
              pending={pending}
              history={history}
              busy={busy}
              closePosition={closePosition}
              closeStrategy={closeStrategy}
              cancelOrder={cancelOrder}
            />
          </div>
        ) : assetClass === "FUTURE" ? (
          /* ── Futures: market map + picker + chart + specs + ticket ── */
          <div className="flex flex-col gap-4">
            <FuturesDeck accountId={state.account.id} onPlaced={reload} />
            <EquityCurve accountId={state.account.id} refreshKey={refreshKey} />
            <PositionsAndOrders
              combos={combos}
              grouped={grouped}
              pending={pending}
              history={history}
              busy={busy}
              closePosition={closePosition}
              closeStrategy={closeStrategy}
              cancelOrder={cancelOrder}
            />
          </div>
        ) : assetClass === "FOREX" ? (
          /* ── Forex: majors heat grid + chart + specs + ticket ── */
          <div className="flex flex-col gap-4">
            <ForexDeck accountId={state.account.id} onPlaced={reload} />
            <EquityCurve accountId={state.account.id} refreshKey={refreshKey} />
            <PositionsAndOrders
              combos={combos}
              grouped={grouped}
              pending={pending}
              history={history}
              busy={busy}
              closePosition={closePosition}
              closeStrategy={closeStrategy}
              cancelOrder={cancelOrder}
            />
          </div>
        ) : (
          /* ── Stocks: S&P 500 heatmap + detail + ticket + sector bars ── */
          <div className="flex flex-col gap-4">
            <StocksDeck accountId={state.account.id} onPlaced={reload} />
            <EquityCurve accountId={state.account.id} refreshKey={refreshKey} />
            <PositionsAndOrders
              combos={combos}
              grouped={grouped}
              pending={pending}
              history={history}
              busy={busy}
              closePosition={closePosition}
              closeStrategy={closeStrategy}
              cancelOrder={cancelOrder}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PositionsAndOrders({
  combos,
  grouped,
  pending,
  history,
  busy,
  closePosition,
  closeStrategy,
  cancelOrder,
}: {
  combos: { id: string; rows: PaperPosition[] }[];
  grouped: { cls: AssetClass; rows: PaperPosition[] }[];
  pending: PaperOrder[];
  history: PaperOrder[];
  busy: boolean;
  closePosition: (p: PaperPosition) => void;
  closeStrategy: (comboId: string, label: string) => void;
  cancelOrder: (id: string) => void;
}) {
  return (
    <>
      {/* positions */}
      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Open Positions</h2>
        {combos.length === 0 && grouped.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No open positions — place your first paper trade.</p>
        ) : (
          <div className="overflow-x-auto flex flex-col gap-4">
            {/* multi-leg strategies */}
            {combos.map((c) => {
              const label = comboLabel(c.rows);
              const unreal = c.rows.reduce((sum, r) => sum + r.unrealized, 0);
              return (
                <div key={c.id} className="rounded-sm border border-border/70" style={{ background: "oklch(0.11 0 0)" }}>
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60">
                    <span className="text-sm font-medium text-foreground truncate">{label}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs font-mono" style={{ color: unreal >= 0 ? "var(--positive)" : "var(--negative)" }}>
                        {formatCurrency(unreal)}
                      </span>
                      <button onClick={() => closeStrategy(c.id, label)} disabled={busy} className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">Close strategy</button>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {c.rows.map((r) => (
                        <tr key={r.id} className="border-b border-border/40 last:border-0">
                          <td className="py-2 px-3 font-mono text-foreground">{r.name}</td>
                          <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: r.direction === "LONG" ? "var(--positive)" : "var(--negative)" }}>{r.direction}</td>
                          <td className="py-2 px-2 text-right font-mono text-muted-foreground">×{r.qty}</td>
                          <td className="py-2 px-2 text-right font-mono text-muted-foreground">{formatCurrency(r.avgCost)}</td>
                          <td className="py-2 px-2 text-right font-mono text-foreground">
                            {formatCurrency(r.price)}{!r.livePrice && <span className="text-xs text-muted-foreground" title="Live quote unavailable"> *</span>}
                          </td>
                          <td className="py-2 px-3 text-right font-mono" style={{ color: r.unrealized >= 0 ? "var(--positive)" : "var(--negative)" }}>{formatCurrency(r.unrealized)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
            {/* single-leg positions, grouped by asset class */}
            {grouped.map((g) => (
              <div key={g.cls}>
                <p className="text-xs font-medium text-muted-foreground mb-1">{CLASS_LABEL[g.cls]}</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
                      <th className="text-left py-2 font-medium">Instrument</th>
                      <th className="text-right py-2 px-2 font-medium">Side</th>
                      <th className="text-right py-2 px-2 font-medium">Qty</th>
                      <th className="text-right py-2 px-2 font-medium">Avg</th>
                      <th className="text-right py-2 px-2 font-medium">Mark</th>
                      <th className="text-right py-2 px-2 font-medium">Margin</th>
                      <th className="text-right py-2 px-2 font-medium">Unreal. P / L</th>
                      <th className="text-right py-2 pl-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2.5 font-mono text-foreground">{r.name}</td>
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: r.direction === "LONG" ? "var(--positive)" : "var(--negative)" }}>{r.direction}</td>
                        <td className="py-2.5 px-2 text-right font-mono text-foreground">{r.qty}</td>
                        <td className="py-2.5 px-2 text-right font-mono text-foreground">{formatCurrency(r.avgCost)}</td>
                        <td className="py-2.5 px-2 text-right font-mono text-foreground">
                          {formatCurrency(r.price)}{!r.livePrice && <span className="text-xs text-muted-foreground" title="Live quote unavailable"> *</span>}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-muted-foreground">{r.marginHeld > 0 ? formatCurrency(r.marginHeld) : "—"}</td>
                        <td className="py-2.5 px-2 text-right font-mono" style={{ color: r.unrealized >= 0 ? "var(--positive)" : "var(--negative)" }}>
                          {formatCurrency(r.unrealized)} <span className="text-xs">({formatPercent(r.unrealizedPct)})</span>
                        </td>
                        <td className="py-2.5 pl-2 text-right">
                          <button onClick={() => closePosition(r)} disabled={busy} className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">Close</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      <OrdersPanels pending={pending} history={history} busy={busy} cancelOrder={cancelOrder} />
    </>
  );
}

function OrdersPanels({
  pending,
  history,
  busy,
  cancelOrder,
  showPending = true,
}: {
  pending: PaperOrder[];
  history: PaperOrder[];
  busy: boolean;
  cancelOrder: (id: string) => void;
  /** The Positions tab renders pending orders in its own HUD — hide them here. */
  showPending?: boolean;
}) {
  return (
    <>
      {/* pending orders — terminal tape */}
      {showPending && pending.length > 0 && (
        <section className="rounded-md border border-border bg-card">
          <header className="flex items-baseline gap-2 border-b border-border/60 px-4 pt-3.5 pb-2.5">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Pending Orders</h2>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{pending.length}</span>
          </header>
          <div className="px-2 py-1" style={{ background: "oklch(0.10 0 0)" }}>
            {pending.map((o) => (
              <div key={o.id} className="flex items-center gap-2.5 border-b border-border/40 px-2 py-1.5 font-mono text-xs last:border-0">
                <span className="w-9 shrink-0 text-[11px]" style={{ color: o.side === "BUY" ? "var(--positive)" : "var(--negative)" }}>{o.side}</span>
                <span className="min-w-0 flex-1 truncate text-foreground">{o.symbol}</span>
                <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{o.qty}</span>
                <span className="w-36 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  <span aria-hidden style={{ color: "var(--steel)" }}>◎ </span>
                  {o.limitPrice != null ? `LIMIT @ ${formatCurrency(o.limitPrice)}` : o.stopPrice != null ? `STOP @ ${formatCurrency(o.stopPrice)}` : o.orderType}
                </span>
                <button onClick={() => cancelOrder(o.id)} disabled={busy} className="shrink-0 text-[11px] text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:opacity-50">Cancel</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* order history — terminal tape */}
      <section className="rounded-md border border-border bg-card">
        <header className="flex items-baseline gap-2 border-b border-border/60 px-4 pt-3.5 pb-2.5">
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Order History</h2>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{history.length}</span>
        </header>
        {history.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <div className="max-h-72 overflow-y-auto px-2 py-1" style={{ background: "oklch(0.10 0 0)" }}>
            {history.map((o) => (
              <div key={o.id} className="flex items-center gap-2.5 border-b border-border/40 px-2 py-1.5 font-mono text-xs last:border-0">
                <span className="w-9 shrink-0 text-[11px]" style={{ color: o.side === "BUY" ? "var(--positive)" : "var(--negative)" }}>{o.side}</span>
                <span className="min-w-0 flex-1 truncate text-foreground">{o.symbol}</span>
                <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{o.qty}</span>
                <span className="w-20 shrink-0 text-right tabular-nums text-foreground">{o.price != null ? formatCurrency(o.price) : "—"}</span>
                <StatusPill status={o.status} />
                <span className="w-24 shrink-0 text-right text-[10px] text-muted-foreground">
                  {new Date(o.filledAt ?? o.createdAt).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function HdrBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="px-2 py-1.5 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-input transition-colors disabled:opacity-40">
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: PaperOrder["status"] }) {
  const map: Record<string, { color: string; bg: string }> = {
    FILLED: { color: "var(--positive)", bg: "oklch(0.16 0.04 152)" },
    CANCELLED: { color: "oklch(0.64 0.008 74)", bg: "oklch(0.16 0 0)" },
    REJECTED: { color: "var(--negative)", bg: "oklch(0.16 0.05 25)" },
    PENDING: { color: "var(--primary)", bg: "oklch(0.16 0.04 74)" },
  };
  const c = map[status] ?? map.CANCELLED;
  return <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-sm w-20 text-center shrink-0" style={{ color: c.color, background: c.bg }}>{status}</span>;
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3.5 flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono text-2xl leading-none" style={tone === "pos" ? { color: "var(--positive)" } : tone === "neg" ? { color: "var(--negative)" } : {}}>{value}</span>
      {sub && <span className="text-xs font-mono" style={tone === "pos" ? { color: "var(--positive)" } : tone === "neg" ? { color: "var(--negative)" } : { color: "oklch(0.52 0.008 74)" }}>{sub}</span>}
    </div>
  );
}
