/* End-to-end test of the basket → optimization/MC math on real Yahoo data.
   Run: npx tsx scratchpad/basket-pipeline-test.ts */
import { yahooDailyHistory } from "../lib/yahoo";
import {
  dailyReturns, annualizedMeanReturn, annualizedVol, annualizedGeoReturn,
  covarianceMatrix, annualizeCov, portfolioReturns,
  longOnlyFrontier, portfolioMetrics, randomCloud, mulberry32,
  bootstrapProjection,
} from "../lib/analytics/index";

const RF = 0.043;
const BASKET = ["AAPL", "MSFT", "NVDA", "KO", "JNJ"];

(async () => {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 730 * 86400;
  const all = [...BASKET, "SPY"];
  const hist = await Promise.all(all.map((s) => yahooDailyHistory(s, from, to)));
  const maps = new Map(all.map((s, i) => [s, new Map(hist[i].map((d) => [d.date, d.close]))]));

  // intersection
  let common: string[] | null = null;
  for (const s of all) {
    const m = maps.get(s)!;
    common = common === null ? [...m.keys()] : common.filter((d) => m.has(d));
  }
  const dates = (common ?? []).sort();
  console.log(`aligned window: ${dates.length} days, ${dates[0]} → ${dates[dates.length - 1]}`);

  const returns: Record<string, number[]> = {};
  for (const s of BASKET) returns[s] = dailyReturns(dates.map((d) => maps.get(s)!.get(d)!));

  const matrix = BASKET.map((s) => returns[s]);
  const mu = BASKET.map((s) => annualizedMeanReturn(returns[s]));
  const sigma = annualizeCov(covarianceMatrix(matrix));

  console.log("\nper-ticker annualized (mean ret / vol):");
  BASKET.forEach((s, i) => console.log(`  ${s.padEnd(5)} ret ${(mu[i] * 100).toFixed(1).padStart(6)}%  vol ${(annualizedVol(returns[s]) * 100).toFixed(1).padStart(5)}%`));

  const fr = longOnlyFrontier(mu, sigma, RF, 40);
  console.log(`\nfrontier points: ${fr.frontier.length}`);
  console.log(`max-Sharpe: Sharpe ${fr.maxSharpe.sharpe.toFixed(2)}  ret ${(fr.maxSharpe.ret * 100).toFixed(1)}%  vol ${(fr.maxSharpe.vol * 100).toFixed(1)}%`);
  console.log(`  weights: ${BASKET.map((s, i) => `${s} ${(fr.maxSharpe.weights[i] * 100).toFixed(0)}%`).join("  ")}`);
  console.log(`min-var:    Sharpe ${fr.gmv.sharpe.toFixed(2)}  ret ${(fr.gmv.ret * 100).toFixed(1)}%  vol ${(fr.gmv.vol * 100).toFixed(1)}%`);

  const eq = new Array(BASKET.length).fill(1 / BASKET.length);
  const cur = portfolioMetrics(mu, sigma, eq, RF);
  console.log(`\nequal-weight: Sharpe ${cur.sharpe.toFixed(2)}  ret ${(cur.ret * 100).toFixed(1)}%  vol ${(cur.vol * 100).toFixed(1)}%`);

  const cloud = randomCloud(mu, sigma, 200, mulberry32(42), RF);
  const cloudBeat = cloud.filter((c) => c.sharpe > fr.maxSharpe.sharpe + 1e-6).length;
  console.log(`cloud pts beating maxSharpe: ${cloudBeat} (want 0)`);

  // Monte Carlo on equal-weight basket
  const port = portfolioReturns(matrix, eq);
  const mc = bootstrapProjection(port, { initialValue: 100000, horizonDays: 252 * 10, paths: 1000, seed: 7 });
  console.log(`\nMC (equal-wt, $100k, 10y): P10 $${(mc.p10 / 1000).toFixed(0)}k  P50 $${(mc.median / 1000).toFixed(0)}k  P90 $${(mc.p90 / 1000).toFixed(0)}k`);
  console.log(`  basket annualized geo return ${(annualizedGeoReturn(port) * 100).toFixed(1)}%  vol ${(annualizedVol(port) * 100).toFixed(1)}%`);

  const okFrontier = cloudBeat === 0 && fr.maxSharpe.sharpe >= cur.sharpe - 1e-9 && fr.frontier.every((p) => Math.abs(p.weights.reduce((s, w) => s + w, 0) - 1) < 1e-6);
  const okMC = mc.p10 < mc.median && mc.median < mc.p90;
  console.log(`\n${okFrontier && okMC && dates.length > 400 ? "PASS" : "FAIL"}  (frontier=${okFrontier} mc=${okMC} window=${dates.length})`);
})();
