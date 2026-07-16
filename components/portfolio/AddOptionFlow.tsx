"use client";

import { useRef, useState } from "react";
import type { Leg } from "@/lib/options-math";
import { OptionsBuilder } from "@/components/options/OptionsBuilder";
import { AddOptionForm } from "./AddOptionForm";
import { RecordStrategyModal } from "./RecordStrategyModal";

interface Props {
  existingAccounts: string[];
  onSaved: () => void;
  onCancel: () => void;
}

type Mode = "single" | "strategy";

interface PendingStrategy {
  legs: Leg[];
  underlying: string;
  strategyName: string;
}

/** Add → Option: either the quick single-leg form (works without a live
 *  chain — arbitrary strikes/expiries, after-hours entry) or the full
 *  strategy builder (iron condor, spreads, …) reused from the options/paper
 *  side, wired here to record REAL positions via /api/holdings/combo. */
export function AddOptionFlow({ existingAccounts, onSaved, onCancel }: Props) {
  const [mode, setMode] = useState<Mode>("strategy");
  const [pending, setPending] = useState<PendingStrategy | null>(null);
  // The builder awaits onPlaceTrade's promise to show its result message —
  // held open until the record modal resolves it.
  const resolverRef = useRef<((r: { ok: boolean; msg: string }) => void) | null>(null);

  const onPlaceTrade = (legs: Leg[], info: { underlying: string; strategyName: string; netCost: number }) =>
    new Promise<{ ok: boolean; msg: string }>((resolve) => {
      resolverRef.current = resolve;
      setPending({ legs, underlying: info.underlying, strategyName: info.strategyName });
    });

  const handleModalDone = (result: { ok: boolean; msg: string }) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setPending(null);
    if (result.ok) onSaved();
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 py-2 border-b border-border shrink-0 flex items-center gap-3">
        <div className="flex items-center rounded-sm border border-border overflow-hidden">
          <button
            onClick={() => setMode("strategy")}
            className="text-xs px-2.5 py-1 transition-colors duration-150"
            style={{
              background: mode === "strategy" ? "oklch(0.16 0 0)" : "transparent",
              color: mode === "strategy" ? "var(--primary)" : "oklch(0.64 0.008 74)",
            }}
          >
            Strategy
          </button>
          <button
            onClick={() => setMode("single")}
            className="text-xs px-2.5 py-1 transition-colors duration-150"
            style={{
              background: mode === "single" ? "oklch(0.16 0 0)" : "transparent",
              color: mode === "single" ? "var(--primary)" : "oklch(0.64 0.008 74)",
            }}
          >
            Single leg
          </button>
        </div>
        <span className="text-xs text-muted-foreground">
          {mode === "strategy"
            ? "Pick a strategy (iron condor, spread, …), tune the legs against the live chain, then record it."
            : "Quick manual entry — works without a live chain."}
        </span>
        <button
          onClick={onCancel}
          className="ml-auto text-xs px-3 py-1 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>

      {mode === "single" ? (
        <AddOptionForm existingAccounts={existingAccounts} onSaved={onSaved} onCancel={onCancel} />
      ) : (
        <OptionsBuilder
          trade={{
            onPlaceTrade,
            panelTitle: "Record in portfolio",
            buttonLabel: "Record Strategy",
            footnote: "Records the legs against a real account — you'll confirm entry premiums and pick the account next.",
          }}
        />
      )}

      {pending && (
        <RecordStrategyModal
          legs={pending.legs}
          underlying={pending.underlying}
          strategyName={pending.strategyName}
          existingAccounts={existingAccounts}
          onDone={handleModalDone}
        />
      )}
    </div>
  );
}
