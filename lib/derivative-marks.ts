import { yahooQuote, fetchOptionChain } from "@/lib/yahoo";

export interface DerivativeRow {
  id: string;
  instrument_type: string;
  underlying: string;
  expiry: string | null;
  strike: number | null;
  option_type: string | null;
}

/** Yahoo's listed expirations don't always line up with a plain UTC midnight
 *  for our stored date — match by calendar date first, else nearest. */
function matchExpiration(expirations: number[], targetISO: string): number | undefined {
  const targetDay = targetISO.slice(0, 10);
  const targetMs = new Date(`${targetDay}T00:00:00Z`).getTime();
  let best: number | undefined;
  let bestDiff = Infinity;
  for (const e of expirations) {
    const day = new Date(e * 1000).toISOString().slice(0, 10);
    if (day === targetDay) return e;
    const diff = Math.abs(e * 1000 - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = e; }
  }
  return best;
}

function midOrLast(c: { bid?: number; ask?: number; lastPrice?: number }): number | undefined {
  if (c.bid && c.ask && c.bid > 0 && c.ask > 0) return (c.bid + c.ask) / 2;
  return c.lastPrice && c.lastPrice > 0 ? c.lastPrice : undefined;
}

/** Live per-unit marks for option/future holdings. Never throws — a row that
 *  can't be priced is simply absent from the result (callers fall back to
 *  cost basis), same contract as computeBondMarks. */
export async function computeDerivativeMarks(rows: DerivativeRow[]): Promise<Record<string, { currentPrice: number }>> {
  const marks: Record<string, { currentPrice: number }> = {};

  const futureRows = rows.filter((r) => r.instrument_type === "future");
  const futureSymbols = [...new Set(futureRows.map((r) => r.underlying))];
  await Promise.all(
    futureSymbols.map(async (sym) => {
      const q = await yahooQuote(sym).catch(() => null);
      if (q?.price != null) {
        for (const r of futureRows.filter((row) => row.underlying === sym)) {
          marks[r.id] = { currentPrice: q.price };
        }
      }
    }),
  );

  const optionRows = rows.filter((r) => r.instrument_type === "option" && r.expiry && r.strike != null);
  const groups = new Map<string, DerivativeRow[]>();
  for (const r of optionRows) {
    const key = `${r.underlying}|${r.expiry}`;
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }

  await Promise.all(
    [...groups.entries()].map(async ([key, groupRows]) => {
      const [underlying, expiryISO] = key.split("|");
      try {
        const base = await fetchOptionChain(underlying);
        const targetExpiry = matchExpiration(base.expirationDates, expiryISO);
        if (targetExpiry == null) return;
        const chain = targetExpiry === base.expirationDates[0] ? base : await fetchOptionChain(underlying, targetExpiry);
        for (const r of groupRows) {
          const list = r.option_type === "PUT" ? chain.puts : chain.calls;
          const contract = list.find((c) => c.strike === r.strike);
          const price = contract ? midOrLast(contract) : undefined;
          if (price != null) marks[r.id] = { currentPrice: price };
        }
      } catch {
        // non-fatal — this group's rows fall back to cost basis
      }
    }),
  );

  return marks;
}
