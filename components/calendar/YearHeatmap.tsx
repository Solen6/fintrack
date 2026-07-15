"use client";

import { useMemo } from "react";
import { usePrivacy, PRIVATE_GRAPH_LABEL } from "@/lib/privacy";
import {
  daysInMonth,
  dayOfWeek,
  pnlTint,
  type DayPnl,
} from "./calendar-shared";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/** Year view: 12 mini-months, each day tinted by that day's portfolio move. */
export function YearHeatmap({
  year,
  today,
  pnl,
  onPickDay,
  onPickMonth,
}: {
  year: number;
  today: string;
  pnl: Map<string, DayPnl> | null;
  onPickDay: (d: string) => void;
  onPickMonth: (monthFirst: string) => void;
}) {
  const { hidden: priv } = usePrivacy();

  const months = useMemo(
    () =>
      MONTHS.map((label, i) => {
        const m = i + 1;
        const first = `${year}-${String(m).padStart(2, "0")}-01`;
        const lead = dayOfWeek(first);
        const count = daysInMonth(year, m);
        const days = Array.from(
          { length: count },
          (_, d) => `${year}-${String(m).padStart(2, "0")}-${String(d + 1).padStart(2, "0")}`,
        );
        return { label, first, lead, days };
      }),
    [year],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-5 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {months.map(({ label, first, lead, days }) => (
          <div key={first} className="rounded-md border border-border bg-card p-3 flex flex-col gap-2">
            <button
              onClick={() => onPickMonth(first)}
              className="self-start text-sm text-foreground hover:text-[var(--primary)] transition-colors"
            >
              {label}
            </button>
            <div className="grid grid-cols-7 gap-[3px]">
              {LETTERS.map((l, i) => (
                <span key={i} className="text-[8px] text-muted-foreground text-center select-none">
                  {l}
                </span>
              ))}
              {Array.from({ length: lead }).map((_, i) => (
                <span key={`lead-${i}`} />
              ))}
              {days.map((date) => {
                const day = pnl?.get(date);
                const tint = !priv && day ? pnlTint(day.pct, 1.6) : undefined;
                const isToday = date === today;
                const future = date > today;
                return (
                  <button
                    key={date}
                    onClick={() => onPickDay(date)}
                    aria-label={date}
                    className={`aspect-square w-full rounded-[2px] ${
                      isToday ? "ring-1 ring-[var(--primary)]" : ""
                    }`}
                    style={{
                      background: tint ?? "oklch(0.15 0 0)",
                      opacity: future && !isToday ? 0.3 : 1,
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
        {priv ? (
          <span>Daily portfolio moves — {PRIVATE_GRAPH_LABEL.toLowerCase()}</span>
        ) : (
          <>
            <span>Daily portfolio move</span>
            <span>−</span>
            <div className="flex gap-[3px]">
              {[-0.012, -0.006, 0, 0.006, 0.012].map((p, i) => (
                <span
                  key={i}
                  className="h-3 w-3 rounded-[2px]"
                  style={{ background: pnlTint(p, 1.6) ?? "oklch(0.15 0 0)" }}
                />
              ))}
            </div>
            <span>+</span>
          </>
        )}
      </div>
    </div>
  );
}
