/* Risk / benchmark metrics for a single month: Beta, Jensen's Alpha, Sharpe.
 *
 * All three are built from DAILY returns within the month:
 *   • portfolio daily returns come from the unit-method cumulative series
 *     (lib/portfolio-return.ts `cumByDate`) chain-linked day-over-day, so they
 *     are flow-adjusted and rebalance-proof — the same basis as the reported
 *     "monthly return".
 *   • benchmark (S&P 500 / SPY) daily returns come from daily closes.
 *   • the risk-free rate is the month's short-tenor Treasury par yield.
 *
 * Beta  = Cov(rp, rm) / Var(rm)                     (over aligned daily pairs)
 * Vol   = stdev(rp) · √252                          (annualized)
 * Sharpe= mean(rp − rf_daily) / stdev(rp − rf_daily) · √252   (annualized)
 * Alpha = (Rp − rf_m) − β·(Rm − rf_m)               (realized monthly Jensen's α)
 *
 * where Rp / Rm are the month's total portfolio / benchmark returns and rf_m is
 * the risk-free accrued over the month's trading days. A metric is null when it
 * can't be computed honestly (too few observations, zero variance, missing
 * benchmark or risk-free input) rather than reported as a misleading 0.
 */

const TRADING_DAYS = 252;

export interface DailyReturn {
  date: string; // YYYY-MM-DD (Eastern)
  ret: number; // decimal: 0.012 = +1.2%
}

export interface RiskMetrics {
  /** Portfolio sensitivity to the benchmark (slope of rp on rm). */
  beta: number | null;
  /** Realized monthly Jensen's alpha, in percent (portfolio − CAPM-expected). */
  alpha: number | null;
  /** Annualized Sharpe ratio of the month's daily returns. */
  sharpe: number | null;
  /** Annualized standard deviation of daily portfolio returns, in percent. */
  volatility: number | null;
  /** Benchmark total return for the month, in percent. */
  benchmarkReturn: number | null;
  /** Annualized risk-free rate used (short-tenor Treasury par yield), percent. */
  riskFreeRate: number | null;
  /** Aligned daily-return pairs the beta/sharpe estimates rest on. */
  observations: number;
  benchmarkSymbol: string;
}

/** Daily returns from a series of daily closes: (cₜ − cₜ₋₁)/cₜ₋₁. Closes must be
 *  date-sorted ascending; the first close seeds the base and yields no return. */
export function dailyReturnsFromCloses(
  closes: { date: string; close: number }[],
): DailyReturn[] {
  const out: DailyReturn[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1].close;
    const cur = closes[i].close;
    if (prev > 0 && Number.isFinite(prev) && Number.isFinite(cur)) {
      out.push({ date: closes[i].date, ret: cur / prev - 1 });
    }
  }
  return out;
}

/** Day-over-day returns from the unit-method cumulative-% series. cumByDate is
 *  in date order; each day's return chain-links off the prior day:
 *  (1 + cumₜ/100) / (1 + cumₜ₋₁/100) − 1. The first date has no prior and is
 *  skipped. */
export function dailyReturnsFromCum(cumByDate: Map<string, number>): DailyReturn[] {
  const out: DailyReturn[] = [];
  let prev: number | null = null;
  for (const [date, cumPct] of cumByDate) {
    const cum = cumPct / 100;
    if (prev != null && 1 + prev !== 0) {
      out.push({ date, ret: (1 + cum) / (1 + prev) - 1 });
    }
    prev = cum;
  }
  return out;
}

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Sample standard deviation (n−1). Returns 0 for fewer than two points. */
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

export function computeRiskMetrics(params: {
  portfolioDaily: DailyReturn[];
  benchmarkDaily: DailyReturn[];
  /** Portfolio total return for the month, percent (the reported monthly return). */
  monthReturnPct: number | null;
  /** Benchmark total return for the month, percent. */
  benchmarkReturnPct: number | null;
  /** Annualized risk-free rate, percent (e.g. 5.1 for 5.1%). */
  riskFreeAnnualPct: number | null;
  benchmarkSymbol: string;
}): RiskMetrics {
  const {
    portfolioDaily,
    benchmarkDaily,
    monthReturnPct,
    benchmarkReturnPct,
    riskFreeAnnualPct,
    benchmarkSymbol,
  } = params;

  const base: RiskMetrics = {
    beta: null,
    alpha: null,
    sharpe: null,
    volatility: null,
    benchmarkReturn: benchmarkReturnPct != null ? round(benchmarkReturnPct, 2) : null,
    riskFreeRate: riskFreeAnnualPct != null ? round(riskFreeAnnualPct, 2) : null,
    observations: 0,
    benchmarkSymbol,
  };

  // Align portfolio and benchmark returns on shared dates.
  const bench = new Map(benchmarkDaily.map((d) => [d.date, d.ret]));
  const rp: number[] = [];
  const rm: number[] = [];
  for (const d of portfolioDaily) {
    const m = bench.get(d.date);
    if (m != null) {
      rp.push(d.ret);
      rm.push(m);
    }
  }
  base.observations = rp.length;
  if (rp.length < 2) return base;

  // Volatility (annualized %).
  const sp = stdev(rp);
  base.volatility = round(sp * Math.sqrt(TRADING_DAYS) * 100, 2);

  // Beta = Cov(rp, rm) / Var(rm). The (n−1) factors cancel, so sum products.
  const mp = mean(rp);
  const mm = mean(rm);
  let cov = 0;
  let varM = 0;
  for (let i = 0; i < rp.length; i++) {
    cov += (rp[i] - mp) * (rm[i] - mm);
    varM += (rm[i] - mm) * (rm[i] - mm);
  }
  if (varM > 0) base.beta = round(cov / varM, 3);

  // Sharpe (annualized) off daily excess returns.
  if (riskFreeAnnualPct != null) {
    const rfDaily = riskFreeAnnualPct / 100 / TRADING_DAYS;
    const excess = rp.map((r) => r - rfDaily);
    const se = stdev(excess);
    if (se > 0) {
      base.sharpe = round((mean(excess) / se) * Math.sqrt(TRADING_DAYS), 2);
    }
  }

  // Realized monthly Jensen's alpha. rf accrued over the month's trading days.
  if (
    base.beta != null &&
    monthReturnPct != null &&
    benchmarkReturnPct != null &&
    riskFreeAnnualPct != null
  ) {
    const rfMonth = (riskFreeAnnualPct / 100) * (rp.length / TRADING_DAYS);
    const rpM = monthReturnPct / 100;
    const rmM = benchmarkReturnPct / 100;
    const alpha = rpM - rfMonth - base.beta * (rmM - rfMonth);
    base.alpha = round(alpha * 100, 2);
  }

  return base;
}
