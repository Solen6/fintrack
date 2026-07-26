"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sensitive } from "@/lib/privacy";
import { AgendaList } from "./AgendaList";
import { MonthGrid } from "./MonthGrid";
import { WeekStrip } from "./WeekStrip";
import { YearHeatmap } from "./YearHeatmap";
import { DayPanel } from "./DayPanel";
import {
  addDays,
  addMonths,
  buildDayPnl,
  CATEGORIES,
  CATEGORY_COLORS,
  etToday,
  eventKey,
  fmtUsd,
  loadHidden,
  monthEnd,
  monthLabel,
  monthStart,
  saveHidden,
  shortDate,
  VIEW_KEY,
  weekStart,
  type CalendarEvent,
  type DayPnl,
  type EventCategory,
} from "./calendar-shared";

type ViewMode = "week" | "month" | "year" | "agenda";
const VIEWS: { key: ViewMode; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
  { key: "agenda", label: "Agenda" },
];

export function CalendarClient() {
  const today = useMemo(() => etToday(), []);

  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState(today);
  const [selectedDay, setSelectedDay] = useState<string | null>(today);
  const [query, setQuery] = useState("");

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [fetchedTo, setFetchedTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pnl, setPnl] = useState<Map<string, DayPnl> | null>(null);

  const [active, setActive] = useState<Set<EventCategory>>(new Set(CATEGORIES));
  const [hidden, setHidden] = useState<Set<string>>(loadHidden);
  const [showHidden, setShowHidden] = useState(false);
  const [subscribed, setSubscribed] = useState<Set<string>>(new Set());

  /* User-added one-off events (server-backed). Merged into derived events. */
  const [custom, setCustom] = useState<CalendarEvent[]>([]);

  /* Load server-side hide state, subscribed event keys, + custom events once. */
  useEffect(() => {
    let alive = true;
    fetch("/api/calendar/hidden")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.keys) return;
        const set = new Set<string>(d.keys);
        setHidden(set);
        saveHidden(set); // mirror to localStorage for offline/optimistic reads
      })
      .catch(() => {});
    fetch("/api/calendar/subscribed")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.keys) return;
        setSubscribed(new Set<string>(d.keys));
      })
      .catch(() => {});
    fetch("/api/calendar/custom")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !Array.isArray(d?.events)) return;
        setCustom(
          d.events.map((e: { id: string; date: string; title: string; detail: string }) => ({
            date: e.date,
            category: "Macro" as const,
            title: e.title,
            detail: e.detail,
            id: e.id,
          })),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /* Restore the last-used view (write happens in the change handler, not an
     effect, so this restore can't be clobbered on mount). */
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_KEY) as ViewMode | null;
      if (stored && VIEWS.some((v) => v.key === stored)) setView(stored);
    } catch {}
  }, []);

  const pickView = (v: ViewMode) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  /* Visible range per view (month range = full grid incl. adjacent-month days). */
  const range = useMemo(() => {
    if (view === "week") {
      const s = weekStart(cursor);
      return { start: s, end: addDays(s, 6), periodStart: s, periodEnd: addDays(s, 6) };
    }
    if (view === "month") {
      const ms = monthStart(cursor);
      const me = monthEnd(cursor);
      return { start: weekStart(ms), end: addDays(weekStart(me), 6), periodStart: ms, periodEnd: me };
    }
    if (view === "year") {
      const y = cursor.slice(0, 4);
      return { start: `${y}-01-01`, end: `${y}-12-31`, periodStart: `${y}-01-01`, periodEnd: `${y}-12-31` };
    }
    const end = addDays(today, 90);
    return { start: today, end, periodStart: today, periodEnd: end };
  }, [view, cursor, today]);

  const hasQuery = query.trim().length > 0;

  /* Events: forward-only, fetched out to at least +90d, further when the user
     pages ahead. The year view paints from snapshots, not events — skip it,
     unless the user is searching (search spans events across every view). */
  useEffect(() => {
    if (view === "year" && !hasQuery) return;
    const base = addDays(today, 90);
    const needed = range.end > base ? range.end : base;
    if (fetchedTo && needed <= fetchedTo) return;
    let alive = true;
    setLoading(true);
    fetch(`/api/calendar?to=${needed}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load calendar");
        return r.json();
      })
      .then((d) => {
        if (!alive) return;
        setEvents(d.events ?? []);
        setFetchedTo(needed);
        setError(null);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [view, range.end, fetchedTo, today, hasQuery]);

  /* Day P/L: capture today's snapshot first (same as the dashboard does), then
     read the full history and collapse it into per-day moves. */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await fetch("/api/snapshots", { method: "POST" });
      } catch {}
      try {
        const r = await fetch("/api/snapshots");
        if (!r.ok) throw new Error();
        const { snapshots, flows } = await r.json();
        if (alive) setPnl(buildDayPnl(snapshots ?? [], flows ?? []));
      } catch {
        if (alive) setPnl(new Map());
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ── Category chips + hidden events (unchanged behavior) ── */
  const toggle = (c: EventCategory) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next.size === 0 ? new Set(CATEGORIES) : next;
    });
  };

  const toggleHide = (e: CalendarEvent) => {
    const key = eventKey(e);
    let nowHidden = false;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else {
        next.add(key);
        nowHidden = true;
      }
      saveHidden(next);
      return next;
    });
    // Persist so the change reaches the iCal feed (Apple picks it up on its next
    // refresh). Optimistic — a failure leaves the local/localStorage state as-is.
    fetch("/api/calendar/hidden", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, hidden: nowHidden }),
    }).catch(() => {});
  };

  const toggleSubscribe = (e: CalendarEvent) => {
    const key = eventKey(e);
    let nowSubscribed = false;
    setSubscribed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else {
        next.add(key);
        nowSubscribed = true;
      }
      return next;
    });
    fetch("/api/calendar/subscribed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, subscribed: nowSubscribed }),
    }).catch(() => {});
  };

  const addCustom = async (date: string, title: string, detail: string) => {
    const res = await fetch("/api/calendar/custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, title, detail }),
    });
    if (!res.ok) return;
    const { event } = await res.json();
    if (!event) return;
    setCustom((prev) => [
      ...prev,
      { date: event.date, category: "Macro", title: event.title, detail: event.detail, id: event.id },
    ]);
  };

  const deleteCustom = (id: string) => {
    setCustom((prev) => prev.filter((e) => e.id !== id)); // optimistic
    fetch(`/api/calendar/custom?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  };

  /* Derived (holdings) events + user-added custom events, deduped by identity so
     nothing double-renders. */
  const merged = useMemo(() => [...events, ...custom], [events, custom]);

  const hiddenCount = useMemo(
    () => merged.filter((e) => active.has(e.category) && hidden.has(eventKey(e))).length,
    [merged, active, hidden],
  );

  const filtered = useMemo(
    () => merged.filter((e) => active.has(e.category) && (showHidden || !hidden.has(eventKey(e)))),
    [merged, active, hidden, showHidden],
  );

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of filtered) {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date)!.push(e);
    }
    return map;
  }, [filtered]);

  /* Search: matches title / detail / category across the loaded events (respects
     the category chips + hidden state via `filtered`). Non-empty query swaps the
     normal views for a results list so matches are visible in any view. */
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return filtered
      .filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          (e.detail ?? "").toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q),
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered, query]);

  /* Month/week summary: est. dividend income, earnings count, next big macro. */
  const summary = useMemo(() => {
    if (view !== "month" && view !== "week") return null;
    let div = 0;
    let hasDiv = false;
    let earnings = 0;
    let macro: CalendarEvent | null = null;
    for (const e of filtered) {
      if (e.date < range.periodStart || e.date > range.periodEnd) continue;
      if (e.category === "Dividend" && e.amount != null) {
        div += e.amount;
        hasDiv = true;
      } else if (e.category === "Earnings") {
        earnings++;
      } else if (e.category === "Macro" && e.impact === "high" && e.date >= today && !macro) {
        macro = e;
      }
    }
    if (!hasDiv && earnings === 0 && !macro) return null;
    return { div, hasDiv, earnings, macro };
  }, [view, filtered, range.periodStart, range.periodEnd, today]);

  /* ── Navigation ── */
  const navigate = (dir: -1 | 1) => {
    if (view === "week") setCursor(addDays(weekStart(cursor), dir * 7));
    else if (view === "month") {
      const next = addMonths(monthStart(cursor), dir);
      setCursor(next);
      setSelectedDay(next.slice(0, 7) === today.slice(0, 7) ? today : null);
    } else if (view === "year") {
      setCursor(`${Number(cursor.slice(0, 4)) + dir}-01-01`);
    }
  };

  const goToday = () => {
    setCursor(today);
    setSelectedDay(today);
  };

  const pickDayFromYear = (d: string) => {
    setCursor(monthStart(d));
    setSelectedDay(d);
    pickView("month");
  };

  const pickMonthFromYear = (first: string) => {
    setCursor(first);
    setSelectedDay(first.slice(0, 7) === today.slice(0, 7) ? today : null);
    pickView("month");
  };

  const title =
    view === "month"
      ? monthLabel(monthStart(cursor))
      : view === "week"
        ? `${shortDate(weekStart(cursor))} – ${shortDate(addDays(weekStart(cursor), 6))}, ${addDays(weekStart(cursor), 6).slice(0, 4)}`
        : view === "year"
          ? cursor.slice(0, 4)
          : "Upcoming Events";

  /* Double-click on a month cell zooms into that day's week. */
  const openWeek = (d: string) => {
    setCursor(d);
    setSelectedDay(d);
    pickView("week");
  };

  /* Label the browser tab by the calendar page being viewed. */
  useEffect(() => {
    document.title = view === "agenda" ? "Calendar — Fintrack" : `${title} — Fintrack`;
    return () => {
      document.title = "Fintrack";
    };
  }, [view, title]);

  return (
    <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
      <div className="mx-auto max-w-[1100px] flex flex-col gap-4">
        {/* Header: title · nav · view switcher · subscribe */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-baseline gap-3 min-w-0">
            <h1 className="text-lg text-foreground whitespace-nowrap">{title}</h1>
            {view === "agenda" && (
              <p className="text-xs text-muted-foreground hidden sm:block">
                Macro releases and events for your holdings · next 90 days
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {view !== "agenda" && (
              <div className="flex items-center rounded-sm border border-border overflow-hidden">
                <button
                  onClick={() => navigate(-1)}
                  className="px-2.5 py-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`Previous ${view}`}
                >
                  ‹
                </button>
                <button
                  onClick={goToday}
                  className="px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors border-x border-border"
                >
                  Today
                </button>
                <button
                  onClick={() => navigate(1)}
                  className="px-2.5 py-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`Next ${view}`}
                >
                  ›
                </button>
              </div>
            )}
            <div className="flex items-center rounded-sm border border-border p-0.5 gap-0.5" role="tablist">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  onClick={() => pickView(v.key)}
                  role="tab"
                  aria-selected={view === v.key}
                  className={`px-2.5 py-1 text-xs rounded-[3px] transition-colors ${
                    view === v.key
                      ? "bg-card text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <SubscribeButton subscribedCount={subscribed.size} />
          </div>
        </div>

        {/* Search — spans all views; a non-empty query shows a results list */}
        <div className="relative w-full max-w-xs">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
            <SearchIcon />
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events…"
            aria-label="Search calendar events"
            className="w-full bg-transparent border border-border rounded-sm pl-8 pr-7 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground transition-colors text-xs"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Category chips (events don't render in the year view; while searching
            they still narrow the results) */}
        {(view !== "year" || hasQuery) && (
          <div className="flex items-center gap-2 flex-wrap">
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
                  <span className="h-2 w-2 rounded-sm" style={{ background: CATEGORY_COLORS[c] }} aria-hidden />
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
            {loading && <span className="text-xs text-muted-foreground">Loading events…</span>}
            {!loading && error && <span className="text-xs text-muted-foreground">{error}</span>}
          </div>
        )}

        {/* Period summary */}
        {summary && !hasQuery && (
          <div className="flex items-center gap-x-4 gap-y-1 text-xs text-muted-foreground flex-wrap">
            {summary.hasDiv && (
              <span>
                Est. dividends{" "}
                <Sensitive className="text-foreground">{fmtUsd(summary.div)}</Sensitive>
              </span>
            )}
            {summary.earnings > 0 && (
              <span>
                {summary.earnings} earnings report{summary.earnings === 1 ? "" : "s"}
              </span>
            )}
            {summary.macro && (
              <span>
                <span style={{ color: "var(--negative)" }}>⚠</span> {summary.macro.title} ·{" "}
                {shortDate(summary.macro.date)}
              </span>
            )}
          </div>
        )}

        {/* Search results — replace the normal views while a query is active */}
        {hasQuery && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">
              {searchResults.length} result{searchResults.length === 1 ? "" : "s"} for “{query.trim()}”
              {loading && view === "year" ? " · loading events…" : ""}
            </p>
            {searchResults.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No events match “{query.trim()}”.
              </p>
            ) : (
              <AgendaList
                events={searchResults}
                hidden={hidden}
                subscribed={subscribed}
                onToggleHide={toggleHide}
                onToggleSubscribe={toggleSubscribe}
                onDeleteCustom={deleteCustom}
              />
            )}
          </div>
        )}

        {/* Views */}
        {!hasQuery && view === "month" && (
          <>
            <MonthGrid
              cursor={monthStart(cursor)}
              today={today}
              eventsByDate={eventsByDate}
              pnl={pnl}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              onOpenWeek={openWeek}
            />
            {selectedDay && (
              <DayPanel
                date={selectedDay}
                today={today}
                events={eventsByDate.get(selectedDay) ?? []}
                hidden={hidden}
                subscribed={subscribed}
                onToggleHide={toggleHide}
                onToggleSubscribe={toggleSubscribe}
                onAddCustom={addCustom}
                onDeleteCustom={deleteCustom}
                pnl={pnl?.get(selectedDay)}
              />
            )}
          </>
        )}

        {!hasQuery && view === "week" && (
          <WeekStrip
            start={weekStart(cursor)}
            today={today}
            eventsByDate={eventsByDate}
            pnl={pnl}
            hidden={hidden}
            subscribed={subscribed}
            onToggleHide={toggleHide}
            onToggleSubscribe={toggleSubscribe}
            onDeleteCustom={deleteCustom}
          />
        )}

        {!hasQuery && view === "year" && (
          <YearHeatmap
            year={Number(cursor.slice(0, 4))}
            today={today}
            pnl={pnl}
            onPickDay={pickDayFromYear}
            onPickMonth={pickMonthFromYear}
          />
        )}

        {!hasQuery && view === "agenda" &&
          (loading ? (
            <div className="flex flex-col gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <div className="w-28 h-5 rounded-sm bg-card animate-pulse shrink-0" />
                  <div className="flex-1 h-16 rounded-md bg-card animate-pulse" />
                </div>
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-muted-foreground">{error}</p>
          ) : (
            <AgendaList
              events={filtered}
              hidden={hidden}
              subscribed={subscribed}
              onToggleHide={toggleHide}
              onToggleSubscribe={toggleSubscribe}
              onDeleteCustom={deleteCustom}
            />
          ))}
      </div>
    </div>
  );
}

/* Magnifier icon for the search box (SVG, not emoji). */
function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ── iCal subscribe ──────────────────────────────────────────────────────── */

function SubscribeButton({ subscribedCount = 0 }: { subscribedCount?: number }) {
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState<{ webcal: string; https: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fetching = useRef(false);

  /* Feed category prefs — which categories a subscribed calendar receives.
     null until loaded. Saved server-side so the feed URL stays stable; Apple
     picks up changes on its next refresh. */
  const [feedCats, setFeedCats] = useState<Set<EventCategory> | null>(null);
  const [prefsErr, setPrefsErr] = useState<string | null>(null);

  const openPopover = () => {
    setOpen((p) => !p);
    if (urls || fetching.current) return;
    fetching.current = true;
    fetch("/api/calendar/feed-url")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Feed unavailable");
        setUrls(d);
      })
      .catch((e) => setErr(e.message))
      .finally(() => {
        fetching.current = false;
      });
    fetch("/api/calendar/prefs")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Prefs unavailable");
        setFeedCats(new Set(d.categories as EventCategory[]));
      })
      .catch((e) => setPrefsErr(e.message));
  };

  const toggleCat = (c: EventCategory) => {
    setFeedCats((prev) => {
      const base = prev ?? new Set(CATEGORIES);
      const next = new Set(base);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      // Persist in canonical order; the feed applies it on next refresh.
      const ordered = CATEGORIES.filter((x) => next.has(x));
      fetch("/api/calendar/prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: ordered }),
      }).catch(() => {});
      return next;
    });
  };

  const copy = async () => {
    if (!urls) return;
    try {
      await navigator.clipboard.writeText(urls.webcal);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="relative">
      <button
        onClick={openPopover}
        className="px-2.5 py-1 text-xs rounded-sm border border-border text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        Subscribe
      </button>
      {open && (
        <>
          <button
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Close"
            tabIndex={-1}
          />
          <div className="absolute right-0 top-full mt-2 z-20 w-72 rounded-md border border-border bg-card p-3 flex flex-col gap-2.5 shadow-lg">
            <div>
              <p className="text-xs text-foreground mb-1.5">Sync categories to feed</p>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((c) => {
                  const on = feedCats ? feedCats.has(c) : true;
                  return (
                    <button
                      key={c}
                      onClick={() => toggleCat(c)}
                      disabled={!feedCats && !prefsErr}
                      className="flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-40"
                      style={{
                        borderColor: on ? CATEGORY_COLORS[c] : "oklch(0.20 0 0)",
                        color: on ? "oklch(0.94 0.005 74)" : "oklch(0.52 0.008 74)",
                        background: on ? "oklch(0.14 0 0)" : "transparent",
                      }}
                      aria-pressed={on}
                    >
                      <span className="h-1.5 w-1.5 rounded-sm" style={{ background: CATEGORY_COLORS[c] }} aria-hidden />
                      {c}
                    </button>
                  );
                })}
              </div>
              {subscribedCount > 0 && (
                <p className="text-[11px] mt-2 text-foreground font-mono">
                  📡 +{subscribedCount} singular event{subscribedCount === 1 ? "" : "s"} subscribed to feed
                </p>
              )}
              {prefsErr && (
                <p className="text-[11px] mt-1" style={{ color: "var(--negative)" }}>{prefsErr}</p>
              )}
            </div>

            <div className="h-px bg-border" />

            <p className="text-xs text-foreground">Subscribe in Apple Calendar</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Copy the feed link, then: iPhone/iPad — Settings ▸ Apps ▸ Calendar ▸ Calendar
              Accounts ▸ Add Subscribed Calendar. Mac — Calendar ▸ File ▸ New Calendar
              Subscription. Changes here (and events you hide) sync on Apple&apos;s
              schedule (~hourly) — no need to re-subscribe.
            </p>
            {err ? (
              <p className="text-[11px]" style={{ color: "var(--negative)" }}>{err}</p>
            ) : (
              <button
                onClick={copy}
                disabled={!urls}
                className="self-start px-2.5 py-1 text-xs rounded-sm border transition-colors disabled:opacity-50"
                style={{
                  borderColor: copied ? "var(--primary)" : "var(--border)",
                  color: copied ? "var(--primary)" : "var(--foreground)",
                }}
              >
                {copied ? "Link copied ✓" : urls ? "Copy feed link" : "Loading…"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
