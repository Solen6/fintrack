"use client";

import { useEffect, useMemo, useState } from "react";

type EventCategory = "Macro" | "Earnings" | "Dividend";

interface CalendarEvent {
  date: string;
  category: EventCategory;
  title: string;
  detail: string;
  ticker?: string;
  impact?: "high" | "med" | "low";
}

const CATEGORIES: EventCategory[] = ["Macro", "Earnings", "Dividend"];

const HIDDEN_KEY = "fintrack:calendar:hidden";

function eventKey(e: { date: string; title: string; category: string }): string {
  return `${e.date}|${e.category}|${e.title}`;
}

function loadHidden(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(HIDDEN_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function saveHidden(set: Set<string>) {
  try {
    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set]));
  } catch {}
}

const CATEGORY_COLORS: Record<EventCategory, string> = {
  Macro:    "oklch(0.64 0.07 240)",
  Earnings: "oklch(0.72 0.14 74)",
  Dividend: "oklch(0.72 0.15 152)",
};

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function CalendarClient() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Set<EventCategory>>(new Set(CATEGORIES));
  const [hidden, setHidden] = useState<Set<string>>(loadHidden);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    fetch("/api/calendar")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load calendar");
        return r.json();
      })
      .then((d) => setEvents(d.events ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (c: EventCategory) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next.size === 0 ? new Set(CATEGORIES) : next;
    });
  };

  const hideEvent = (e: CalendarEvent) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.add(eventKey(e));
      saveHidden(next);
      return next;
    });
  };

  const unhideEvent = (e: CalendarEvent) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.delete(eventKey(e));
      saveHidden(next);
      return next;
    });
  };

  const hiddenCount = useMemo(
    () => events.filter((e) => active.has(e.category) && hidden.has(eventKey(e))).length,
    [events, active, hidden],
  );

  const grouped = useMemo(() => {
    const filtered = events.filter((e) => active.has(e.category) && (showHidden || !hidden.has(eventKey(e))));
    const map = new Map<string, { label: string; events: CalendarEvent[] }>();
    for (const e of filtered) {
      if (!map.has(e.date)) map.set(e.date, { label: formatDateLabel(e.date), events: [] });
      map.get(e.date)!.events.push(e);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events, active, hidden, showHidden]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-[900px] flex flex-col gap-5">

        {/* Header + filter chips */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg text-foreground">Upcoming Events</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Macro releases and events for your holdings · next 90 days
            </p>
          </div>
          <div className="flex items-center gap-2">
            {CATEGORIES.map((c) => {
              const on = active.has(c);
              return (
                <button
                  key={c}
                  onClick={() => toggle(c)}
                  className="flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs transition-colors"
                  style={{
                    borderColor: on ? CATEGORY_COLORS[c] : "oklch(0.20 0 0)",
                    color: on ? "oklch(0.94 0.005 74)" : "oklch(0.52 0.008 74)",
                    background: on ? "oklch(0.14 0 0)" : "transparent",
                  }}
                  aria-pressed={on}
                >
                  <span
                    className="h-2 w-2 rounded-sm"
                    style={{ background: CATEGORY_COLORS[c] }}
                    aria-hidden
                  />
                  {c}
                </button>
              );
            })}
            {hiddenCount > 0 && (
              <button
                onClick={() => setShowHidden((p) => !p)}
                className="text-xs px-2.5 py-1 rounded-sm border transition-colors"
                style={{
                  borderColor: showHidden ? "var(--primary)" : "oklch(0.20 0 0)",
                  color: showHidden ? "var(--primary)" : "oklch(0.52 0.008 74)",
                }}
                aria-pressed={showHidden}
              >
                {showHidden ? "Hide" : "Show"} hidden ({hiddenCount})
              </button>
            )}
          </div>
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <div className="w-28 h-5 rounded-sm bg-card animate-pulse shrink-0" />
                <div className="flex-1 h-16 rounded-md bg-card animate-pulse" />
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <p className="text-sm text-muted-foreground">{error}</p>
        )}

        {/* Empty */}
        {!loading && !error && grouped.length === 0 && (
          <p className="text-sm text-muted-foreground">No events in the next 90 days.</p>
        )}

        {/* Agenda */}
        {!loading && !error && grouped.length > 0 && (
          <div className="flex flex-col gap-4">
            {grouped.map(([date, { label, events: dayEvents }]) => (
              <div key={date} className="flex gap-4">
                <div className="w-28 shrink-0 pt-1">
                  <span className="text-sm text-foreground">{label}</span>
                </div>
                <div className="flex-1 flex flex-col gap-2">
                  {dayEvents.map((e, i) => {
                    const isHidden = hidden.has(eventKey(e));
                    return (
                    <div
                      key={`${e.title}-${i}`}
                      className="rounded-md border bg-card px-4 py-3 flex items-start gap-3 group"
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
                          <span className="text-sm text-foreground">{e.title}</span>
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
                        <p className="text-xs text-muted-foreground mt-0.5">{e.detail}</p>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 mr-1">{e.category}</span>
                      <button
                        onClick={() => isHidden ? unhideEvent(e) : hideEvent(e)}
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0 text-sm leading-none"
                        aria-label={isHidden ? `Unhide ${e.title}` : `Hide ${e.title}`}
                        title={isHidden ? "Unhide" : "Hide"}
                      >
                        {isHidden ? "↩" : "×"}
                      </button>
                    </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
