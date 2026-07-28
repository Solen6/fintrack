import type { SupabaseClient } from "@supabase/supabase-js";
import { weightsFromHoldings, type HoldingRow } from "@/lib/portfolio-positions";

/* ──────────────────────────────────────────────────────────────────────────
   Yearly capture of each user's portfolio composition, for the efficient-
   frontier chart's "past years" points.

   Runs unattended off the daily snapshots cron, so a year is never missed just
   because the user didn't open the Analysis tab. A user is "due" when they have
   no snapshot yet, or their newest is CAPTURE_EVERY_DAYS old — the same rule the
   interactive POST route applies, so the two can't disagree about the schedule.
   ────────────────────────────────────────────────────────────────────────── */

export const CAPTURE_EVERY_DAYS = 365;
const MAX_LEGS = 60;

/** Row shape needed from `holdings`; the cron already selects `*`. */
export type SnapshotHolding = HoldingRow & { user_id: string };

export interface FrontierSnapshotRun {
  users: number;
  captured: number;
  skipped?: string;
}

const isSetupError = (m: string) => /schema cache|does not exist|PGRST205/i.test(m);
const daysBetween = (a: string, b: string) =>
  Math.floor((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * Capture a yearly snapshot for every user who's due one.
 *
 * `holdings` and `quotes` are passed in already-fetched so this adds no extra
 * Finnhub or Postgres round-trips to the daily run. Never throws: a missing
 * table (migration not run yet) or a single failing user must not abort the
 * cron it rides on.
 */
export async function captureDueFrontierSnapshots(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>,
  today: string,
  holdings: SnapshotHolding[],
  quotes: Record<string, { price?: number } | undefined>,
): Promise<FrontierSnapshotRun> {
  // Newest capture per user, in one read.
  const { data: existing, error } = await db
    .from("portfolio_frontier_snapshots")
    .select("user_id,taken_on");
  if (error) {
    return {
      users: 0,
      captured: 0,
      skipped: isSetupError(error.message)
        ? "portfolio_frontier_snapshots table missing — run supabase/portfolio-frontier-snapshots.sql"
        : error.message,
    };
  }

  const newest = new Map<string, string>();
  for (const r of (existing ?? []) as { user_id: string; taken_on: string }[]) {
    const taken = String(r.taken_on).slice(0, 10);
    const prev = newest.get(r.user_id);
    if (!prev || taken > prev) newest.set(r.user_id, taken);
  }

  // Group holdings per user.
  const byUser = new Map<string, SnapshotHolding[]>();
  for (const h of holdings) {
    if (!h.user_id) continue;
    const list = byUser.get(h.user_id) ?? [];
    list.push(h);
    byUser.set(h.user_id, list);
  }

  const rowsToWrite: {
    user_id: string;
    taken_on: string;
    weights: Record<string, number>;
    total_value: number;
  }[] = [];

  for (const [user_id, rows] of byUser) {
    const last = newest.get(user_id);
    if (last && daysBetween(last, today) < CAPTURE_EVERY_DAYS) continue;

    const { weights, riskyValue } = weightsFromHoldings(rows, quotes);
    const tickers = Object.keys(weights);
    if (tickers.length === 0 || riskyValue <= 0) continue;

    // Keep the biggest positions if someone holds more than the cap.
    const capped =
      tickers.length <= MAX_LEGS
        ? weights
        : Object.fromEntries(
            Object.entries(weights)
              .sort((a, b) => b[1] - a[1])
              .slice(0, MAX_LEGS),
          );

    rowsToWrite.push({ user_id, taken_on: today, weights: capped, total_value: riskyValue });
  }

  if (rowsToWrite.length === 0) return { users: byUser.size, captured: 0 };

  // ignoreDuplicates: a same-day re-run must be a no-op, not an error.
  const { error: upErr } = await db
    .from("portfolio_frontier_snapshots")
    .upsert(rowsToWrite, { onConflict: "user_id,taken_on", ignoreDuplicates: true });
  if (upErr) return { users: byUser.size, captured: 0, skipped: upErr.message };

  return { users: byUser.size, captured: rowsToWrite.length };
}
