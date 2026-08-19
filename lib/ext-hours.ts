/**
 * Pure helpers for extended-hours (pre/post market) data.
 *
 * Deliberately NOT in components/quotes/ExtHours.tsx: that file is "use client",
 * and every export of a "use client" module becomes a client reference, so a
 * server component that so much as reads a constant from it crashes with
 * "Attempted to call X from the server but X is on the client". Keeping the
 * predicate and the threshold here lets server and client code share them.
 *
 * The data behind these comes from lib/finnhub.ts, which fills the ext* fields
 * from Yahoo's includePrePost bars. ⚠️ They describe a move measured FROM the
 * regular-session close — they never replace it (see finnhub.ts on why that
 * would corrupt the snapshot history).
 */

/** The slice of a quote the extended-hours UI needs. Structural, so /api/quotes
 *  rows, watchlist items and the dashboard's local quote type all satisfy it. */
export interface ExtHoursQuote {
  marketState?: "pre" | "regular" | "post" | "closed";
  extPrice?: number;
  extChange?: number;
  extChangePct?: number;
  extTime?: number;
  extSession?: "pre" | "post";
  extSeries?: number[];
}

/** Under this the move rounds to 0.00%, and a badge saying nothing happened is
 *  noise — thin names often print a handful of shares at the closing price. */
export const EXT_MIN_PCT = 0.005;

/** Whether a quote has an extended-hours move worth showing. */
export const hasExtHours = (q: ExtHoursQuote | null | undefined): boolean =>
  !!q && q.extChangePct !== undefined && Math.abs(q.extChangePct) >= EXT_MIN_PCT;

/** "After hours" / "Pre-market", for labelling a figure derived from the session. */
export const extSessionLabel = (session: "pre" | "post" | undefined): string =>
  session === "pre" ? "Pre-market" : "After hours";
