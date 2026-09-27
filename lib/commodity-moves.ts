// Which days on a price chart deserve a catalyst marker.
//
// A catalyst is a day the price actually MOVED — not every scheduled Fed or CPI
// date, which is what the chart used to mark and why it read like mock data: a
// dozen dashed lines on days nothing happened. The catalysts route finds the big
// moves on a year of daily closes and explains each one; the chart then picks the
// few that fit the window it's drawing.
//
// Pure and client-safe (no server imports).

export interface Move {
  date: string;   // trading day of the move, "YYYY-MM-DD"
  prev: string;   // the session it's measured from
  pct: number;    // close-to-close % change, 1 decimal
  z: number;      // size in standard deviations of this series' daily returns
}

/** A big move and what explains it, as served by /api/commodities/catalysts.
 *  `news`  — a dated headline about this asset, moving the same direction.
 *  `macro` — no headline, but a high-impact scheduled release landed that day.
 *  `move`  — nothing found; the marker still shows the move itself. */
export interface Catalyst extends Move {
  kind: "news" | "macro" | "move";
  label: string;
  source?: string;
  url?: string;
}

/** The biggest close-to-close moves, scored in standard deviations of the whole
 *  series' daily log returns, so "big" is relative to the asset: a 4% day is rare
 *  for gold and routine for uranium. Days within `suppress` sessions of a bigger
 *  move are the same episode (the crash and the next day's bounce) and dropped. */
export function detectMoves(
  series: Array<{ date: string; price: number }>,
  opts: { minZ?: number; max?: number; suppress?: number } = {},
): Move[] {
  const { minZ = 2, max = 12, suppress = 3 } = opts;

  const rets: Array<{ i: number; date: string; prev: string; r: number }> = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1].price;
    const b = series[i].price;
    if (!(a > 0) || !(b > 0)) continue;
    rets.push({ i, date: series[i].date, prev: series[i - 1].date, r: Math.log(b / a) });
  }
  // Under a month of sessions there's no meaningful baseline to measure against.
  if (rets.length < 20) return [];

  const mean = rets.reduce((s, x) => s + x.r, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x.r - mean) ** 2, 0) / (rets.length - 1));
  if (!(sd > 0)) return [];

  const ranked = rets
    .map((x) => ({ ...x, z: (x.r - mean) / sd }))
    .filter((x) => Math.abs(x.z) >= minZ)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));

  const picked: typeof ranked = [];
  for (const x of ranked) {
    if (picked.length >= max) break;
    if (picked.some((p) => Math.abs(p.i - x.i) <= suppress)) continue;
    picked.push(x);
  }

  return picked
    .sort((a, b) => a.i - b.i)
    .map((x) => ({
      date: x.date,
      prev: x.prev,
      pct: Math.round((Math.exp(x.r) - 1) * 1000) / 10,
      z: Math.round(x.z * 10) / 10,
    }));
}

/** Markers to draw for the visible window: largest moves first, skipping any that
 *  would land within `minGap` sessions of one already chosen so labels never
 *  stack, capped at `maxCount`. Only dates present in the drawn series qualify —
 *  a marker off the line would point at nothing. Returned in date order. */
export function selectCatalysts<T extends { date: string; z: number }>(
  items: T[],
  visibleDates: string[],
  maxCount: number,
  /** Sessions a badge occupies on screen. The chart measures this from its own
   *  width; the fallback only applies when there's nothing to measure. */
  minGapSessions?: number,
): T[] {
  if (visibleDates.length === 0 || maxCount <= 0) return [];
  const index = new Map(visibleDates.map((d, i) => [d, i]));
  const minGap = Math.max(2, Math.round(minGapSessions ?? visibleDates.length / 8));

  const chosen: Array<{ item: T; at: number }> = [];
  for (const item of [...items].sort((a, b) => Math.abs(b.z) - Math.abs(a.z))) {
    if (chosen.length >= maxCount) break;
    const at = index.get(item.date);
    if (at === undefined) continue;
    if (chosen.some((c) => Math.abs(c.at - at) < minGap)) continue;
    chosen.push({ item, at });
  }
  return chosen.sort((a, b) => a.at - b.at).map((c) => c.item);
}
