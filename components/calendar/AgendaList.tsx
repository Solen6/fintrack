"use client";

import { useMemo } from "react";
import { EventCard } from "./EventCard";
import { eventKey, formatDateLabel, type CalendarEvent } from "./calendar-shared";

/** The original list view: events grouped by date, hide/unhide per row. */
export function AgendaList({
  events,
  hidden,
  onToggleHide,
  onDeleteCustom,
}: {
  events: CalendarEvent[]; // already category- and hidden-filtered
  hidden: Set<string>;
  onToggleHide: (e: CalendarEvent) => void;
  onDeleteCustom?: (id: string) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; events: CalendarEvent[] }>();
    for (const e of events) {
      if (!map.has(e.date)) map.set(e.date, { label: formatDateLabel(e.date), events: [] });
      map.get(e.date)!.events.push(e);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  if (grouped.length === 0) {
    return <p className="text-sm text-muted-foreground">No events in the next 90 days.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {grouped.map(([date, { label, events: dayEvents }]) => (
        <div key={date} className="flex gap-4">
          <div className="w-28 shrink-0 pt-1">
            <span className="text-sm text-foreground">{label}</span>
          </div>
          <div className="flex-1 flex flex-col gap-2">
            {dayEvents.map((e, i) => (
              <EventCard
                key={e.id ?? `${e.title}-${i}`}
                event={e}
                isHidden={hidden.has(eventKey(e))}
                onToggleHide={onToggleHide}
                onDeleteCustom={onDeleteCustom}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
