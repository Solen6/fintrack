/**
 * US equity market (NYSE/Nasdaq) trading-day calendar.
 *
 * Used to avoid recording portfolio snapshots on days the market is closed —
 * those would just duplicate the prior close and flat-line the performance
 * chart. Operates on a "YYYY-MM-DD" string already in America/New_York (the
 * same key the snapshot routes use), so there are no timezone surprises.
 */

/** Easter Sunday (Meeus/Jones/Butcher Gregorian algorithm). month: 3=Mar,4=Apr */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Day of week for a Y-M-D (0=Sun..6=Sat), via a UTC date to dodge DST/tz. */
function dow(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** nth given weekday of a month, e.g. 3rd Monday. weekday: 0=Sun..6=Sat */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = dow(year, month, 1);
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

/** Last given weekday of a month. */
function lastWeekday(year: number, month: number, weekday: number): number {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate(); // last day of month
  const last = dow(year, month, days);
  return days - ((last - weekday + 7) % 7);
}

/** NYSE observance for a fixed-date holiday: Sat→prior Fri, Sun→next Mon. */
function observed(year: number, month: number, day: number): string {
  const wd = dow(year, month, day);
  if (wd === 6) {
    // Saturday → observed Friday (prior day)
    const dt = new Date(Date.UTC(year, month - 1, day - 1));
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  if (wd === 0) {
    // Sunday → observed Monday (next day)
    const dt = new Date(Date.UTC(year, month - 1, day + 1));
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  return iso(year, month, day);
}

const holidayCache = new Map<number, Set<string>>();

/** The set of NYSE/Nasdaq full-day closures for a year (observed dates). */
function holidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const set = new Set<string>();
  const easter = easterSunday(year);
  const goodFriday = new Date(Date.UTC(year, easter.month - 1, easter.day - 2));

  set.add(observed(year, 1, 1)); // New Year's Day
  set.add(iso(year, 1, nthWeekday(year, 1, 1, 3))); // MLK Day — 3rd Mon Jan
  set.add(iso(year, 2, nthWeekday(year, 2, 1, 3))); // Presidents' Day — 3rd Mon Feb
  set.add(iso(goodFriday.getUTCFullYear(), goodFriday.getUTCMonth() + 1, goodFriday.getUTCDate())); // Good Friday
  set.add(iso(year, 5, lastWeekday(year, 5, 1))); // Memorial Day — last Mon May
  set.add(observed(year, 6, 19)); // Juneteenth (since 2022)
  set.add(observed(year, 7, 4)); // Independence Day
  set.add(iso(year, 9, nthWeekday(year, 9, 1, 1))); // Labor Day — 1st Mon Sep
  set.add(iso(year, 11, nthWeekday(year, 11, 4, 4))); // Thanksgiving — 4th Thu Nov
  set.add(observed(year, 12, 25)); // Christmas

  holidayCache.set(year, set);
  return set;
}

/**
 * Is `dateStr` (YYYY-MM-DD, America/New_York) a regular trading day?
 * False on weekends and full-day NYSE/Nasdaq holidays. (Early-close days like
 * the day after Thanksgiving still trade, so they count as open.)
 */
export function isMarketDay(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return true; // malformed → don't block recording
  const wd = dow(y, m, d);
  if (wd === 0 || wd === 6) return false; // weekend
  return !holidays(y).has(dateStr);
}
