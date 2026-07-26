"use client";

import { useState } from "react";
import { Sensitive } from "@/lib/privacy";
import { CATEGORY_COLORS, fmtUsd, type CalendarEvent } from "./calendar-shared";

/** One event row — used by the agenda list, the month view's day panel and the
    week columns (compact). Carries feed subscription (ellipsis menu) and hide affordances. */
export function EventCard({
  event: e,
  isHidden,
  isSubscribed = false,
  onToggleHide,
  onToggleSubscribe,
  onDeleteCustom,
  compact = false,
}: {
  event: CalendarEvent;
  isHidden: boolean;
  isSubscribed?: boolean;
  onToggleHide: (e: CalendarEvent) => void;
  onToggleSubscribe?: (e: CalendarEvent) => void;
  /** When set and the event is user-added, the row action deletes it
      outright instead of hiding it. */
  onDeleteCustom?: (id: string) => void;
  compact?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const canDelete = !!e.id && !!onDeleteCustom;

  return (
    <div
      className={`rounded-md border bg-card flex items-start gap-3 group ${compact ? "px-3 py-2" : "px-4 py-3"}`}
      style={{
        borderColor: isHidden ? "oklch(0.20 0 0)" : isSubscribed ? "var(--primary)" : "var(--border)",
        opacity: isHidden ? 0.5 : 1,
      }}
    >
      <span
        className="mt-1 h-2.5 w-2.5 rounded-sm shrink-0"
        style={{ background: CATEGORY_COLORS[e.category] }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`${compact ? "text-xs" : "text-sm"} text-foreground`}>{e.title}</span>
          {e.ticker && (
            <span className="font-mono text-xs text-muted-foreground">
              {e.ticker}
            </span>
          )}
          {e.impact === "high" && (
            <span
              className="text-[10px] uppercase tracking-wide rounded-sm px-1.5 py-0.5"
              style={{
                color: "var(--negative)",
                background: "oklch(0.66 0.19 25 / 0.12)",
              }}
            >
              High impact
            </span>
          )}
          {isSubscribed && (
            <span
              className="text-[10px] tracking-wide rounded-sm px-1.5 py-0.5"
              style={{
                color: "var(--primary)",
                background: "oklch(0.72 0.14 74 / 0.12)",
              }}
            >
              📡 In Feed
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {e.detail}
          {e.amount != null && (
            <>
              {" · est. "}
              <Sensitive className="text-foreground">{fmtUsd(e.amount)}</Sensitive>
            </>
          )}
        </p>
      </div>

      {!compact && (
        <span className="text-xs text-muted-foreground shrink-0 mr-1">{e.category}</span>
      )}

      {/* Action controls: Ellipsis menu (Feed options) to the left of X / Trash */}
      <div className="flex items-center gap-1.5 shrink-0">
        {onToggleSubscribe && (
          <div className="relative">
            <button
              onClick={() => setMenuOpen((p) => !p)}
              className={`px-1.5 py-0.5 text-xs rounded-sm transition-all leading-none ${
                isSubscribed
                  ? "text-[var(--primary)] font-bold opacity-100 bg-[var(--primary)]/10"
                  : "text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
              }`}
              aria-label={`Feed options for ${e.title}`}
              aria-expanded={menuOpen}
              title="Feed options"
            >
              …
            </button>
            {menuOpen && (
              <>
                <button
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close menu"
                  tabIndex={-1}
                />
                <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-md border border-border bg-card p-1 shadow-lg flex flex-col gap-0.5 text-xs">
                  <button
                    onClick={() => {
                      onToggleSubscribe(e);
                      setMenuOpen(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-sm hover:bg-accent/50 transition-colors flex items-center justify-between gap-2"
                  >
                    <span>{isSubscribed ? "Remove from feed" : "Add to feed"}</span>
                    {isSubscribed ? (
                      <span className="text-[var(--primary)] font-mono">✓</span>
                    ) : (
                      <span className="text-muted-foreground">+</span>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {canDelete ? (
          <button
            onClick={() => onDeleteCustom!(e.id!)}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0 text-sm leading-none"
            aria-label={`Delete ${e.title}`}
            title="Delete event"
          >
            🗑
          </button>
        ) : (
          <button
            onClick={() => onToggleHide(e)}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0 text-sm leading-none"
            aria-label={isHidden ? `Unhide ${e.title}` : `Hide ${e.title}`}
            title={isHidden ? "Unhide" : "Hide"}
          >
            {isHidden ? "↩" : "×"}
          </button>
        )}
      </div>
    </div>
  );
}
