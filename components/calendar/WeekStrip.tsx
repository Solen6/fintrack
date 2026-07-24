"use client";

import { usePrivacy } from "@/lib/privacy";
import { marketHolidayName } from "@/lib/market-calendar";
import { EventCard } from "./EventCard";
import {
  addDays,
  dayOfWeek,
  eventKey,
  fmtSignedPct,
  GAIN_TEXT,
  LOSS_TEXT,
  parseDs,
  pnlTint,
  shortDate,
  type CalendarEvent,
  type DayPnl,
} from "./calendar-shared";

/** Week view: seven columns, full event cards per day. */
export function WeekStrip({
  start, // Sunday
  today,
  eventsByDate,
  pnl,
  hidden,
  onToggleHide,
  onDeleteCustom,
}: {
  start: string;
  today: string;
  eventsByDate: Map<string, CalendarEvent[]>;
  pnl: Map<string, DayPnl> | null;
  hidden: Set<string>;
  onToggleHide: (e: CalendarEvent) => void;
  onDeleteCustom?: (id: string) => void;
}) {
  const { hidden: priv } = usePrivacy();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="grid grid-cols-7 min-w-[980px] rounded-md border border-border overflow-hidden bg-border gap-px">
        {days.map((date) => {
          const isToday = date === today;
          const day = pnl?.get(date);
          const tint = !priv && day ? pnlTint(day.pct) : undefined;
          const wd = dayOfWeek(date);
          const weekend = wd === 0 || wd === 6;
          const holiday = !weekend ? marketHolidayName(date) : null;
          const dayEvents = eventsByDate.get(date) ?? [];
          const weekdayLabel = new Date(parseDs(date)).toLocaleDateString("en-US", {
            weekday: "short",
            timeZone: "UTC",
          });

          return (
            <div key={date} className="flex flex-col bg-background min-h-[280px]">
              {/* Column header */}
              <div
                className="px-2 py-2 border-b border-border flex flex-col gap-0.5"
                style={{ background: tint ?? "var(--card)" }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {weekdayLabel}
                  </span>
                  {date.endsWith("-01") && !isToday ? (
                    <span className="h-6 flex items-center text-xs whitespace-nowrap text-foreground">
                      {shortDate(date)}
                    </span>
                  ) : (
                    <span
                      className="h-6 w-6 rounded-full flex items-center justify-center text-xs"
                      style={
                        isToday
                          ? { background: "var(--primary)", color: "var(--background)" }
                          : { color: "var(--foreground)" }
                      }
                    >
                      {Number(date.slice(8))}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1 min-h-[16px]">
                  <span className="text-[9px] text-muted-foreground truncate">
                    {holiday ? `Closed — ${holiday}` : weekend ? "Closed" : ""}
                  </span>
                  {!priv && day && (
                    <span
                      className="text-[10px] tabular-nums shrink-0"
                      style={{ color: day.change >= 0 ? GAIN_TEXT : LOSS_TEXT }}
                    >
                      {fmtSignedPct(day.pct, 1)}
                    </span>
                  )}
                </div>
              </div>

              {/* Events */}
              <div className="flex flex-col gap-1.5 p-1.5">
                {dayEvents.length > 0 ? (
                  dayEvents.map((e, i) => (
                    <EventCard
                      key={e.id ?? `${e.title}-${i}`}
                      event={e}
                      isHidden={hidden.has(eventKey(e))}
                      onToggleHide={onToggleHide}
                      onDeleteCustom={onDeleteCustom}
                      compact
                    />
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground px-1 pt-1">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
