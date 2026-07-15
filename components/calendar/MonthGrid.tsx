"use client";

import { useMemo } from "react";
import { usePrivacy } from "@/lib/privacy";
import { marketHolidayName } from "@/lib/market-calendar";
import {
  addDays,
  CATEGORY_COLORS,
  dayOfWeek,
  fmtSignedPct,
  GAIN_TEXT,
  LOSS_TEXT,
  monthEnd,
  pnlTint,
  shortDate,
  weekStart,
  type CalendarEvent,
  type DayPnl,
} from "./calendar-shared";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Short label for a cramped month-cell chip. */
function chipLabel(e: CalendarEvent): string {
  if (e.category === "Dividend") return `${e.ticker ?? ""} div`.trim();
  if (e.category === "Split") return `${e.ticker ?? ""} split`.trim();
  if (e.category === "Earnings") return e.ticker ?? e.title;
  return e.title;
}

export function MonthGrid({
  cursor, // YYYY-MM-01 of the visible month
  today,
  eventsByDate,
  pnl,
  selectedDay,
  onSelectDay,
  onOpenWeek,
}: {
  cursor: string;
  today: string;
  eventsByDate: Map<string, CalendarEvent[]>;
  pnl: Map<string, DayPnl> | null;
  selectedDay: string | null;
  onSelectDay: (d: string) => void;
  onOpenWeek: (d: string) => void;
}) {
  const { hidden: priv } = usePrivacy();
  const month = cursor.slice(0, 7);

  const cells = useMemo(() => {
    const start = weekStart(cursor);
    const end = addDays(weekStart(monthEnd(cursor)), 6);
    const out: string[] = [];
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
    return out;
  }, [cursor]);

  return (
    <div className="rounded-md border border-border overflow-hidden">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-border bg-card">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-1.5 text-[11px] text-muted-foreground text-right">
            <span className="hidden sm:inline">{w}</span>
            <span className="sm:hidden">{w[0]}</span>
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-px bg-border">
        {cells.map((date) => {
          const inMonth = date.slice(0, 7) === month;
          const isToday = date === today;
          const isSelected = date === selectedDay;
          const dayEvents = eventsByDate.get(date) ?? [];
          const shown = dayEvents.slice(0, 3);
          const more = dayEvents.length - shown.length;
          const day = pnl?.get(date);
          const tint = !priv && day ? pnlTint(day.pct, inMonth ? 1 : 0.5) : undefined;
          const wd = dayOfWeek(date);
          const weekend = wd === 0 || wd === 6;
          const holiday = !weekend ? marketHolidayName(date) : null;

          return (
            <button
              key={date}
              onClick={() => onSelectDay(date)}
              onDoubleClick={() => onOpenWeek(date)}
              aria-label={date}
              title="Double-click for week view"
              className={`relative flex flex-col items-stretch text-left p-1 sm:p-1.5 min-h-[72px] sm:min-h-[96px] transition-colors touch-manipulation select-none ${
                isSelected ? "ring-1 ring-inset ring-[var(--primary)]" : ""
              }`}
              style={{
                background: tint ?? (weekend ? "oklch(0.095 0 0)" : "var(--background)"),
              }}
            >
              <div className="flex items-start justify-between gap-1">
                {holiday ? (
                  <span className="text-[9px] text-muted-foreground truncate pt-1 min-w-0">
                    {holiday}
                  </span>
                ) : (
                  <span />
                )}
                {date.endsWith("-01") && !isToday ? (
                  // Apple-style page seam: the 1st of every month is labeled
                  // ("Aug 1") so adjacent-month spillover days read correctly.
                  <span
                    className="h-6 shrink-0 flex items-center text-xs whitespace-nowrap pr-0.5"
                    style={{ color: inMonth ? "var(--foreground)" : "oklch(0.45 0.005 74)" }}
                  >
                    {shortDate(date)}
                  </span>
                ) : (
                  <span
                    className="h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-xs"
                    style={
                      isToday
                        ? { background: "var(--primary)", color: "var(--background)" }
                        : { color: inMonth ? "var(--foreground)" : "oklch(0.45 0.005 74)" }
                    }
                  >
                    {Number(date.slice(8))}
                  </span>
                )}
              </div>

              {/* Event chips (≥sm) */}
              {shown.length > 0 && (
                <div className="mt-0.5 hidden sm:flex flex-col gap-0.5 overflow-hidden">
                  {shown.map((e, i) => (
                    <span
                      key={i}
                      className="flex items-center gap-1 min-w-0 text-[11px] leading-4"
                      style={{ opacity: inMonth ? 1 : 0.55 }}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-sm shrink-0"
                        style={{ background: CATEGORY_COLORS[e.category] }}
                        aria-hidden
                      />
                      <span className="truncate text-foreground">{chipLabel(e)}</span>
                      {e.impact === "high" && (
                        <span className="shrink-0 text-[9px]" style={{ color: "var(--negative)" }}>
                          ●
                        </span>
                      )}
                    </span>
                  ))}
                  {more > 0 && (
                    <span className="text-[10px] text-muted-foreground pl-2.5">+{more} more</span>
                  )}
                </div>
              )}

              {/* Dot row (<sm) */}
              {dayEvents.length > 0 && (
                <div className="mt-1 flex sm:hidden gap-0.5 flex-wrap">
                  {dayEvents.slice(0, 6).map((e, i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: CATEGORY_COLORS[e.category], opacity: inMonth ? 1 : 0.55 }}
                      aria-hidden
                    />
                  ))}
                </div>
              )}

              {!priv && day && (
                <span
                  className="mt-auto self-end hidden md:block text-[10px] tabular-nums"
                  style={{ color: day.change >= 0 ? GAIN_TEXT : LOSS_TEXT, opacity: inMonth ? 1 : 0.55 }}
                >
                  {fmtSignedPct(day.pct, 1)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
