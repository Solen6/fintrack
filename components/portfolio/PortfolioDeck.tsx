"use client";

import { useEffect, useMemo, useState } from "react";
import nextDynamic from "next/dynamic";
import { formatCurrency } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";
import { isFaceValueBond, isDerivative } from "@/lib/types";
import type { HoldingWithMetrics } from "@/lib/types";
import { recognizeStrategy } from "@/lib/option-strategies";
import { netCost, OPTION_MULTIPLIER } from "@/lib/options-math";
import { toLeg, PayoffPanel } from "./DerivativesView";

/** Merge the legs of each multi-leg strategy into ONE synthetic holding so the
 *  heatmap shows an iron condor as a single tile, not four. The synthetic row
 *  keeps the comboId, so the insights panel still finds the REAL legs for the
 *  payoff chart. One-leg combos (partially closed strategies) stay as-is. */
function mergeComboLegs(list: HoldingWithMetrics[]): HoldingWithMetrics[] {
  const out: HoldingWithMetrics[] = [];
  const combos = new Map<string, HoldingWithMetrics[]>();
  for (const h of list) {
    if (h.instrumentType === "option" && h.comboId) {
      const g = combos.get(h.comboId);
      if (g) g.push(h); else combos.set(h.comboId, [h]);
    } else out.push(h);
  }
  const seen = new Map<string, number>();
  for (const [comboId, rows] of combos) {
    if (rows.length === 1) { out.push(rows[0]); continue; }
    const legs = rows.map(toLeg);
    const strat = recognizeStrategy(legs) ?? `${rows.length}-leg strategy`;
    const first = rows[0];
    const value = rows.reduce((s, r) => s + r.value, 0);
    const costTotal = rows.reduce((s, r) => s + r.shares * r.costBasis, 0);
    const gainDollar = rows.reduce((s, r) => s + r.gainDollar, 0);
    const baseQty = Math.min(...legs.map((l) => l.qty)) || 1;
    // Ticker doubles as selection identity + header subtitle — keep it human
    // ("SPY Iron Condor") and de-collide repeats.
    let ticker = `${first.underlying} ${strat}`;
    const n = (seen.get(ticker) ?? 0) + 1;
    seen.set(ticker, n);
    if (n > 1) ticker = `${ticker} (${n})`;
    out.push({
      ...first,
      id: `combo-${comboId}`,
      ticker,
      name: `${strat} — ${first.underlying}`,
      value,
      costTotal,
      gainDollar,
      gainPercent: costTotal !== 0 ? (gainDollar / Math.abs(costTotal)) * 100 : 0,
      todayChangePct: 0,
      // Net live mark per 1× spread (negative = the position is a liability).
      currentPrice: value / (OPTION_MULTIPLIER * baseQty),
      sector: "Derivatives",
    });
  }
  return out;
}
import type { ActivityItem, ActivityType } from "@/app/api/transactions/recent/route";
import type { SeriesRange } from "@/app/api/paper/series/route";
import type { HeatmapView, HeatmapGroup } from "@/app/api/heatmap-views/route";
import type { StockStats } from "@/lib/yahoo";
import { RatingBadge, RatingBar, useRatings } from "@/components/ratings/RatingBadge";

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
function fmtBigUsd(v: number): string {
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toLocaleString("en-US")}`;
}
function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toLocaleString("en-US");
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

  // Holdings shown in the heatmap: visible accounts + optional synthetic cash
  // tiles, with multi-leg strategies merged into one tile each.
  const treemapHoldings = useMemo(() => {
    const list = mergeComboLegs(holdings.filter((h) => visible(h.account)));
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

  // ── Saved custom heatmap views ("Auto" is implicit + never stored) ──
  const [views, setViews] = useState<HeatmapView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string>("auto"); // "auto" | view.id
  const [editing, setEditing] = useState(false);
  const [viewsMsg, setViewsMsg] = useState("");

  useEffect(() => {
    fetch("/api/heatmap-views")
      .then((r) => r.json())
      .then((d) => {
        if (d.needsMigration) setViewsMsg("Run supabase/heatmap-views.sql to save custom layouts.");
        setViews(d.views ?? []);
      })
      .catch(() => {});
  }, []);

  // If the active view was deleted (elsewhere), fall back to Auto.
  useEffect(() => {
    if (activeViewId !== "auto" && !views.some((v) => v.id === activeViewId)) {
      setActiveViewId("auto");
      setEditing(false);
    }
  }, [views, activeViewId]);

  const activeView = activeViewId === "auto" ? null : views.find((v) => v.id === activeViewId) ?? null;

  // Auto-detected sectors of what's currently shown → seed a new custom view so
  // it opens looking like Auto, with sectors you can then rename/reorganize.
  const seedGroups = useMemo<HeatmapGroup[]>(() => {
    const map = new Map<string, { id: string; value: number }[]>();
    for (const h of treemapHoldings) {
      const isCash = h.ticker === "CASH" && (h.sector || "").toLowerCase() === "cash";
      const sector = isCash ? "Cash" : ((h.sector ?? "").trim() && h.sector !== "Other" ? h.sector : "Other");
      if (!map.has(sector)) map.set(sector, []);
      map.get(sector)!.push({ id: h.id, value: h.value });
    }
    return [...map.entries()]
      .map(([name, items]) => ({
        name,
        ids: items.sort((a, b) => b.value - a.value).map((i) => i.id),
        total: items.reduce((s, i) => s + i.value, 0),
      }))
      .sort((a, b) => b.total - a.total)
      .map(({ name, ids }) => ({ name, ids }));
  }, [treemapHoldings]);

  // Active view's sectors: stored groups, or a single unnamed (flat) group.
  const activeGroups = useMemo<HeatmapGroup[] | undefined>(() => {
    if (!activeView) return undefined;
    if (activeView.groups && activeView.groups.length) return activeView.groups;
    return [{ name: "", ids: activeView.ordering ?? [] }];
  }, [activeView]);

  const selectView = (id: string) => { setActiveViewId(id); setEditing(false); };

  const createView = async () => {
    setViewsMsg("");
    const name = `Custom view ${views.length + 1}`;
    const ordering = seedGroups.flatMap((g) => g.ids);
    const res = await fetch("/api/heatmap-views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ordering, groups: seedGroups }),
    });
    const d = await res.json();
    if (!res.ok) { setViewsMsg(d.error ?? "Couldn't create view"); return; }
    setViews((v) => [...v, d.view]);
    setActiveViewId(d.view.id);
    setEditing(true);
  };

  const persistGroups = (id: string, groups: HeatmapGroup[]) => {
    const ordering = groups.flatMap((g) => g.ids);
    setViews((v) => v.map((x) => (x.id === id ? { ...x, groups, ordering } : x))); // optimistic
    fetch("/api/heatmap-views", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, groups, ordering }),
    }).catch(() => {});
  };

  const addSector = () => {
    if (!activeView || !activeGroups) return;
    const n = activeGroups.filter((g) => /^Sector \d+$/.test(g.name)).length + 1;
    persistGroups(activeView.id, [...activeGroups, { name: `Sector ${n}`, ids: [] }]);
  };

  const renameView = (id: string) => {
    const cur = views.find((v) => v.id === id);
    if (!cur) return;
    const name = window.prompt("Rename view", cur.name)?.trim();
    if (!name || name === cur.name) return;
    setViews((v) => v.map((x) => (x.id === id ? { ...x, name } : x)));
    fetch("/api/heatmap-views", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name }),
    }).catch(() => {});
  };

  const deleteView = (id: string) => {
    if (!window.confirm("Delete this heatmap view?")) return;
    setViews((v) => v.filter((x) => x.id !== id));
    if (activeViewId === id) { setActiveViewId("auto"); setEditing(false); }
    fetch("/api/heatmap-views", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  };

  // Search the treemap rows first — merged strategy tiles only exist there.
  const selectedHolding =
    treemapHoldings.find((h) => h.ticker === selected) ??
    holdings.find((h) => h.ticker === selected) ??
    null;
  const selFaceBond = selectedHolding ? isFaceValueBond(selectedHolding) : false;
  const selDeriv = selectedHolding ? isDerivative(selectedHolding) : false;

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
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h2 className="text-xs uppercase tracking-wide text-muted-foreground mr-1">Heatmap</h2>
              {/* View tabs: Auto (traditional) + saved custom layouts */}
              <ViewPill label="Auto" active={activeViewId === "auto"} onClick={() => selectView("auto")} />
              {views.map((v) => (
                <ViewPill key={v.id} label={v.name} active={activeViewId === v.id} onClick={() => selectView(v.id)} />
              ))}
              <button
                onClick={createView}
                title="New custom view from the current layout"
                className="text-xs px-2 py-1 rounded-sm border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-[var(--primary)] transition-colors"
              >
                + New
              </button>
            </div>
            <div className="flex items-center gap-2">
              {activeView ? (
                <>
                  {editing && (
                    <button
                      onClick={addSector}
                      className="text-xs px-2 py-1 rounded-sm border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-[var(--primary)] transition-colors"
                      title="Add a new named sector, then drag holdings into it"
                    >
                      + Sector
                    </button>
                  )}
                  <button
                    onClick={() => setEditing((e) => !e)}
                    aria-pressed={editing}
                    className="text-xs px-2.5 py-1 rounded-sm border transition-colors"
                    style={{
                      borderColor: editing ? "var(--primary)" : "var(--border)",
                      background: editing ? "oklch(0.72 0.14 74 / 0.14)" : "transparent",
                      color: editing ? "var(--primary)" : "oklch(0.64 0.008 74)",
                    }}
                  >
                    {editing ? "Done arranging" : "Edit layout"}
                  </button>
                  <button onClick={() => renameView(activeView.id)} className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground transition-colors">Rename</button>
                  <button onClick={() => deleteView(activeView.id)} className="text-xs px-2 py-1 text-muted-foreground transition-colors" style={{ color: "oklch(0.55 0.12 28)" }}>Delete</button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Click a holding to chart it.</p>
              )}
            </div>
          </div>
          {(editing || viewsMsg) && (
            <p className="text-xs" style={{ color: viewsMsg ? "var(--negative)" : "var(--primary)" }}>
              {viewsMsg || "Drag tiles to reorder or move them between sectors — click a sector name to rename it. Saves automatically; sizes still track position value."}
            </p>
          )}
          <div style={{ height: 440 }}>
            {treemapHoldings.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <p className="text-sm text-muted-foreground">No positions to show — adjust account filters.</p>
              </div>
            ) : (
              <HoldingsTreemap
                holdings={treemapHoldings}
                colorBy={colorBy}
                onSelect={setSelected}
                selected={selected}
                layout={activeView ? "custom" : "sector"}
                groups={activeGroups}
                editable={!!activeView && editing}
                onGroupsChange={activeView ? (g) => persistGroups(activeView.id, g) : undefined}
              />
            )}
          </div>
        </section>

        {/* ── selected-holding: chart + insights ── */}
        <section className="rounded-md border border-border bg-card p-4 flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-medium text-foreground leading-tight">{selectedHolding?.name ?? selected ?? "—"}</h2>
              <p className="text-xs font-mono text-muted-foreground">{selected || "—"}{selectedHolding ? ` · ${selectedHolding.sector || "—"}` : ""}</p>
            </div>
            {selectedHolding && (
              <div className="text-right">
                <div className="text-2xl font-mono tabular-nums leading-none text-foreground">
                  {selFaceBond ? (selectedHolding.currentPrice * 100).toFixed(2) : fmtPx(selectedHolding.currentPrice)}
                </div>
                {selFaceBond && selectedHolding.bondMetrics ? (
                  <div className="text-sm font-mono tabular-nums mt-1 text-muted-foreground">
                    {selectedHolding.bondMetrics.ytm.toFixed(2)}% YTM
                  </div>
                ) : selDeriv ? (
                  // Derivative marks carry no prev-close, so "today" is meaningless —
                  // show the position's overall return instead.
                  <div className="text-sm font-mono tabular-nums mt-1" style={{ color: selectedHolding.gainPercent >= 0 ? "var(--positive)" : "var(--negative)" }}>
                    <Sensitive>{selectedHolding.gainPercent >= 0 ? "+" : ""}{selectedHolding.gainPercent.toFixed(2)}%</Sensitive> overall
                  </div>
                ) : (
                  <div className="text-sm font-mono tabular-nums mt-1" style={{ color: selectedHolding.todayChangePct >= 0 ? "var(--positive)" : "var(--negative)" }}>
                    {selectedHolding.todayChangePct >= 0 ? "+" : ""}{selectedHolding.todayChangePct.toFixed(2)}% today
                  </div>
                )}
              </div>
            )}
          </div>
          {selected ? (
            selDeriv && selectedHolding ? (
              <DerivativeInsights holding={selectedHolding} all={holdings} />
            ) : selFaceBond ? (
              <BondInsights holding={selectedHolding} />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                {/* price chart */}
                <div className="lg:col-span-3 min-w-0">
                  <TickerChart symbol={selected} />
                </div>
                {/* insights table */}
                <div className="lg:col-span-2 min-w-0">
                  <HoldingInsights symbol={selected} holding={selectedHolding} />
                </div>
              </div>
            )
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">Select a holding above to see its price chart and insights.</p>
          )}
        </section>

        {/* ── 30-day activity ── */}
        <ActivityFeed accounts={accounts} hidden={hidden} />
      </div>
    </div>
  );
}

function ViewPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="text-xs px-2.5 py-1 rounded-sm border transition-colors max-w-[160px] truncate"
      style={{
        borderColor: active ? "var(--primary)" : "var(--border)",
        background: active ? "oklch(0.72 0.14 74 / 0.14)" : "transparent",
        color: active ? "var(--primary)" : "oklch(0.7 0.008 74)",
      }}
      title={label}
    >
      {label}
    </button>
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

/* ─── Selected-holding insights: live market stats + your position ─── */
function HoldingInsights({ symbol, holding }: { symbol: string; holding: HoldingWithMetrics | null }) {
  const [stats, setStats] = useState<StockStats | null>(null);
  const [loading, setLoading] = useState(false);
  const ratingSymbols = useMemo(() => (symbol ? [symbol] : []), [symbol]);
  const { ratings, loading: ratingLoading } = useRatings(ratingSymbols);
  const rating = ratings[symbol.toUpperCase()] ?? null;

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setStats(null);
    setLoading(true);
    fetch(`/api/stocks/detail?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d: { stats?: StockStats | null }) => { if (!cancelled) setStats(d.stats ?? null); })
      .catch(() => { if (!cancelled) setStats(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  const price = stats?.price ?? holding?.currentPrice ?? null;
  const rangePos = (lo: number | null | undefined, hi: number | null | undefined, p: number | null) =>
    lo != null && hi != null && p != null && hi > lo ? Math.max(0, Math.min(1, (p - lo) / (hi - lo))) : null;
  const gainTone = holding ? (holding.gainDollar >= 0 ? "var(--positive)" : "var(--negative)") : undefined;

  return (
    <div className="flex flex-col gap-3 h-full">
      <div>
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Key Stats</h3>
        <div className="grid grid-cols-2 gap-px rounded-sm overflow-hidden" style={{ background: "var(--border)" }}>
          <Stat label="Market cap" value={stats?.marketCap != null ? fmtBigUsd(stats.marketCap) : "—"} loading={loading} />
          <Stat label="P / E" value={stats?.trailingPE != null ? stats.trailingPE.toFixed(1) : "—"} loading={loading} />
          <Stat label="Div yield" value={stats?.dividendYield != null ? `${(stats.dividendYield * 100).toFixed(2)}%` : "—"} loading={loading} />
          <Stat label="Volume" value={stats?.volume != null ? fmtVol(stats.volume) : "—"} loading={loading} />
          <Stat
            label="Day range"
            value={stats?.dayLow != null && stats?.dayHigh != null ? `${fmtPx(stats.dayLow)}–${fmtPx(stats.dayHigh)}` : "—"}
            loading={loading}
            pos={rangePos(stats?.dayLow, stats?.dayHigh, price)}
          />
          <Stat
            label="52-wk range"
            value={stats?.weekLow52 != null && stats?.weekHigh52 != null ? `${fmtPx(stats.weekLow52)}–${fmtPx(stats.weekHigh52)}` : "—"}
            loading={loading}
            pos={rangePos(stats?.weekLow52, stats?.weekHigh52, price)}
          />
        </div>
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Analyst Rating</h3>
        {rating ? (
          <div className="flex flex-col gap-2">
            <RatingBadge rating={rating} />
            <RatingBar rating={rating} />
          </div>
        ) : (
          <RatingBadge rating={null} loading={ratingLoading} />
        )}
      </div>

      {holding && (
        <div>
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Your position</h3>
          <div className="grid grid-cols-2 gap-px rounded-sm overflow-hidden" style={{ background: "var(--border)" }}>
            <Stat label="Shares" value={<Sensitive>{holding.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}</Sensitive>} />
            <Stat label="Market value" value={<Sensitive>{formatCurrency(holding.value)}</Sensitive>} />
            <Stat label="Avg cost" value={<Sensitive>{formatCurrency(holding.costBasis)}</Sensitive>} />
            <Stat
              label="Unrealized"
              value={
                <>
                  <Sensitive>{holding.gainDollar >= 0 ? "+" : "−"}{formatCurrency(Math.abs(holding.gainDollar))}</Sensitive>
                  {" · "}<Sensitive>{`${holding.gainPercent >= 0 ? "+" : ""}${holding.gainPercent.toFixed(2)}%`}</Sensitive>
                </>
              }
              tone={gainTone}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Selected-bond insights: fixed-income analytics + your position ─── */
function fmtBondDate(iso?: string | null): string {
  if (!iso) return "—";
  const [y, mo, d] = iso.slice(0, 10).split("-");
  return `${mo}/${d}/${y.slice(2)}`;
}

/* ─── Selected-option insights: contract/strategy stats + the same payoff
       analytics the Options/Futures tab shows. A leg of a multi-leg strategy
       pulls in its combo siblings so the payoff reflects the WHOLE position. ─── */
function DerivativeInsights({ holding, all }: { holding: HoldingWithMetrics; all: HoldingWithMetrics[] }) {
  const rows = holding.comboId ? all.filter((h) => h.comboId === holding.comboId) : [holding];
  const isCombo = rows.length > 1;
  const legs = rows.map(toLeg);
  const name = isCombo
    ? recognizeStrategy(legs) ?? `${rows.length}-leg strategy`
    : `${holding.direction === "SHORT" ? "Short" : "Long"} ${holding.optionType === "PUT" ? "Put" : "Call"}`;
  const entry = netCost(legs); // >0 debit paid, <0 credit received
  const value = rows.reduce((s, r) => s + r.value, 0);
  const gain = rows.reduce((s, r) => s + r.gainDollar, 0);
  const gainTone = gain >= 0 ? "var(--positive)" : "var(--negative)";
  const contracts = Math.abs(holding.shares) / (holding.multiplier || 1);
  const expiry = rows[0]?.expiry;
  const days = expiry ? Math.ceil((new Date(`${expiry.slice(0, 10)}T00:00:00Z`).getTime() - Date.now()) / 86_400_000) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-px rounded-sm overflow-hidden" style={{ background: "var(--border)" }}>
        <Stat label="Position" value={name} />
        {isCombo ? (
          <>
            <Stat label="Legs" value={rows.length} />
            <Stat label={entry >= 0 ? "Net debit" : "Net credit"} value={<Sensitive>{formatCurrency(Math.abs(entry))}</Sensitive>} />
          </>
        ) : (
          <>
            <Stat label="Strike × contracts" value={`${formatCurrency(holding.strike ?? 0)} × ${contracts % 1 === 0 ? contracts : contracts.toFixed(2)}`} />
            <Stat label="Entry → live" value={`${formatCurrency(holding.costBasis)} → ${formatCurrency(holding.currentPrice)}`} />
          </>
        )}
        <Stat label="Expiry" value={expiry ? `${fmtBondDate(expiry)}${days != null ? ` (${days <= 0 ? "expired" : `${days}d`})` : ""}` : "—"} />
        <Stat label="Market value" value={<Sensitive>{formatCurrency(value)}</Sensitive>} />
        <Stat
          label="Unrealized"
          tone={gainTone}
          value={
            <Sensitive>{gain >= 0 ? "+" : "−"}{formatCurrency(Math.abs(gain))}</Sensitive>
          }
        />
      </div>
      <PayoffPanel rows={rows} />
    </div>
  );
}

function BondInsights({ holding }: { holding: HoldingWithMetrics | null }) {
  if (!holding) return null;
  const m = holding.bondMetrics;
  const gainTone = holding.gainDollar >= 0 ? "var(--positive)" : "var(--negative)";
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Bond details</h3>
        <div className="grid grid-cols-2 gap-px rounded-sm overflow-hidden" style={{ background: "var(--border)" }}>
          <Stat label="Coupon" value={`${(holding.couponRate ?? 0).toFixed(2)}%`} />
          <Stat label="Maturity" value={fmtBondDate(holding.maturityDate)} />
          <Stat label="YTM" value={m ? `${m.ytm.toFixed(2)}%` : "—"} />
          <Stat label="Current yield" value={m ? `${m.currentYield.toFixed(2)}%` : "—"} />
          <Stat label="Duration" value={m ? `${m.modifiedDuration.toFixed(1)}y` : "—"} />
          <Stat label="Accrued" value={<Sensitive>{m ? formatCurrency(m.accrued) : "—"}</Sensitive>} />
        </div>
      </div>
      <div>
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Your position</h3>
        <div className="grid grid-cols-2 gap-px rounded-sm overflow-hidden" style={{ background: "var(--border)" }}>
          <Stat label="Face value" value={<Sensitive>{formatCurrency(holding.shares)}</Sensitive>} />
          <Stat label="Market value" value={<Sensitive>{formatCurrency(holding.value)}</Sensitive>} />
          <Stat label="Avg price" value={(holding.costBasis * 100).toFixed(2)} />
          <Stat label="Price" value={(holding.currentPrice * 100).toFixed(2)} />
          <Stat label="Next coupon" value={m?.nextCouponDate ? fmtBondDate(m.nextCouponDate) : "—"} />
          <Stat
            label="Unrealized"
            tone={gainTone}
            value={
              <>
                <Sensitive>{holding.gainDollar >= 0 ? "+" : "−"}{formatCurrency(Math.abs(holding.gainDollar))}</Sensitive>
                {" · "}<Sensitive>{`${holding.gainPercent >= 0 ? "+" : ""}${holding.gainPercent.toFixed(2)}%`}</Sensitive>
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, loading, pos, tone }: { label: string; value: React.ReactNode; loading?: boolean; pos?: number | null; tone?: string }) {
  return (
    <div className="bg-card px-3 py-2.5 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {loading ? (
        <span className="skeleton rounded-sm" style={{ height: 14, width: "60%" }} />
      ) : (
        <span className={`text-sm font-mono tabular-nums ${tone ? "" : "text-foreground"}`} style={tone ? { color: tone } : undefined}>{value}</span>
      )}
      {/* range-position marker (low ▏ ··●·· ▕ high) */}
      {pos != null && !loading && (
        <div className="relative mt-0.5 h-1 rounded-full" style={{ background: "oklch(0.20 0 0)" }}>
          <div
            className="absolute top-1/2 h-2 w-2 rounded-full -translate-y-1/2 -translate-x-1/2"
            style={{ left: `${pos * 100}%`, background: "var(--primary)" }}
          />
        </div>
      )}
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
                  <span className="font-mono"> · <Sensitive>{it.shares}</Sensitive> @ <Sensitive>{fmtPx(it.price)}</Sensitive></span>
                )}
              </span>
              {it.account && <span className="text-[10px] text-muted-foreground hidden sm:block shrink-0">{it.account}</span>}
              {it.type === "DIV" && it.amount === 0 && it.gross > 0 ? (
                <span className="font-mono tabular-nums w-24 text-right shrink-0 text-muted-foreground" title="Reinvested — no cash impact">
                  ↻ <Sensitive>{formatCurrency(it.gross)}</Sensitive>
                </span>
              ) : (
                <span className="font-mono tabular-nums w-24 text-right shrink-0" style={{ color: it.amount >= 0 ? "var(--positive)" : "var(--negative)" }}>
                  <Sensitive>{it.amount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(it.amount))}</Sensitive>
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
