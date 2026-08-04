/* Free-text notes on cash-flow ledger rows (deposits / withdrawals).
 *
 * Its own module — NOT lib/transactions.ts — because the deposit form is a
 * client component and transactions.ts pulls in node:crypto. One definition
 * shared by the form (input cap) and the routes (storage), so the two can't
 * drift apart on what counts as a valid note. */

/** Longest note stored on a ledger row. `transactions.description` is `text`,
 *  so this is a product limit, not a schema one — long enough for a real
 *  reminder, short enough to stay on one line in the activity feed. */
export const NOTE_MAX = 200;

/** Normalize a user's note for storage. Collapses whitespace (a pasted
 *  multi-line note would otherwise break the feed's single-line layout) and
 *  truncates. Blank → null, so callers fall back to their default label rather
 *  than writing an empty description. */
export function normalizeNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, NOTE_MAX) : null;
}
