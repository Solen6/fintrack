# scratchpad

Throwaway verification scripts, kept because they document *how* the analytics
math was checked. Not wired into CI — each is run by hand and prints
`ALL PASS` / `N FAILURE(S)`.

They are not part of the app build: nothing under `app/` or `lib/` imports them.

## Running

```bash
node_modules/.bin/jiti scratchpad/<file>.ts
```

Scripts that import via the `@/` alias (rather than a relative path) need jiti
told about it, since jiti doesn't read `tsconfig.json` paths:

```bash
JITI_ALIAS='{"@/":"'"$PWD"'/"}' node_modules/.bin/jiti scratchpad/frontier-cron-test.ts
```

Some hit live Yahoo Finance and need network; they use no credentials.

## What's here

| script | checks |
| --- | --- |
| `analytics-test.ts` | core stats/risk helpers in `lib/analytics` |
| `basket-pipeline-test.ts` | the `/api/analysis/basket` alignment pipeline |
| `frontier-bench.ts` | long-only frontier cost + invariants at 5–60 assets |
| `frontier-converge.ts` | the n-scaled iteration budget vs a 40k-iteration reference |
| `mc-weighting-test.ts` | weight-load planner; that weights really move the Monte Carlo |
| `sector-bench-test.ts` | sector benchmark mapping |
| `spy-point-test.ts` | the S&P 500 frontier point, live, incl. total-vs-price return |
| `spy-sharpe-windows.ts` | SPY return/vol/Sharpe across 1/2/3/5-year windows |
| `frontier-cron-test.ts` | yearly snapshot capture: who's due, weights, degradation |
