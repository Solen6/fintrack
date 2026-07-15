"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { WatchlistItem } from "@/app/api/watchlist/route";
import { RatingBadge, RatingBar, useRatings } from "@/components/ratings/RatingBadge";

/* Watchlist — stocks you're WATCHING, not holding. Heatmap tiles colored by
   % move since you started watching (or today), plus a table with analyst
   ratings. No dollar amounts anywhere → nothing to mask in Private mode. */

const EMERALD = "0.72 0.15 152";
const RUBY = "0.66 0.19 25";

type ColorMode = "since" | "today";
// Since-added moves can run to double digits; day moves rarely past ~3%.
const FULL_SCALE: Record<ColorMode, number> = { since: 25, today: 2.5 };

function tileColor(pct: number | null, mode: ColorMode): string {
  if (pct == null) return "oklch(0.15 0 0)";
  const intensity = Math.min(1, Math.abs(pct) / FULL_SCALE[mode]) ** 0.7;
  const alpha = 0.16 + intensity * 0.6;
  return `oklch(${pct >= 0 ? EMERALD : RUBY} / ${alpha.toFixed(3)})`;
}

const signedPct = (n: number | null, digits = 2) =>
  n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
const pctTone = (n: number | null) =>
  n == null ? "var(--muted-foreground)" : n >= 0 ? "oklch(0.72 0.15 152)" : "var(--negative)";
const fmtPx = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function WatchlistDeck() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ColorMode>("since");
  const [selected, setSelected] = useState<string | null>(null);

  const [ticker, setTicker] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/watchlist");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Failed to load watchlist");
      setItems(d.items ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load watchlist");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const tickers = useMemo(() => items.map((i) => i.ticker), [items]);
  const { ratings, loading: ratingsLoading } = useRatings(tickers);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      const r = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: t }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Couldn't add ticker");
      setTicker("");
      setSelected(t);
      await load();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Couldn't add ticker");
    } finally {
      setAdding(false);
    }
  };

  const remove = async (item: WatchlistItem) => {
    // Optimistic: drop the tile immediately, restore on failure.
    const prev = items;
    setItems((cur) => cur.filter((i) => i.id !== item.id));
    if (selected === item.ticker) setSelected(null);
    const r = await fetch("/api/watchlist", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id }),
    }).catch(() => null);
    if (!r?.ok) setItems(prev);
  };

  const pctFor = (i: WatchlistItem) => (mode === "since" ? i.sincePct : i.dayPct);
  const selectedItem = items.find((i) => i.ticker === selected) ?? null;
  const selectedRating = selectedItem ? ratings[selectedItem.ticker] ?? null : null;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <div className="mx-auto max-w-[1100px] flex flex-col gap-4">
        {/* Add form + color-mode toggle */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <form onSubmit={add} className="flex items-center gap-2">
            <input
              value={ticker}
              onChange={(e) => {
                setTicker(e.target.value.toUpperCase());
                setAddError(null);
              }}
              placeholder="Add ticker — e.g. NVDA"
              maxLength={10}
              className="w-44 rounded-sm border border-border bg-card px-2.5 py-1.5 text-sm font-mono text-foreground placeholder:text-muted-foreground placeholder:font-sans focus:outline-none focus:border-[var(--primary)]"
              aria-label="Ticker to watch"
            />
            <button
              type="submit"
              disabled={adding || !ticker.trim()}
              className="text-xs px-3 py-1.5 rounded-sm disabled:opacity-50"
              style={{ background: "var(--primary)", color: "oklch(0.08 0 0)" }}
            >
              {adding ? "Adding…" : "Watch"}
            </button>
            {addError && (
              <span className="text-xs" style={{ color: "var(--negative)" }}>{addError}</span>
            )}
          </form>
          {items.length > 0 && (
            <div className="flex items-center rounded-sm border border-border p-0.5 gap-0.5">
              {(
                [
                  { key: "since", label: "Since added" },
                  { key: "today", label: "Today" },
                ] as const
              ).map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMode(m.key)}
                  aria-pressed={mode === m.key}
                  className={`px-2.5 py-1 text-xs rounded-[3px] transition-colors ${
                    mode === m.key ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* States */}
        {loading && (
          <div className="grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton rounded-sm h-24" />
            ))}
          </div>
        )}
        {!loading && error && <p className="text-sm text-muted-foreground">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <div className="rounded-md border border-dashed border-border px-6 py-12 text-center">
            <p className="text-sm text-foreground">Not watching anything yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add a ticker above — the price when you add it becomes the baseline for
              &ldquo;% since watching&rdquo;.
            </p>
          </div>
        )}

        {/* Heatmap tiles */}
        {!loading && !error && items.length > 0 && (
          <div className="grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]" role="listbox" aria-label="Watchlist heatmap">
            {items.map((i) => {
              const pct = pctFor(i);
              const isSel = selected === i.ticker;
              return (
                <button
                  key={i.id}
                  role="option"
                  aria-selected={isSel}
                  onClick={() => setSelected(isSel ? null : i.ticker)}
                  className={`h-24 rounded-sm p-2.5 text-left flex flex-col justify-between transition-shadow ${
                    isSel ? "ring-1 ring-[var(--primary)]" : ""
                  }`}
                  style={{ background: tileColor(pct, mode) }}
                  title={`${i.ticker} · ${signedPct(pct)} ${mode === "since" ? `since ${fmtDate(i.addedAt)}` : "today"}`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className="font-mono text-sm text-foreground">{i.ticker}</span>
                    <span className="font-mono text-[11px] text-foreground/70">{fmtPx(i.price)}</span>
                  </div>
                  <div>
                    <span className="font-mono text-lg tabular-nums text-foreground leading-none">
                      {signedPct(pct, Math.abs(pct ?? 0) >= 10 ? 1 : 2)}
                    </span>
                    <span className="block text-[10px] text-foreground/60 mt-1">
                      {mode === "since" ? `since ${fmtDate(i.addedAt)}` : "today"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Selected detail */}
        {selectedItem && (
          <div className="rounded-md border border-border bg-card px-4 py-3 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h2 className="text-base text-foreground leading-tight">
                  {selectedItem.name ?? selectedItem.ticker}
                </h2>
                <p className="text-xs font-mono text-muted-foreground">
                  {selectedItem.ticker} · watching since {fmtDate(selectedItem.addedAt)}
                  {selectedItem.addedPrice != null && ` @ ${fmtPx(selectedItem.addedPrice)}`}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-xl font-mono tabular-nums leading-none text-foreground">
                    {fmtPx(selectedItem.price)}
                  </div>
                  <div className="text-xs font-mono mt-1 flex gap-3">
                    <span style={{ color: pctTone(selectedItem.dayPct) }}>
                      {signedPct(selectedItem.dayPct)} today
                    </span>
                    <span style={{ color: pctTone(selectedItem.sincePct) }}>
                      {signedPct(selectedItem.sincePct)} since added
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => remove(selectedItem)}
                  className="text-xs px-2.5 py-1 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                >
                  Stop watching
                </button>
              </div>
            </div>
            <div>
              <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Analyst Rating</h3>
              {selectedRating ? (
                <div className="flex flex-col gap-2">
                  <RatingBadge rating={selectedRating} />
                  <RatingBar rating={selectedRating} />
                </div>
              ) : (
                <RatingBadge rating={null} loading={ratingsLoading} />
              )}
            </div>
          </div>
        )}

        {/* Table */}
        {!loading && !error && items.length > 0 && (
          <div className="rounded-md border border-border overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="text-left font-normal px-3 py-2">Symbol</th>
                  <th className="text-right font-normal px-3 py-2">Price</th>
                  <th className="text-right font-normal px-3 py-2">Today</th>
                  <th className="text-right font-normal px-3 py-2">Since added</th>
                  <th className="text-left font-normal px-3 py-2">Rating</th>
                  <th className="px-2 py-2" aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr
                    key={i.id}
                    onClick={() => setSelected(i.ticker)}
                    className="border-b border-border/60 last:border-0 cursor-pointer hover:bg-accent/40 transition-colors"
                  >
                    <td className="px-3 py-2">
                      <span className="font-mono text-foreground">{i.ticker}</span>
                      {i.name && (
                        <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">{i.name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground">
                      {fmtPx(i.price)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: pctTone(i.dayPct) }}>
                      {signedPct(i.dayPct)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="font-mono tabular-nums" style={{ color: pctTone(i.sincePct) }}>
                        {signedPct(i.sincePct)}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">{fmtDate(i.addedAt)}</span>
                    </td>
                    <td className="px-3 py-2">
                      <RatingBadge rating={ratings[i.ticker] ?? null} loading={ratingsLoading} showCount={false} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(i);
                        }}
                        aria-label={`Stop watching ${i.ticker}`}
                        title="Stop watching"
                        className="text-muted-foreground hover:text-foreground text-sm leading-none px-1"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
