/* Shared types + helpers for the calendar views (Month / Week / Year / Agenda). */

export type EventCategory = "Macro" | "Earnings" | "Dividend" | "Split" | "Custom";

export interface CalendarEvent {
  date: string; // YYYY-MM-DD
  category: EventCategory;
  title: string;
  detail: string;
  ticker?: string;
  impact?: "high" | "med" | "low";
  amount?: number; // estimated total $ for dividends — sensitive, mask in Private mode
  id?: string;     // present on user-added "Custom" events — the DB row id (for delete)
}

export const CATEGORIES: EventCategory[] = ["Macro", "Earnings", "Dividend", "Split", "Custom"];

export const CATEGORY_COLORS: Record<EventCategory, string> = {
  Macro:    "oklch(0.64 0.07 240)",
  Earnings: "oklch(0.72 0.14 74)",
  Dividend: "oklch(0.72 0.15 152)",
  Split:    "oklch(0.70 0.13 300)",
  Custom:   "oklch(0.72 0.10 195)",
};

/* Day-P/L tint colors — green gain / red loss, matching the Positions donut
   (amber stays the brand/neutral accent, not a direction). */
const GAIN_BASE = "0.72 0.15 152";
const LOSS_BASE = "0.64 0.16 28";

/** Cell background for a day's portfolio move. Alpha scales with magnitude,
    saturating at ±1.5% (a big single-day move for a diversified book). */
export function pnlTint(pct: number, factor = 1): string | undefined {
  if (!Number.isFinite(pct) || pct === 0) return undefined;
  const a = (0.05 + 0.2 * Math.min(Math.abs(pct) / 0.015, 1)) * factor;
  return `oklch(${pct > 0 ? GAIN_BASE : LOSS_BASE} / ${a.toFixed(3)})`;
}

export const GAIN_TEXT = `oklch(${GAIN_BASE})`;
export const LOSS_TEXT = `oklch(${LOSS_BASE})`;

/* ── Hidden-event persistence (unchanged from the old agenda) ── */

export const HIDDEN_KEY = "fintrack:calendar:hidden";
export const VIEW_KEY = "fintrack:calendar:view";

export function eventKey(e: { date: string; title: string; category: string }): string {
  return `${e.date}|${e.category}|${e.title}`;
}

export function loadHidden(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(HIDDEN_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

export function saveHidden(set: Set<string>) {
  try {
    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set]));
  } catch {}
}

/* ── Date-string math (YYYY-MM-DD, UTC-anchored so DST can't shift a day) ── */

export const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDs(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function fmtDs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(s: string, n: number): string {
  return fmtDs(parseDs(s) + n * DAY_MS);
}

/** 0=Sun..6=Sat */
export function dayOfWeek(s: string): number {
  return new Date(parseDs(s)).getUTCDay();
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Today in America/New_York — the key space snapshots + market data use. */
export function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export function monthStart(s: string): string {
  return s.slice(0, 8) + "01";
}

export function monthEnd(s: string): string {
  const [y, m] = s.split("-").map(Number);
  return `${s.slice(0, 8)}${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

/** Sunday on or before `s`. */
export function weekStart(s: string): string {
  return addDays(s, -dayOfWeek(s));
}

export function addMonths(s: string, n: number): string {
  const [y, m] = s.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

export function formatDateLabel(dateStr: string): string {
  const d = new Date(parseDs(dateStr));
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export function monthLabel(s: string): string {
  return new Date(parseDs(s)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function shortDate(s: string): string {
  return new Date(parseDs(s)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export const fmtUsd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export const fmtSignedUsd = (n: number) => (n >= 0 ? "+" : "−") + fmtUsd(Math.abs(n));

export const fmtSignedPct = (pct: number, digits = 2) =>
  (pct >= 0 ? "+" : "−") + (Math.abs(pct) * 100).toFixed(digits) + "%";

/* ── Day P/L from stored snapshots ──
   Collapses per-account snapshot rows into one NAV per day (same rule as the
   dashboard series: per-account rows summed; a legacy account==null row is a
   pre-split combined total, used only when a date has NO per-account rows).

   Day $ is the unit-method day gain: NAV change net of external flows — a
   deposit lifts NAV but is not a gain (identical to consecutive gainByDate
   deltas in lib/portfolio-return.ts).

   Day % divides that gain by the prior day's POSITIONS value (cash excluded)
   — the dashboard hero's convention (agg.todayPct, which matches Fidelity's
   daily %). Dividing by whole NAV instead quietly diluted every day's % by
   the cash share and made the calendar disagree with the dashboard. */

interface SnapRow { date: string; value: number; cash: number; account: string | null }
interface FlowRow { date: string; amount: number } // signed: deposits +, withdrawals −

export interface DayPnl {
  change: number; // $ vs previous stored day, net of external flows
  pct: number;    // change / previous day's positions value (dashboard convention)
  nav: number;
}

export function buildDayPnl(snapshots: SnapRow[], flows: FlowRow[]): Map<string, DayPnl> {
  const perAccount = new Map<string, { nav: number; positions: number }>();
  const legacy = new Map<string, { nav: number; positions: number }>();
  for (const s of snapshots) {
    const positions = s.value ?? 0;
    const nav = positions + (s.cash ?? 0);
    if (s.account === null) {
      const prev = legacy.get(s.date);
      legacy.set(s.date, { nav: (prev?.nav ?? 0) + nav, positions: (prev?.positions ?? 0) + positions });
    } else {
      const prev = perAccount.get(s.date);
      perAccount.set(s.date, { nav: (prev?.nav ?? 0) + nav, positions: (prev?.positions ?? 0) + positions });
    }
  }
  const byDate = new Map(perAccount);
  for (const [date, row] of legacy) {
    if (!byDate.has(date)) byDate.set(date, row);
  }

  const flowByDate = new Map<string, number>();
  for (const f of flows) {
    flowByDate.set(f.date, (flowByDate.get(f.date) ?? 0) + (f.amount ?? 0));
  }

  const days = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  const out = new Map<string, DayPnl>();
  for (let i = 1; i < days.length; i++) {
    const [date, row] = days[i];
    const [prevDate, prevRow] = days[i - 1];
    // A gap wider than a long weekend means missing history (import seam,
    // snapshot outage) — a "day" change across it would be misleading.
    if (parseDs(date) - parseDs(prevDate) > 7 * DAY_MS) continue;
    if (prevRow.nav <= 0) continue;
    const change = row.nav - prevRow.nav - (flowByDate.get(date) ?? 0);
    // All-cash days (positions ≤ 0) fall back to NAV so the % stays defined.
    const denom = prevRow.positions > 0 ? prevRow.positions : prevRow.nav;
    out.set(date, { change, pct: change / denom, nav: row.nav });
  }
  return out;
}
