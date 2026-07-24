"use client";

import { useState } from "react";
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
  onAddCustom,
  onDeleteCustom,
  pnl,
}: {
  date: string;
  today: string;
  events: CalendarEvent[];
  hidden: Set<string>;
  onToggleHide: (e: CalendarEvent) => void;
  onAddCustom: (date: string, title: string, detail: string) => Promise<void>;
  onDeleteCustom: (id: string) => void;
  pnl: DayPnl | undefined;
}) {
  const { hidden: priv } = usePrivacy();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    try {
      await onAddCustom(date, t, detail.trim());
      setTitle("");
      setDetail("");
      setAdding(false);
    } finally {
      setSaving(false);
    }
  };

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
              key={e.id ?? `${e.title}-${i}`}
              event={e}
              isHidden={hidden.has(eventKey(e))}
              onToggleHide={onToggleHide}
              onDeleteCustom={onDeleteCustom}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No events.</p>
      )}

      {/* Add a custom one-off event on this day. Syncs to the iCal feed under
          the 'Custom' category (its own feed toggle). */}
      {adding ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-background/40 px-3 py-2.5">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="Event title (e.g. Fed Chair speaks)"
            maxLength={120}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none border-b border-border pb-1.5 focus:border-[var(--primary)] transition-colors"
          />
          <input
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="Note (optional)"
            maxLength={300}
            className="w-full bg-transparent text-xs text-muted-foreground placeholder:text-muted-foreground outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={submit}
              disabled={!title.trim() || saving}
              className="px-2.5 py-1 text-xs rounded-sm border transition-colors disabled:opacity-50"
              style={{ borderColor: "var(--primary)", color: "var(--primary)" }}
            >
              {saving ? "Saving…" : "Add event"}
            </button>
            <button
              onClick={() => setAdding(false)}
              className="px-2.5 py-1 text-xs rounded-sm border border-border text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="self-start text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ＋ Add event
        </button>
      )}
    </div>
  );
}
