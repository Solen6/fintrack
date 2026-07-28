/* The S&P point is computed from the basket route's own benchmark series.
   This reproduces that path end-to-end against live Yahoo and sanity-checks the
   numbers, including that it's total return (adjusted) like the rest of the chart.
     node_modules/.bin/jiti scratchpad/spy-point-test.ts                        */

import { yahooDailyHistory } from "../lib/yahoo";
import { dailyReturns, annualizedMeanReturn, annualizedVol, covarianceMatrix, annualizeCov } from "../lib/analytics/stats";

const RF = 0.043;
let fails = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "✓" : "✗ FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const to = Math.floor(Date.now() / 1000);
const from = to - 730 * 86400;

// Exactly what app/api/analysis/basket/route.ts does for BENCHMARK.
const adj = await yahooDailyHistory("SPY", from, to, { adjusted: true });
const raw = await yahooDailyHistory("SPY", from, to);
check("SPY history returned", adj.length > 200, `${adj.length} bars`);

const rets = dailyReturns(adj.map((d) => d.close));
const ret = annualizedMeanReturn(rets);
const vol = annualizedVol(rets);
const sharpe = vol > 0 ? (ret - RF) / vol : 0;

console.log(`\n   S&P 500 point:  ret ${(ret * 100).toFixed(2)}%   vol ${(vol * 100).toFixed(2)}%   Sharpe ${sharpe.toFixed(2)}`);
console.log(`   window: ${adj[0].date} → ${adj[adj.length - 1].date}`);

const priceRet = annualizedMeanReturn(dailyReturns(raw.map((d) => d.close)));
console.log(`   price-return would have been ${(priceRet * 100).toFixed(2)}% (dividend yield ≈ ${((ret - priceRet) * 100).toFixed(2)}%)`);

check("uses total return, not price return", ret > priceRet + 0.005, `${(ret * 100).toFixed(2)}% vs ${(priceRet * 100).toFixed(2)}%`);
check("return is plausible for a broad equity index", ret > -0.4 && ret < 0.6);
check("vol is plausible for the S&P (8-35%)", vol > 0.08 && vol < 0.35, `${(vol * 100).toFixed(2)}%`);
check("Sharpe is finite", Number.isFinite(sharpe));

/* The tool measures the S&P the same way it measures every basket ticker. Prove
   the single-series path agrees with the covariance-matrix path used for the
   frontier, so the point can't sit on a different scale from the curve. */
const viaCov = Math.sqrt(annualizeCov(covarianceMatrix([rets]))[0][0]);
check("vol matches the frontier's covariance path", Math.abs(viaCov - vol) < 1e-12, `${viaCov} vs ${vol}`);

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`}`);
