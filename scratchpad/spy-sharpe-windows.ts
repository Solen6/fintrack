/* Why does the S&P Sharpe read 0.81? Measure it across windows and against
   both return conventions, so the number can be explained rather than guessed.
     node_modules/.bin/jiti scratchpad/spy-sharpe-windows.ts                    */

import { yahooDailyHistory } from "../lib/yahoo";
import { dailyReturns, annualizedMeanReturn, annualizedGeoReturn, annualizedVol } from "../lib/analytics/stats";

const RF = 0.043;
const to = Math.floor(Date.now() / 1000);

// Pull the longest span once, then slice trailing windows off the end.
const full = await yahooDailyHistory("SPY", to - 2000 * 86400, to, { adjusted: true });
console.log(`SPY adjusted history: ${full.length} bars, ${full[0].date} → ${full[full.length - 1].date}\n`);

const rows: string[] = [];
const header = "window        bars   start        arith ret   geo ret     vol      Sharpe(arith)  Sharpe(geo)";
console.log(header);
console.log("-".repeat(header.length));

for (const [label, tradingDays] of [
  ["1 year", 252],
  ["2 years", 504],
  ["3 years", 756],
  ["5 years (max)", full.length],
] as const) {
  const slice = full.slice(Math.max(0, full.length - tradingDays));
  if (slice.length < 30) continue;
  const r = dailyReturns(slice.map((d) => d.close));
  const arith = annualizedMeanReturn(r);
  const geo = annualizedGeoReturn(r);
  const vol = annualizedVol(r);
  const sA = (arith - RF) / vol;
  const sG = (geo - RF) / vol;
  rows.push(label);
  console.log(
    `${label.padEnd(13)} ${String(slice.length).padStart(4)}   ${slice[0].date}   ` +
      `${(arith * 100).toFixed(2).padStart(7)}%   ${(geo * 100).toFixed(2).padStart(7)}%  ` +
      `${(vol * 100).toFixed(2).padStart(6)}%   ${sA.toFixed(2).padStart(10)}   ${sG.toFixed(2).padStart(10)}`,
  );
}

console.log(`\n(risk-free ${(RF * 100).toFixed(1)}%; Sharpe = (return − rf) / vol)`);
