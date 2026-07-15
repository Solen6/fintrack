"use client";

import { useEffect, useRef, useState } from "react";

/* Dashboard reminders — a small personal checklist ("rebalance Roth",
   "sell before earnings"). Click the box to start typing; Enter saves.
   Open items first, done items sink below with a strikethrough. */

interface Reminder {
  id: string;
  text: string;
  done: boolean;
  created_at: string;
}

export function RemindersCard() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/reminders")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Failed to load reminders");
        setReminders(d.reminders ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load reminders"))
      .finally(() => setLoading(false));
  }, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      const r = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Couldn't save reminder");
      setReminders((cur) => [d.reminder, ...cur]);
      setDraft("");
      setError(null);
      inputRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save reminder");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (rem: Reminder) => {
    // Optimistic flip; revert on failure.
    setReminders((cur) => cur.map((r) => (r.id === rem.id ? { ...r, done: !r.done } : r)));
    const res = await fetch("/api/reminders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rem.id, done: !rem.done }),
    }).catch(() => null);
    if (!res?.ok) {
      setReminders((cur) => cur.map((r) => (r.id === rem.id ? { ...r, done: rem.done } : r)));
    }
  };

  const remove = async (rem: Reminder) => {
    const prev = reminders;
    setReminders((cur) => cur.filter((r) => r.id !== rem.id));
    const res = await fetch("/api/reminders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rem.id }),
    }).catch(() => null);
    if (!res?.ok) setReminders(prev);
  };

  const open = reminders.filter((r) => !r.done);
  const done = reminders.filter((r) => r.done);

  return (
    <section
      className="rounded-md border border-border bg-card p-4 cursor-text"
      onClick={(e) => {
        // Clicking anywhere blank in the box focuses the input.
        if (e.target === e.currentTarget) inputRef.current?.focus();
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">Reminders</h2>
        {open.length > 0 && (
          <span
            className="text-[10px] font-mono rounded-sm px-1.5 py-0.5"
            style={{ color: "var(--primary)", background: "oklch(0.72 0.14 74 / 0.12)" }}
          >
            {open.length}
          </span>
        )}
      </div>

      <form onSubmit={add} className="mb-2">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a reminder and press Enter…"
          maxLength={500}
          className="w-full bg-transparent border-b border-border pb-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[var(--primary)] transition-colors"
          aria-label="New reminder"
        />
      </form>

      {loading && <p className="text-xs text-muted-foreground py-1">Loading…</p>}
      {!loading && error && <p className="text-xs py-1" style={{ color: "var(--negative)" }}>{error}</p>}
      {!loading && !error && reminders.length === 0 && (
        <p className="text-xs text-muted-foreground py-1">
          Nothing yet — notes to self live here.
        </p>
      )}

      {(open.length > 0 || done.length > 0) && (
        <ul className="flex flex-col max-h-[240px] overflow-y-auto pr-1">
          {[...open, ...done].map((rem) => (
            <li
              key={rem.id}
              className="group flex items-start gap-2.5 py-1.5 border-b border-border/60 last:border-0 text-sm"
            >
              <button
                onClick={() => toggle(rem)}
                aria-label={rem.done ? `Mark "${rem.text}" not done` : `Mark "${rem.text}" done`}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border transition-colors"
                style={
                  rem.done
                    ? { background: "var(--primary)", borderColor: "var(--primary)" }
                    : { borderColor: "oklch(0.35 0.008 74)" }
                }
              />
              <span
                className={`flex-1 min-w-0 break-words ${
                  rem.done ? "line-through text-muted-foreground" : "text-foreground"
                }`}
              >
                {rem.text}
              </span>
              <button
                onClick={() => remove(rem)}
                aria-label={`Delete "${rem.text}"`}
                title="Delete"
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-foreground text-sm leading-none shrink-0"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
