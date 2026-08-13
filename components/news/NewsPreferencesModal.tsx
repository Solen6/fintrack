"use client";

import { useState, useEffect, useRef } from "react";
import {
  DEFAULT_PLANS,
  NEWS_TYPES,
  PREF_SOURCES,
  type NewsType,
  type NewsPrefs,
  type PlanTier,
} from "@/lib/news-preferences";
import { sourceColor } from "@/lib/news-source-color";
import type { NewsSource } from "@/components/news/NewsSourceManager";

interface Props {
  firstRun: boolean;
  initialPrefs: NewsPrefs;
  sources: NewsSource[]; // already-connected RSS feeds (to skip re-adding)
  onClose: () => void;
  onSave: (prefs: NewsPrefs, sourcesToAdd: { name: string; url: string }[]) => void;
  onOpenAdvanced: () => void;
}

const AMBER = "oklch(0.72 0.14 74)";

/* Small check glyph for the selected state (SVG, not emoji). */
function Check({ color = "oklch(0.08 0 0)" }: { color?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M2.5 6.5L5 9L9.5 3.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function NewsPreferencesModal({
  firstRun,
  initialPrefs,
  sources,
  onClose,
  onSave,
  onOpenAdvanced,
}: Props) {
  const [selectedTypes, setSelectedTypes] = useState<Set<NewsType>>(
    () => new Set(initialPrefs.types)
  );
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    () => new Set(initialPrefs.sources)
  );
  const [plans, setPlans] = useState<Record<string, PlanTier>>(
    () => ({ ...DEFAULT_PLANS, ...initialPrefs.plans })
  );
  const [hideLocked, setHideLocked] = useState(initialPrefs.hideLocked);
  const firstRowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRowRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  function toggleType(id: NewsType) {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSource(id: string) {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const canSave = selectedTypes.size > 0;

  function handleSave() {
    if (!canSave) return;
    const existingUrls = new Set(sources.map((s) => s.url));
    const sourcesToAdd = PREF_SOURCES.filter(
      (c) => selectedSources.has(c.id) && c.rss && !existingUrls.has(c.rss.url)
    ).map((c) => c.rss!);

    onSave(
      { types: [...selectedTypes], sources: [...selectedSources], plans, hideLocked },
      sourcesToAdd
    );
  }

  // Only worth showing the "hide locked" switch if a whole-publisher paywall is
  // actually in play — i.e. some enabled source is subscriber-gated and set to Free.
  const anyLocked = PREF_SOURCES.some(
    (s) => s.access?.paywalled && selectedSources.has(s.id) && plans[s.id] === "free"
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.72)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="news-prefs-title"
        className="w-full max-w-lg rounded-lg border border-border overflow-hidden flex flex-col"
        style={{ background: "oklch(0.12 0 0)", maxHeight: "88vh" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <h2 id="news-prefs-title" className="text-sm font-semibold text-foreground">
              {firstRun ? "Personalize your news" : "News Preferences"}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {firstRun
                ? "Pick what shows up in your feed. You can change this anytime."
                : "Choose which topics and sources appear in your feed."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors w-7 h-7 flex items-center justify-center rounded shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* News types */}
          <div className="px-5 py-4 border-b border-border">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              News Types
            </p>
            <ul className="space-y-2">
              {NEWS_TYPES.map((t, i) => {
                const on = selectedTypes.has(t.id);
                return (
                  <li key={t.id}>
                    <button
                      ref={i === 0 ? firstRowRef : undefined}
                      onClick={() => toggleType(t.id)}
                      aria-pressed={on}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md border text-left transition-colors duration-150"
                      style={{
                        borderColor: on ? AMBER : "var(--border)",
                        background: on ? "oklch(0.72 0.14 74 / 0.10)" : "oklch(0.14 0 0)",
                      }}
                    >
                      <span
                        className="w-[18px] h-[18px] rounded-[5px] shrink-0 flex items-center justify-center transition-colors duration-150"
                        style={{
                          background: on ? AMBER : "transparent",
                          border: on ? "none" : "1.5px solid oklch(0.32 0 0)",
                        }}
                      >
                        {on && <Check />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span
                          className={`block text-sm font-medium ${on ? "text-foreground" : "text-muted-foreground"}`}
                        >
                          {t.label}
                        </span>
                        <span className="block text-xs text-muted-foreground opacity-70 leading-snug">
                          {t.desc}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {!canSave && (
              <p className="text-xs mt-2" style={{ color: "oklch(0.64 0.16 28)" }}>
                Select at least one news type.
              </p>
            )}
          </div>

          {/* News sources + the plan you hold at each */}
          <div className="px-5 py-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              News Sources
            </p>
            <p className="text-xs text-muted-foreground opacity-70 mb-3 leading-snug">
              Tell us which plan you have at each publisher and we&apos;ll stop showing
              you articles you can&apos;t open.
            </p>
            <ul className="space-y-1.5">
              {PREF_SOURCES.map((s) => {
                const on = selectedSources.has(s.id);
                const tier = plans[s.id] ?? "free";
                return (
                  <li key={s.id}>
                    <div
                      className="flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-md border transition-colors duration-150"
                      style={{
                        borderColor: on ? AMBER : "var(--border)",
                        background: on ? "oklch(0.72 0.14 74 / 0.10)" : "oklch(0.10 0 0)",
                      }}
                    >
                      <button
                        onClick={() => toggleSource(s.id)}
                        aria-pressed={on}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left text-xs font-medium transition-colors duration-150"
                        style={{ color: on ? "var(--foreground)" : "var(--muted-foreground)" }}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0 transition-opacity duration-150"
                          style={{ background: sourceColor(s.label), opacity: on ? 1 : 0.4 }}
                          aria-hidden
                        />
                        <span className="truncate">{s.label}</span>
                      </button>

                      {/* Plan control — only for publishers where the setting
                          changes what you actually see. Reuters and CNBC are
                          free, so they get no control rather than a dead one. */}
                      {s.access && (
                        <span
                          className="flex items-center gap-0.5 shrink-0 rounded p-0.5"
                          style={{ background: "oklch(0.08 0 0)", opacity: on ? 1 : 0.45 }}
                          role="group"
                          aria-label={`${s.label} plan`}
                        >
                          {(["free", "paid"] as PlanTier[]).map((t) => {
                            const active = tier === t;
                            return (
                              <button
                                key={t}
                                onClick={() => setPlans((p) => ({ ...p, [s.id]: t }))}
                                disabled={!on}
                                aria-pressed={active}
                                className="px-2 py-0.5 rounded text-[11px] font-medium transition-colors duration-150 disabled:cursor-not-allowed"
                                style={{
                                  background: active ? AMBER : "transparent",
                                  color: active ? "oklch(0.08 0 0)" : "var(--muted-foreground)",
                                }}
                              >
                                {s.access!.labels[t]}
                              </button>
                            );
                          })}
                        </span>
                      )}
                    </div>
                    {on && s.access && tier === "free" && (
                      <p className="text-[11px] text-muted-foreground opacity-60 leading-snug pl-[18px] pr-1 pt-1">
                        {s.access.note}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            {anyLocked && (
              <label className="flex items-start gap-2.5 mt-3 pt-3 border-t border-border cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideLocked}
                  onChange={(e) => setHideLocked(e.target.checked)}
                  className="mt-0.5 accent-[oklch(0.72_0.14_74)]"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-foreground">
                    Hide paywalled articles
                  </span>
                  <span className="block text-[11px] text-muted-foreground opacity-70 leading-snug">
                    Off by default — subscriber-only stories stay in the feed with a lock,
                    so the headline still reaches you.
                  </span>
                </span>
              </label>
            )}

            <p className="text-xs text-muted-foreground opacity-70 mt-3 leading-snug">
              Enabling a source adds its feed to your news tab. Unchecking hides that
              provider&apos;s articles. Seeking Alpha transcripts, earnings decks and
              podcasts are always filtered out — only news and analysis come through.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border shrink-0">
          <button
            onClick={onOpenAdvanced}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Manage RSS feeds →
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {firstRun ? "Skip" : "Cancel"}
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: AMBER, color: "oklch(0.08 0 0)" }}
            >
              {firstRun ? "Get started" : "Save preferences"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
