/**
 * Tiny concurrency helper. Runs `fn` over `items` with at most `limit` in
 * flight at once, preserving input order in the result. Used to fan out quote
 * fetches in parallel (instead of the old sequential-loop-with-sleep) while
 * staying polite to upstream rate limits.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
