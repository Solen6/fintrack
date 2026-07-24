"use client";

import { Sensitive } from "@/lib/privacy";
import { CATEGORY_COLORS, fmtUsd, type CalendarEvent } from "./calendar-shared";

/** One event row — used by the agenda list, the month view's day panel and the
    week columns (compact). Carries the hide/unhide affordance. */
export function EventCard({
  event: e,
  isHidden,
  onToggleHide,
  onDeleteCustom,
  compact = false,
}: {
  event: CalendarEvent;
  isHidden: boolean;
  onToggleHide: (e: CalendarEvent) => void;
  /** When set and the event is user-added (Custom), the row action deletes it
      outright instead of hiding it. */
  onDeleteCustom?: (id: string) => void;
  compact?: boolean;
}) {
  const isCustom = e.category === "Custom" && !!e.id;
  const canDelete = isCustom && !!onDeleteCustom;
  return (
    <div
      className={`rounded-md border bg-card flex items-start gap-3 group ${compact ? "px-3 py-2" : "px-4 py-3"}`}
      style={{
        borderColor: isHidden ? "oklch(0.20 0 0)" : "var(--border)",
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
  );
}
