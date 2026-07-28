/* Tests the sector-benchmark data path (real Yahoo fetch). Run: npx tsx scratchpad/sector-bench-test.ts */
import { yahooDailyHistory } from "../lib/yahoo";
import { SP_SECTORS, normalizeSector } from "../lib/analytics/sectors-bench";

const to = Math.floor(Date.now() / 1000);
const from = to - 365 * 86400;

function cumReturn(closes: { close: number }[]): number {
  if (closes.length < 2) return 0;
  return closes[closes.length - 1].close / closes[0].close - 1;
}

(async () => {
  const syms = [...SP_SECTORS.map((s) => s.etf), "SPY"];
  for (const s of syms) {
    const h = await yahooDailyHistory(s, from, to);
    const cr = cumReturn(h);
    console.log(`${s.padEnd(5)} points=${String(h.length).padStart(4)}  cumReturn=${(cr * 100).toFixed(2).padStart(7)}%  ${h.length < 2 ? "  <-- NO DATA" : ""}`);
  }
  console.log("\nnormalizeSector checks:");
  for (const raw of ["Technology", "Financial Services", "Healthcare", "Consumer Cyclical", "Communication Services", "Energy", "Utilities", "Real Estate", "Basic Materials", "Consumer Defensive", "Industrials", "—", "Bitcoin"]) {
    console.log(`  ${raw.padEnd(24)} -> ${normalizeSector(raw)}`);
  }
})();
