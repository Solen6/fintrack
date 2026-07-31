/* Unit-method seed resolution — `resolveSeedCapital` in lib/portfolio-return.ts.

   Regression cover for the bug where opening a funded account tanked Overall
   Return: the new account's capital was added to the SEED (minting units at $10
   from the start of the whole series) while its funding deposit was ALSO an
   external flow, so the same dollars were counted twice.

   Every case runs the real `unitCumReturns` loop, not just the resolver, so
   what's asserted is the number the hero actually renders.

   Run:  JITI_ALIAS='{"@/":"'"$PWD"'/"}' node_modules/.bin/jiti scratchpad/seed-resolution-test.ts
*/
import {
  resolveSeedCapital,
  applyLateFlows,
  inceptionDateFor,
  unitCumReturns,
  type ReturnSnapshot,
  type ReturnFlow,
} from "@/lib/portfolio-return";

let failures = 0;
function check(label: string, got: number, want: number, tol = 0.01) {
  const ok = Number.isFinite(got) && Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: got ${got.toFixed(2)}, want ${want.toFixed(2)}`);
}

/** Build a NAV series + run the real loop, exactly as DashboardClient does. */
function hero(opts: {
  accounts: string[];
  snapshots: ReturnSnapshot[];
  flows: ReturnFlow[];
  storedSeeds?: Record<string, number>;
  liveCapital?: Record<string, number>;
  liveNav: number;
  today: string;
}) {
  const enabled = new Set(opts.accounts);
  const byDate = new Map<string, number>();
  for (const s of opts.snapshots) {
    if (s.account == null || !enabled.has(s.account)) continue;
    byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.value + (s.cash ?? 0));
  }
  byDate.set(opts.today, opts.liveNav);
  const nav = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, n]) => ({ date, nav: n }));

  const flowByDate = new Map<string, number>();
  for (const f of opts.flows) {
    if (f.account != null && !enabled.has(f.account)) continue;
    flowByDate.set(f.date, (flowByDate.get(f.date) ?? 0) + f.amount);
  }

  const res = resolveSeedCapital({
    accounts: enabled,
    snapshots: opts.snapshots,
    flows: opts.flows,
    storedSeeds: new Map(Object.entries(opts.storedSeeds ?? {})),
    liveCapital: (a) => opts.liveCapital?.[a] ?? 0,
    seriesDates: nav.map((n) => n.date),
    today: opts.today,
  });
  applyLateFlows(flowByDate, res.lateFlows);
  const r = unitCumReturns(nav, flowByDate, res.seedCostBasis, inceptionDateFor(nav, nav.slice(0, -1)));
  return { ...r, seed: res.seedCostBasis, lateFlows: res.lateFlows, firstCum: [...r.cumByDate.values()][0] ?? 0 };
}

// ── Fixture: one account with history, 100k cost → 132,350 today ────────────
const OLD = "Brokerage";
const SEED = 100_000;
const NAV = 132_350;
const dates: string[] = [];
for (let i = 30; i >= 1; i--) {
  const d = new Date(Date.UTC(2026, 5, 1));
  d.setUTCDate(d.getUTCDate() + (30 - i));
  dates.push(d.toISOString().slice(0, 10));
}
const TODAY = "2026-07-01";
const history: ReturnSnapshot[] = dates.map((date, i) => ({
  date,
  value: 120_000 + (i / (dates.length - 1)) * (NAV - 120_000),
  cash: 0,
  costBasis: SEED,
  account: OLD,
}));

console.log("\n1. Baseline — single seeded account, no flows");
{
  const r = hero({ accounts: [OLD], snapshots: history, flows: [], storedSeeds: { [OLD]: SEED }, liveNav: NAV, today: TODAY });
  check("seed", r.seed, SEED);
  check("Overall Return = gain vs cost", r.totalReturnPct, ((NAV / SEED) - 1) * 100);
  check("Total Gain", r.totalGain, NAV - SEED);
}

console.log("\n2. THE BUG — add a funded account today (deposit recorded)");
{
  const NEW = "Roth";
  const DEPOSIT = 20_000;
  const r = hero({
    accounts: [OLD, NEW],
    snapshots: history,
    flows: [{ date: TODAY, account: NEW, amount: DEPOSIT }],
    storedSeeds: { [OLD]: SEED, [NEW]: DEPOSIT }, // the stale anchor ensureSeeds used to write
    liveCapital: { [NEW]: DEPOSIT },
    liveNav: NAV + DEPOSIT,
    today: TODAY,
  });
  check("new account contributes 0 to the seed", r.seed, SEED);
  check("no synthetic flow (the deposit already covers it)", r.lateFlows.length, 0);
  check("Overall Return UNCHANGED by the deposit", r.totalReturnPct, ((NAV / SEED) - 1) * 100);
  check("Total Gain UNCHANGED by the deposit", r.totalGain, NAV - SEED);
  check("history not re-scaled (chart's first point)", r.firstCum, 20.0);
}

console.log("\n3. Late account imported with NO recorded deposit (CSV import)");
{
  const NEW = "Fidelity";
  const CAPITAL = 50_000;
  // It lands with its own snapshot row dated today.
  const snaps: ReturnSnapshot[] = [
    ...history,
    { date: TODAY, value: CAPITAL, cash: 0, costBasis: CAPITAL, account: NEW },
  ];
  const r = hero({
    accounts: [OLD, NEW],
    snapshots: snaps,
    flows: [],
    storedSeeds: { [OLD]: SEED },
    liveNav: NAV + CAPITAL,
    today: TODAY,
  });
  check("seed excludes the late account", r.seed, SEED);
  check("its capital is minted as a synthetic flow", r.lateFlows[0]?.amount ?? 0, CAPITAL);
  check("Overall Return unchanged", r.totalReturnPct, ((NAV / SEED) - 1) * 100);
  check("Total Gain unchanged", r.totalGain, NAV - SEED);
}

console.log("\n4. UNCHANGED behaviour — account present at inception keeps its seed");
{
  const B = "IRA";
  const snaps: ReturnSnapshot[] = [
    ...history,
    ...dates.map((date, i) => ({
      date, value: 40_000 + i * 100, cash: 0, costBasis: 40_000, account: B,
    })),
  ];
  const r = hero({
    accounts: [OLD, B],
    snapshots: snaps,
    flows: [],
    storedSeeds: { [OLD]: SEED, [B]: 40_000 },
    liveNav: NAV + 42_900,
    today: TODAY,
  });
  check("both accounts seeded", r.seed, SEED + 40_000);
  check("no late flows", r.lateFlows.length, 0);
  check("Overall Return = combined gain vs cost", r.totalReturnPct, (((NAV + 42_900) / 140_000) - 1) * 100);
}

console.log("\n5. UNCHANGED behaviour — a plain deposit into an EXISTING account stays neutral");
{
  const mid = dates[15];
  const r = hero({
    accounts: [OLD],
    snapshots: history,
    flows: [{ date: mid, account: OLD, amount: 10_000 }],
    storedSeeds: { [OLD]: SEED },
    liveNav: NAV + 10_000,
    today: TODAY,
  });
  check("seed untouched", r.seed, SEED);
  check("Total Gain excludes the deposit", r.totalGain, NAV - SEED);
}

console.log("\n6. Brand-new user — no history at all, everything seeds from live");
{
  const r = hero({
    accounts: ["A"],
    snapshots: [],
    flows: [],
    storedSeeds: {},
    liveCapital: { A: 5_000 },
    liveNav: 5_500,
    today: TODAY,
  });
  check("seeded from live capital", r.seed, 5_000);
  check("Overall Return = gain vs cost", r.totalReturnPct, 10);
}

console.log("\n7. Guard — every account late still yields a real seed, never a flat 0%");
{
  const NEW = "Only";
  const snaps: ReturnSnapshot[] = [
    { date: "2026-06-10", value: 1_000, cash: 0, costBasis: 1_000, account: "Ghost" }, // not enabled
    { date: TODAY, value: 2_200, cash: 0, costBasis: 2_000, account: NEW },
  ];
  const r = hero({
    accounts: [NEW], snapshots: snaps, flows: [],
    storedSeeds: { [NEW]: 2_000 }, liveNav: 2_200, today: TODAY,
  });
  check("seed falls back to the earliest account", r.seed, 2_000);
  check("Overall Return", r.totalReturnPct, 10);
}

console.log("\n8. Withdrawal from a late account nets correctly against its anchor");
{
  const NEW = "Roth";
  const r = hero({
    accounts: [OLD, NEW],
    snapshots: history,
    flows: [
      { date: TODAY, account: NEW, amount: 20_000 },
      { date: TODAY, account: NEW, amount: -5_000 },
    ],
    storedSeeds: { [OLD]: SEED },
    liveCapital: { [NEW]: 15_000 }, // net capital actually present
    liveNav: NAV + 15_000,
    today: TODAY,
  });
  check("seed excludes the late account", r.seed, SEED);
  check("net flow already covers it — no synthetic", r.lateFlows.length, 0);
  check("Overall Return unchanged", r.totalReturnPct, ((NAV / SEED) - 1) * 100);
  check("Total Gain unchanged", r.totalGain, NAV - SEED);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
if (failures > 0) process.exitCode = 1;
