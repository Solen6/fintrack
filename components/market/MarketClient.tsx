"use client";

import { useState, useEffect, useCallback } from "react";
import { formatCurrency, formatPercent } from "@/lib/format";
import { YieldCurve } from "@/components/market/YieldCurve";
import { MarketBreadth } from "@/components/market/MarketBreadth";
import type { IndexQuote, Mover, EarningsRow, MarketResponse } from "@/app/api/market/route";

function fmtValue(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function MarketClient() {
  const [data, setData]       = useState<MarketResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/market");
      if (!res.ok) throw new Error();
      const json: MarketResponse = await res.json();
      setData(json);
      setUpdatedAt(new Date(json.updatedAt));
    } catch {
      // leave stale data in place if refresh fails
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground animate-pulse">Loading market data…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Market data unavailable.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-[1400px] flex flex-col gap-5">

        {/* ── Header row ── */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-foreground">Market Overview</h2>
          <div className="flex items-center gap-3">
            {updatedAt && (
              <span className="text-xs text-muted-foreground">
                Live · {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <button
              onClick={() => { setLoading(true); load(); }}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-sm hover:bg-accent transition-colors duration-150"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* ── Index strip ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
          {data.indices.map((idx) => <IndexCard key={idx.symbol} idx={idx} />)}
        </div>

        {/* ── Market breadth / internals ── */}
        <MarketBreadth />

        {/* ── Movers ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Panel title="Top Gainers">
            <MoverList rows={data.gainers} />
          </Panel>
          <Panel title="Top Losers">
            <MoverList rows={data.losers} />
          </Panel>
          <Panel title="Most Active">
            <MoverList rows={data.mostActive} showVolume />
          </Panel>
        </div>

        {/* ── Yield curve + recent earnings ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <YieldCurve />
          <Panel title="Recent Earnings">
            {data.recentEarnings.length > 0
              ? <EarningsList rows={data.recentEarnings} />
              : <Empty>No recently reported earnings.</Empty>}
          </Panel>
        </div>

      </div>
    </div>
  );
}

// ─── Index card ───────────────────────────────────────────────────────────────
function IndexCard({ idx }: { idx: IndexQuote }) {
  const pos = idx.changePct >= 0;
  return (
    <div className="rounded-sm border border-border bg-card px-4 py-3 flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-muted-foreground leading-none">
        {idx.name}
      </span>
      <span className="font-mono text-lg font-medium leading-tight text-foreground">
        {fmtValue(idx.value)}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-mono" style={{ color: pos ? "var(--positive)" : "var(--negative)" }}>
          {pos ? "+" : ""}{fmtValue(idx.change)}
        </span>
        <span className="text-xs font-mono" style={{ color: pos ? "var(--positive)" : "var(--negative)" }}>
          ({pos ? "+" : ""}{idx.changePct.toFixed(2)}%)
        </span>
      </div>
    </div>
  );
}

// ─── Mover list ───────────────────────────────────────────────────────────────
function MoverList({ rows, showVolume = false }: { rows: Mover[]; showVolume?: boolean }) {
  if (rows.length === 0) return <Empty>Data unavailable.</Empty>;
  return (
    <ul className="flex flex-col">
      {rows.map((m) => {
        const pos = m.changePct >= 0;
        return (
          <li
            key={m.ticker}
            className="flex items-center gap-3 py-2 border-b border-border/60 last:border-0"
          >
            <div className="min-w-0 flex-1 flex flex-col">
              <span className="font-mono text-sm font-semibold text-foreground">{m.ticker}</span>
              <span className="text-[11px] text-muted-foreground truncate">{m.name}</span>
            </div>
            {showVolume && m.volume && (
              <span className="text-xs font-mono text-muted-foreground shrink-0">
                {m.volume}
              </span>
            )}
            <span className="font-mono text-sm text-foreground shrink-0 w-20 text-right">
              {formatCurrency(m.price)}
            </span>
            <span
              className="font-mono text-sm shrink-0 w-16 text-right"
              style={{ color: pos ? "var(--positive)" : "var(--negative)" }}
            >
              {pos ? "+" : ""}{m.changePct.toFixed(2)}%
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Earnings list ────────────────────────────────────────────────────────────
function EarningsList({ rows }: { rows: EarningsRow[] }) {
  return (
    <ul className="flex flex-col">
      {rows.map((e) => {
        const reported = e.epsActual !== undefined;
        const beat     = reported && e.epsActual! >= (e.epsEst ?? 0);
        return (
          <li
            key={`${e.ticker}-${e.date}`}
            className="flex items-center gap-3 py-2 border-b border-border/60 last:border-0"
          >
            <div className="min-w-0 flex-1 flex flex-col">
              <span className="font-mono text-sm font-semibold text-foreground">{e.ticker}</span>
              <span className="text-[11px] text-muted-foreground truncate">{e.name}</span>
            </div>
            <span className="text-xs font-mono text-muted-foreground shrink-0 text-right">
              {e.date}
              {e.when !== "—" && (
                <span className="ml-1 opacity-60">{e.when}</span>
              )}
            </span>
            <span className="text-xs font-mono text-muted-foreground shrink-0 w-14 text-right">
              {e.epsEst != null ? `est ${e.epsEst.toFixed(2)}` : "—"}
            </span>
            <span className="font-mono text-sm shrink-0 w-20 text-right">
              {reported ? (
                <span style={{ color: beat ? "var(--positive)" : "var(--negative)" }}>
                  {e.epsActual!.toFixed(2)} {beat ? "▲" : "▼"}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Panel wrapper ────────────────────────────────────────────────────────────
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-sm border border-border bg-card p-4">
      <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground py-2">{children}</p>;
}
