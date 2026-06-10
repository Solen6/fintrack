"use client";

import { useState, useEffect, useCallback } from "react";
import type { OptionMetric } from "@/app/api/options/route";

type ViewState = "loading" | "empty" | "ready";

export function OptionsClient() {
  const [view, setView] = useState<ViewState>("loading");
  const [metrics, setMetrics] = useState<OptionMetric[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const loadData = useCallback(async () => {
    setView("loading");
    try {
      // 1. Portfolio tickers
      const hRes = await fetch("/api/holdings");
      const hData = hRes.ok ? await hRes.json() : { holdings: [] };
      const tickers = [
        ...new Set<string>(
          (hData.holdings as Array<{ ticker: string }>).map((h) => h.ticker)
        ),
      ].sort();

      if (tickers.length === 0) {
        setView("empty");
        return;
      }

      // 2. Options metrics for those tickers
      const oRes = await fetch(`/api/options?tickers=${tickers.join(",")}`);
      const oData = oRes.ok ? await oRes.json() : { options: [] };
      setMetrics(oData.options ?? []);
      setLastRefreshed(new Date());
      setView("ready");
    } catch {
      setView("empty");
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  if (view === "loading") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground animate-pulse">Loading options…</p>
      </div>
    );
  }

  if (view === "empty") {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          No holdings found. Upload a portfolio to see options metrics.
        </p>
      </div>
    );
  }

  const valid = metrics.filter((m) => !m.error);
  const errored = metrics.filter((m) => m.error);

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-3">
            <h2 className="text-lg font-medium text-foreground leading-none">Options</h2>
            <p className="text-xs text-muted-foreground">
              Implied volatility &amp; positioning · ATM, ~30-day expiry
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastRefreshed && (
              <p className="text-xs text-muted-foreground">
                As of{" "}
                {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
            <button
              onClick={loadData}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-sm hover:bg-accent"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0" style={{ background: "oklch(0.08 0 0)" }}>
            <tr className="text-xs text-muted-foreground" style={{ letterSpacing: "0.04em" }}>
              <th className="text-left  font-medium px-6 py-2.5">Ticker</th>
              <th className="text-right font-medium px-3 py-2.5">Spot</th>
              <th className="text-right font-medium px-3 py-2.5">Day</th>
              <th className="text-right font-medium px-3 py-2.5">ATM IV</th>
              <th className="text-right font-medium px-3 py-2.5">Put/Call</th>
              <th className="text-right font-medium px-3 py-2.5">Skew</th>
              <th className="text-right font-medium px-6 py-2.5">Expiry</th>
            </tr>
          </thead>
          <tbody>
            {valid.map((m) => <OptionRow key={m.ticker} m={m} />)}
          </tbody>
        </table>

        {errored.length > 0 && (
          <p className="text-xs text-muted-foreground px-6 py-3">
            No listed options for: {errored.map((m) => m.ticker).join(", ")}
          </p>
        )}
      </div>
    </main>
  );
}

function OptionRow({ m }: { m: OptionMetric }) {
  const dayPositive = m.dayChangePct >= 0;
  // Put-skew (>0) = downside demand / fear; call-skew (<0) = upside demand
  const skewColor =
    m.skew > 0 ? "var(--negative)" : m.skew < 0 ? "var(--positive)" : "oklch(0.52 0.008 74)";
  // P/C > 1 = more put activity (bearish lean); < 1 = call-heavy
  const pcColor =
    m.pcRatio > 1 ? "var(--negative)" : m.pcRatio > 0 ? "var(--positive)" : "oklch(0.52 0.008 74)";

  return (
    <tr className="border-b border-border/60 hover:bg-accent/40 transition-colors duration-150">
      <td className="text-left px-6 py-3 font-medium text-foreground">{m.ticker}</td>
      <td className="text-right px-3 py-3 font-mono text-foreground">
        {m.spot.toLocaleString("en-US", { minimumFractionDigits: 2 })}
      </td>
      <td className="text-right px-3 py-3 font-mono" style={{ color: dayPositive ? "var(--positive)" : "var(--negative)" }}>
        {dayPositive ? "+" : ""}{m.dayChangePct.toFixed(2)}%
      </td>
      <td className="text-right px-3 py-3 font-mono text-foreground">{m.atmIV.toFixed(1)}%</td>
      <td className="text-right px-3 py-3 font-mono" style={{ color: pcColor }}>{m.pcRatio.toFixed(2)}</td>
      <td className="text-right px-3 py-3 font-mono" style={{ color: skewColor }}>
        {m.skew > 0 ? "+" : ""}{m.skew.toFixed(1)}
      </td>
      <td className="text-right px-6 py-3 font-mono text-muted-foreground">
        {m.expiry ? new Date(m.expiry + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
        <span className="ml-1.5" style={{ fontSize: "0.65rem", opacity: 0.6 }}>{m.dte}d</span>
      </td>
    </tr>
  );
}
