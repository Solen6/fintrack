"use client";

import { useEffect, useMemo, useState } from "react";
import nextDynamic from "next/dynamic";
import { formatCurrency } from "@/lib/format";
import type { HoldingWithMetrics } from "@/lib/types";
import type { ActivityItem, ActivityType } from "@/app/api/transactions/recent/route";
import type { SeriesRange } from "@/app/api/paper/series/route";

const HoldingsTreemap = nextDynamic(
  () => import("./HoldingsTreemap").then((m) => m.HoldingsTreemap),
  { ssr: false, loading: () => <div className="skeleton h-full w-full rounded-sm" /> }
);

/* Recharts (SSR-disabled — project convention) */
const AreaChart = nextDynamic(() => import("recharts").then((m) => m.AreaChart), { ssr: false });
const Area = nextDynamic(() => import("recharts").then((m) => m.Area), { ssr: false });
const XAxis = nextDynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = nextDynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const Tooltip = nextDynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const ResponsiveContainer = nextDynamic(() => import("recharts").then((m) => m.ResponsiveContainer), { ssr: false });

interface CashBalance { account: string; label: string; balance: number }
const EMERALD = "0.72 0.15 152";
const RUBY = "0.66 0.19 25";

function fmtPx(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 50 ? 2 : 4 });
}

export function PortfolioDeck({ holdings, cash = [] }: { holdings: HoldingWithMetrics[]; cash?: CashBalance[] }) {
  const [colorBy, setColorBy] = useState<"daily" | "total">("daily");
  const [includeCash, setIncludeCash] = useState(true);
  const [selected, setSelected] = useState<string>("");

  // All accounts present, and which are currently visible (default all on).
  const accounts = useMemo(
    () => [...new Set([...holdings.map((h) => h.account), ...cash.map((c) => c.account)])].sort(),
    [holdings, cash],
  );
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = (a: string) => !hidden.has(a);
  const toggleAccount = (a: string) =>
    setHidden((prev) => { const n = new Set(prev); n.has(a) ? n.delete(a) : n.add(a); return n; });

  // Holdings shown in the heatmap: visible accounts + optional synthetic cash tiles.
  const treemapHoldings = useMemo(() => {
    const list = holdings.filter((h) => visible(h.account));
    if (!includeCash) {
      return list.filter((h) => {
        const t = h.ticker.toUpperCase(); const s = h.sector.toLowerCase(); const a = h.account.toLowerCase();
        const isCash = t === "CASH" || s === "cash" || ["cash", "hysa", "checking", "savings"].some((w) => a.includes(w));
        return !isCash;
      });
    }
    const cashLeaves: HoldingWithMetrics[] = cash
      .filter((c) => visible(c.account) && c.balance > 0)
      .map((c) => ({
        id: `cash-${c.account}`, ticker: "CASH", name: c.label || `${c.account} Cash`, sector: "Cash",
        shares: c.balance, costBasis: 1, currentPrice: 1, account: c.account,
        value: c.balance, costTotal: c.balance, gainDollar: 0, gainPercent: 0, todayChangePct: 0,
      }));
    return [...list, ...cashLeaves];
  }, [holdings, cash, hidden, includeCash]);

  // Default selection = largest visible non-cash holding; keep valid as filters change.
  const selectableTickers = useMemo(
    () => treemapHoldings.filter((h) => h.ticker !== "CASH").sort((a, b) => b.value - a.value).map((h) => h.ticker),
    [treemapHoldings],
  );
  useEffect(() => {
    if (selectableTickers.length === 0) { if (selected) setSelected(""); return; }
    if (!selected || !selectableTickers.includes(selected)) setSelected(selectableTickers[0]);
  }, [selectableTickers, selected]);

  const selectedHolding = holdings.find((h) => h.ticker === selected) ?? null;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <div className="flex flex-col gap-4 max-w-[1500px]">
        {/* ── controls ── */}
        <div className="flex items-center gap-x-5 gap-y-2 flex-wrap">
          {accounts.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground">Accounts:</span>
              {accounts.map((a) => {
                const on = visible(a);
                return (
                  <button
                    key={a}
                    onClick={() => toggleAccount(a)}
                    aria-pressed={on}
                    title={on ? `${a} — shown (click to hide)` : `${a} — hidden (click to show)`}
                    className="text-xs px-2 py-1 rounded-sm border transition-colors"
                    style={{
                      borderColor: "var(--border)",
                      background: on ? "oklch(0.18 0 0)" : "transparent",
                      color: on ? "oklch(0.92 0.005 74)" : "oklch(0.45 0.008 74)",
                      textDecoration: on ? "none" : "line-through",
                    }}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
          )}
          <Segmented
            label="Color by"
            options={[["daily", "Daily"], ["total", "Total"]]}
            value={colorBy}
            onChange={(v) => setColorBy(v as "daily" | "total")}
          />
          <Segmented
            label="Cash"
            options={[["in", "Include"], ["out", "Exclude"]]}
            value={includeCash ? "in" : "out"}
            onChange={(v) => setIncludeCash(v === "in")}
          />
          <div className="flex items-center gap-2 ml-auto" aria-hidden>
            <span className="text-xs font-mono text-muted-foreground">{colorBy === "daily" ? "−3%" : "−20%"}</span>
            <div className="h-2.5 w-24 rounded-sm border border-border" style={{
              background: `linear-gradient(to right, oklch(${RUBY} / 0.80), oklch(${RUBY} / 0.22), oklch(0.20 0 0), oklch(${EMERALD} / 0.22), oklch(${EMERALD} / 0.80))`,
            }} />
            <span className="text-xs font-mono text-muted-foreground">{colorBy === "daily" ? "+3%" : "+20%"}</span>
          </div>
        </div>

        {/* ── heatmap ── */}
        <section className="rounded-md border border-border bg-card p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Portfolio Heatmap</h2>
            <p className="text-xs text-muted-foreground">Click a holding to chart it.</p>
          </div>
          <div style={{ height: 340 }}>
            {treemapHoldings.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-muted-foreground">No positions to show — adjust account filters.</p>
              </div>
            ) : (
              <HoldingsTreemap holdings={treemapHoldings} colorBy={colorBy} onSelect={setSelected} selected={selected} />
            )}
          </div>
        </section>

        {/* ── selected-ticker chart ── */}
        <section className="rounded-md border border-border bg-card p-4 flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-medium text-foreground leading-tight">{selectedHolding?.name ?? selected ?? "—"}</h2>
              <p className="text-xs font-mono text-muted-foreground">{selected || "—"}{selectedHolding ? ` · ${selectedHolding.sector || "—"}` : ""}</p>
            </div>
            {selectedHolding && (
              <div className="text-right">
                <div className="text-2xl font-mono tabular-nums leading-none text-foreground">{fmtPx(selectedHolding.currentPrice)}</div>
                <div className="text-sm font-mono tabular-nums mt-1" style={{ color: selectedHolding.todayChangePct >= 0 ? "var(--positive)" : "var(--negative)" }}>
                  {selectedHolding.todayChangePct >= 0 ? "+" : ""}{selectedHolding.todayChangePct.toFixed(2)}% today
                </div>
              </div>
            )}
          </div>
          {selected ? <TickerChart symbol={selected} /> : <p className="text-sm text-muted-foreground py-8 text-center">Select a holding above to see its price chart.</p>}
        </section>

        {/* ── 30-day activity ── */}
        <ActivityFeed accounts={accounts} hidden={hidden} />
      </div>
    </div>
  );
}

function Segmented({ label, options, value, onChange }: {
  label: string; options: [string, string][]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}:</span>
      <div className="flex items-center rounded-sm border border-border overflow-hidden">
        {options.map(([v, lbl]) => {
          const on = value === v;
          return (
            <button
              key={v}
              onClick={() => onChange(v)}
              aria-pressed={on}
              className="text-xs px-2.5 py-1 transition-colors"
              style={{ background: on ? "oklch(0.16 0 0)" : "transparent", color: on ? "var(--primary)" : "oklch(0.64 0.008 74)" }}
            >
              {lbl}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Per-ticker price chart ─── */
const CHART_RANGES: SeriesRange[] = ["1D", "5D", "1M", "6M", "YTD"];

function TickerChart({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<SeriesRange>("1M");
  const [series, setSeries] = useState<{ date: string; price: number }[] | null>(null);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSeries(null);
    fetch(`/api/paper/series?symbol=${encodeURIComponent(symbol)}&range=${range}`)
      .then((r) => r.json())
      .then((d) => { if (cancelled) return; setSeries(d.data ?? []); setPct(d.changePct ?? 0); })
      .catch(() => { if (!cancelled) setSeries([]); });
    return () => { cancelled = true; };
  }, [symbol, range]);

  const color = pct >= 0 ? "var(--positive)" : "var(--negative)";
  const intraday = range === "1D" || range === "5D";
  const gid = `pf-${symbol.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 self-end p-0.5 rounded-sm" style={{ background: "oklch(0.10 0 0)" }}>
        {CHART_RANGES.map((r) => {
          const on = range === r;
          return (
            <button key={r} onClick={() => setRange(r)} aria-pressed={on}
              className="rounded-sm px-2 py-0.5 text-[11px] font-mono transition-colors"
              style={{ background: on ? "var(--card)" : "transparent", color: on ? "var(--primary)" : "oklch(0.64 0.008 74)" }}>
              {r}
            </button>
          );
        })}
      </div>
      <div style={{ height: 220 }}>
        {series === null ? (
          <div className="skeleton h-full w-full rounded-md" />
        ) : series.length < 2 ? (
          <div className="flex items-center justify-center h-full"><p className="text-xs text-muted-foreground">No price data available.</p></div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "oklch(0.64 0.008 74)" }}
                tickFormatter={(d: string) => (intraday ? d.slice(11, 16) : d.slice(5))} minTickGap={32} stroke="oklch(0.20 0 0)" />
              <YAxis tick={{ fontSize: 10, fill: "oklch(0.64 0.008 74)" }} tickFormatter={(v: number) => fmtPx(v)} domain={["auto", "auto"]} width={52} stroke="oklch(0.20 0 0)" />
              <Tooltip
                contentStyle={{ background: "oklch(0.12 0 0)", border: "1px solid oklch(0.20 0 0)", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "oklch(0.64 0.008 74)" }}
                labelFormatter={(d) => (intraday ? String(d).slice(0, 16).replace("T", " ") : String(d))}
                formatter={(v) => [fmtPx(Number(v)), "Price"] as [string, string]} />
              <Area type="monotone" dataKey="price" stroke={color} strokeWidth={1.5} fill={`url(#${gid})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

/* ─── 30-day activity feed ─── */
const TYPE_FILTERS: { key: string; label: string; match: (t: ActivityType) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "buy", label: "Buys", match: (t) => t === "BUY" },
  { key: "sell", label: "Sells", match: (t) => t === "SELL" },
  { key: "div", label: "Dividends", match: (t) => t === "DIV" },
  { key: "cash", label: "Deposits", match: (t) => t === "DEPOSIT" || t === "WITHDRAWAL" },
];

const TYPE_LABEL: Record<ActivityType, string> = {
  BUY: "Buy", SELL: "Sell", DIV: "Dividend", DEPOSIT: "Deposit", WITHDRAWAL: "Withdrawal",
  INTEREST: "Interest", FEE: "Fee", TRANSFER: "Transfer", OTHER: "Other",
};

// Per-type badge colors (tinted chip: low-chroma bg + brighter same-hue text).
// Only the four requested types are colored; everything else stays neutral.
const NEUTRAL_BADGE = { bg: "oklch(0.16 0 0)", fg: "oklch(0.72 0.008 74)" };
const TYPE_BADGE: Partial<Record<ActivityType, { bg: string; fg: string }>> = {
  BUY: { bg: "oklch(0.22 0.04 240)", fg: "oklch(0.74 0.09 240)" },   // steel blue — acquiring
  SELL: { bg: "oklch(0.22 0.05 28)", fg: "oklch(0.72 0.13 28)" },    // red — exiting
  DIV: { bg: "oklch(0.22 0.05 74)", fg: "oklch(0.78 0.12 74)" },     // amber — income (on-brand)
  DEPOSIT: { bg: "oklch(0.22 0.04 150)", fg: "oklch(0.74 0.10 150)" }, // green — cash in
};

function ActivityFeed({ accounts, hidden }: { accounts: string[]; hidden: Set<string> }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [hasLedger, setHasLedger] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/transactions/recent?days=30")
      .then((r) => r.json())
      .then((d) => { if (cancelled) return; setItems(d.items ?? []); setHasLedger(d.hasLedger ?? false); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  const active = TYPE_FILTERS.find((f) => f.key === filter) ?? TYPE_FILTERS[0];
  const shown = (items ?? []).filter(
    (it) => active.match(it.type) && (it.account == null || !hidden.has(it.account)),
  );

  return (
    <section className="rounded-md border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Activity · last 30 days</h2>
        <div className="flex items-center gap-1 p-0.5 rounded-sm" style={{ background: "oklch(0.10 0 0)" }}>
          {TYPE_FILTERS.map((f) => {
            const on = filter === f.key;
            return (
              <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={on}
                className="rounded-sm px-2.5 py-1 text-xs transition-colors"
                style={{ background: on ? "var(--card)" : "transparent", color: on ? "var(--primary)" : "oklch(0.64 0.008 74)" }}>
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {!hasLedger && (filter === "buy" || filter === "cash") && (
        <p className="text-xs text-muted-foreground">
          Buys and deposits populate from the transactions ledger (not yet wired) — sells and dividends are shown from live records.
        </p>
      )}

      {items === null ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton rounded-sm" style={{ height: 40 }} />)}
        </div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3">No activity in the last 30 days{filter !== "all" ? ` for “${active.label}”` : ""}.</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((it) => (
            <li key={it.id} className="flex items-center gap-3 py-2 border-b border-border/60 last:border-0 text-sm">
              <span className="text-xs text-muted-foreground font-mono w-14 shrink-0">
                {new Date(`${it.date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "2-digit" })}
              </span>
              <TypeBadge type={it.type} />
              <span className="font-mono text-foreground w-16 shrink-0 truncate">{it.symbol ?? "—"}</span>
              <span className="text-muted-foreground flex-1 truncate text-xs">
                {it.description}
                {it.shares != null && it.price != null && (
                  <span className="font-mono"> · {it.shares} @ {fmtPx(it.price)}</span>
                )}
              </span>
              {it.account && <span className="text-[10px] text-muted-foreground hidden sm:block shrink-0">{it.account}</span>}
              {it.type === "DIV" && it.amount === 0 && it.gross > 0 ? (
                <span className="font-mono tabular-nums w-24 text-right shrink-0 text-muted-foreground" title="Reinvested — no cash impact">
                  ↻ {formatCurrency(it.gross)}
                </span>
              ) : (
                <span className="font-mono tabular-nums w-24 text-right shrink-0" style={{ color: it.amount >= 0 ? "var(--positive)" : "var(--negative)" }}>
                  {it.amount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(it.amount))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TypeBadge({ type }: { type: ActivityType }) {
  const c = TYPE_BADGE[type] ?? NEUTRAL_BADGE;
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-sm w-16 text-center shrink-0"
      style={{ background: c.bg, color: c.fg }}>
      {TYPE_LABEL[type]}
    </span>
  );
}
