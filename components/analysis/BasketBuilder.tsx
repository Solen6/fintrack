"use client";

import { useState } from "react";
import { CHART } from "./charts";

const VIOLET = "oklch(0.62 0.13 300)";
const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** Max tickers in a basket. Must match MAX_TICKERS in /api/analysis/basket —
    the route hard-truncates beyond it, so anything the UI lets past this would
    be dropped without ever reaching the excluded list. */
export const BASKET_MAX = 60;

export interface BasketItem {
  ticker: string;
  fromPortfolio: boolean;
}

/** Shared ticker-basket picker: autofill from portfolio, add tickers by hand,
    remove chips. Each tool owns the basket state; this renders the controls. */
export function BasketBuilder({
  items,
  onAdd,
  onRemove,
  onAutofill,
  onClear,
  autofilling,
  autofillError,
  excluded = [],
  max = BASKET_MAX,
  refetching = false,
}: {
  items: BasketItem[];
  onAdd: (ticker: string) => void;
  onRemove: (ticker: string) => void;
  onAutofill: () => void;
  onClear: () => void;
  autofilling: boolean;
  autofillError: string | null;
  excluded?: { ticker: string; reason: string }[];
  max?: number;
  refetching?: boolean;
}) {
  const [input, setInput] = useState("");
  const atMax = items.length >= max;
  const excludedSet = new Set(excluded.map((e) => e.ticker));

  function add() {
    const t = input.trim().toUpperCase();
    setInput("");
    if (!TICKER_RE.test(t)) return;
    if (atMax) return;
    if (items.some((i) => i.ticker === t)) return;
    onAdd(t);
  }

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: CHART.muted }}>
          Basket
        </span>

        <button
          type="button"
          onClick={onAutofill}
          disabled={autofilling}
          className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-[oklch(0.16_0_0)] px-3 py-1.5 text-[12.5px] text-foreground transition-colors duration-150 hover:border-[oklch(0.28_0_0)] disabled:opacity-50"
        >
          {autofilling ? (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 1 1-6.2-8.6" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12M8 11l4 4 4-4M4 21h16" />
            </svg>
          )}
          Autofill from portfolio
        </button>

        <div className="flex items-center rounded-sm border border-border bg-background focus-within:border-[oklch(0.72_0.14_74_/_0.5)]">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Add ticker"
            aria-label="Add a ticker to the basket"
            disabled={atMax}
            className="w-28 bg-transparent px-2.5 py-1.5 font-mono text-[13px] uppercase tabular-nums text-foreground outline-none placeholder:text-[oklch(0.50_0.006_74)] placeholder:normal-case disabled:opacity-50"
          />
          <button
            type="button"
            onClick={add}
            disabled={atMax}
            className="border-l border-border px-3 py-1.5 text-[12.5px] text-primary transition-colors hover:bg-[oklch(0.72_0.14_74_/_0.1)] disabled:opacity-40"
          >
            Add
          </button>
        </div>

        {items.length > 0 && (
          <button type="button" onClick={onClear} className="text-[11.5px] text-muted-foreground transition-colors hover:text-foreground">
            Clear
          </button>
        )}
        {refetching && <span className="text-[11.5px]" style={{ color: CHART.muted }}>updating…</span>}
        {items.length > 0 && (
          <span
            className="font-mono text-[11.5px] tabular-nums"
            style={{ color: atMax ? CHART.amber : CHART.muted }}
            title={atMax ? `Basket is full (${max} tickers max)` : undefined}
          >
            {items.length} / {max}
          </span>
        )}
      </div>

      {autofillError && (
        <p className="mt-2 mb-0 text-[11.5px]" style={{ color: CHART.negative }}>{autofillError}</p>
      )}

      {items.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {items.map((it) => {
            const failed = excludedSet.has(it.ticker);
            const style = failed
              ? { borderColor: "oklch(0.66 0.19 25 / 0.5)", color: CHART.negative, background: "oklch(0.66 0.19 25 / 0.1)" }
              : it.fromPortfolio
                ? { borderColor: "oklch(0.72 0.14 74 / 0.45)", color: CHART.amber, background: "oklch(0.72 0.14 74 / 0.12)" }
                : { borderColor: "oklch(0.62 0.13 300 / 0.5)", color: VIOLET, background: "oklch(0.62 0.13 300 / 0.12)" };
            return (
              <span
                key={it.ticker}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]"
                style={style}
                title={failed ? "No usable price history — not included" : it.fromPortfolio ? "From your portfolio" : "Added manually"}
              >
                <span className="font-mono font-medium">{it.ticker}</span>
                {failed && <span className="text-[10px]">no data</span>}
                <button type="button" onClick={() => onRemove(it.ticker)} aria-label={`Remove ${it.ticker}`} className="opacity-70 transition-opacity hover:opacity-100">
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
