"use client";

import { usePrivacy, MONEY_MASK } from "@/lib/privacy";
import { marketHolidayName } from "@/lib/market-calendar";
import { EventCard } from "./EventCard";
import {
  dayOfWeek,
  eventKey,
  fmtSignedPct,
  fmtSignedUsd,
  GAIN_TEXT,
  LOSS_TEXT,
  parseDs,
  type CalendarEvent,
  type DayPnl,
} from "./calendar-shared";

/** Detail card for the day selected in the month grid. */
export function DayPanel({
  date,
  today,
  events,
  hidden,
  onToggleHide,
  pnl,
}: {
  date: string;
  today: string;
  events: CalendarEvent[];
  hidden: Set<string>;
  onToggleHide: (e: CalendarEvent) => void;
  pnl: DayPnl | undefined;
}) {
  const { hidden: priv } = usePrivacy();

  const label = new Date(parseDs(date)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  const wd = dayOfWeek(date);
  const weekend = wd === 0 || wd === 6;
  const holiday = !weekend ? marketHolidayName(date) : null;
  const status = holiday
    ? `Market closed — ${holiday}`
    : weekend
      ? "Weekend — market closed"
      : null;

  return (
    <div className="rounded-md border border-border bg-card px-4 py-3 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <span className="text-sm text-foreground">{label}</span>
          {date === today && (
            <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--primary)" }}>
              Today
            </span>
          )}
          {status && <span className="text-xs text-muted-foreground">{status}</span>}
        </div>
        {pnl && (
          <span className="text-xs tabular-nums shrink-0">
            <span className="text-muted-foreground mr-1.5">Day P/L</span>
            {priv ? (
              <span className="text-foreground">{MONEY_MASK}</span>
            ) : (
              <span style={{ color: pnl.change >= 0 ? GAIN_TEXT : LOSS_TEXT }}>
                {fmtSignedUsd(pnl.change)} · {fmtSignedPct(pnl.pct)}
              </span>
            )}
          </span>
        )}
      </div>

      {events.length > 0 ? (
        <div className="flex flex-col gap-2">
          {events.map((e, i) => (
            <EventCard
              key={`${e.title}-${i}`}
              event={e}
              isHidden={hidden.has(eventKey(e))}
              onToggleHide={onToggleHide}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No events.</p>
      )}
    </div>
  );
}
