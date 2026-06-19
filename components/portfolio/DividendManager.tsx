"use client";

import { useEffect, useMemo, useState } from "react";
import type { HoldingWithMetrics } from "@/lib/types";

interface Props {
  holdings: HoldingWithMetrics[];
  /* The currently-selected account filter ("all" or an account name). */
  account: string;
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * Batch dividend-handling editor. Opens as an overlay over the Accounts tab;
 * you set each holding to Reinvest (DRIP) or Pay to cash, then Save commits all
 * changes in ONE request — no per-security reload.
 */
export function DividendManager({ holdings, account, onSaved, onCancel }: Props) {
  // Holdings in scope for "this account" (all if no specific account selected).
  const scoped = useMemo(
    () =>
      (account === "all" ? holdings : holdings.filter((h) => h.account === account))
        .slice()
        .sort((a, b) => b.value - a.value),
    [holdings, account],
  );

  // Local draft of each holding's DRIP preference, keyed by id.
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(scoped.map((h) => [h.id, h.drip ?? false])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onCancel();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, saving]);

  const changed = useMemo(
    () => scoped.filter((h) => prefs[h.id] !== (h.drip ?? false)),
    [scoped, prefs],
  );

  const set = (id: string, drip: boolean) =>
    setPrefs((p) => ({ ...p, [id]: drip }));
  const setAll = (drip: boolean) =>
    setPrefs(Object.fromEntries(scoped.map((h) => [h.id, drip])));

  const handleSave = async () => {
    if (changed.length === 0) { onCancel(); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/holdings/drip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: changed.map((h) => ({ id: h.id, drip: prefs[h.id] })) }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => !saving && onCancel()}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-lg max-h-[80vh] flex flex-col rounded-md border border-border"
        style={{ background: "oklch(0.12 0 0)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3 border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-foreground">Manage Dividends</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {account === "all" ? "All accounts" : account} · choose how each holding&apos;s
                dividends are handled. Changes apply on Save.
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setAll(true)}
                className="text-[0.7rem] px-2 py-1 rounded-sm border border-border text-muted-foreground hover:text-foreground transition-colors"
                title="Set every holding to reinvest"
              >
                All DRIP
              </button>
              <button
                onClick={() => setAll(false)}
                className="text-[0.7rem] px-2 py-1 rounded-sm border border-border text-muted-foreground hover:text-foreground transition-colors"
                title="Set every holding to pay to cash"
              >
                All Cash
              </button>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {scoped.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No holdings in this account.</p>
          ) : (
            scoped.map((h) => (
              <div
                key={h.id}
                className="flex items-center gap-3 px-3 py-2 rounded-sm hover:bg-accent/40"
              >
                <div className="flex items-baseline gap-2 min-w-0 flex-1">
                  <span className="font-mono text-sm text-foreground shrink-0">{h.ticker}</span>
                  <span className="text-xs text-muted-foreground truncate" title={h.name}>
                    {h.name}
                  </span>
                </div>
                <Segment value={prefs[h.id] ?? false} onChange={(v) => set(h.id, v)} />
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">
            {error ? (
              <span style={{ color: "var(--negative)" }}>{error}</span>
            ) : changed.length > 0 ? (
              `${changed.length} change${changed.length !== 1 ? "s" : ""} pending`
            ) : (
              "No changes"
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => !saving && onCancel()}
              className="text-xs px-3 py-1.5 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || changed.length === 0}
              className="text-xs px-4 py-1.5 rounded-sm font-medium disabled:opacity-40"
              style={{ background: "oklch(0.72 0.14 74)", color: "oklch(0.08 0 0)" }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Two-option segmented control: Cash | Reinvest */
function Segment({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex rounded-sm border border-border overflow-hidden shrink-0 text-xs">
      <button
        onClick={() => onChange(false)}
        className="px-2.5 py-1 transition-colors"
        style={{
          background: !value ? "oklch(0.16 0 0)" : "transparent",
          color: !value ? "var(--primary)" : "oklch(0.55 0.008 74)",
        }}
        aria-pressed={!value}
      >
        Cash
      </button>
      <button
        onClick={() => onChange(true)}
        className="px-2.5 py-1 transition-colors border-l border-border"
        style={{
          background: value ? "oklch(0.16 0 0)" : "transparent",
          color: value ? "var(--positive)" : "oklch(0.55 0.008 74)",
        }}
        aria-pressed={value}
      >
        Reinvest
      </button>
    </div>
  );
}
