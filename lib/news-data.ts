/* Fixed reference date — keeps all derived data deterministic server + client */
const EPOCH = new Date("2025-06-04T00:00:00Z");

export interface NewsItem {
  id: string;
  ticker: string | null; // null = macro/general
  headline: string;
  source: string;
  summary: string;
  timestamp: Date;
  url?: string;
}

export interface MacroRate {
  label: string;
  value: string;
  change: number; // basis points or percent
  unit: string;
}

export interface CommodityPoint {
  date: string; // ISO date
  price: number;
}

export interface Catalyst {
  date: string; // ISO date
  label: string;
}

export interface Commodity {
  id: string;
  ticker: string;
  name: string;
  unit: string;
  currentPrice: number;
  change: number; // percent
  data: CommodityPoint[];
  catalysts: Catalyst[];
}

/* ─── Mock news ─── */
const minsAgo = (m: number) => new Date(EPOCH.getTime() - m * 60_000);

export const NEWS_ITEMS: NewsItem[] = [
  {
    id: "n1",
    ticker: "NVDA",
    headline: "NVIDIA unveils next-generation Blackwell Ultra chips ahead of schedule",
    source: "Reuters",
    summary:
      "NVIDIA accelerated its roadmap with the Blackwell Ultra GPU line, projecting a 40% performance uplift over current Blackwell silicon. Data center customers are expected to receive first shipments in Q3.",
    timestamp: minsAgo(18),
  },
  {
    id: "n2",
    ticker: "AAPL",
    headline: "Apple begins mass production of iPhone 17 ahead of September launch",
    source: "Bloomberg",
    summary:
      "Foxconn facilities in Zhengzhou have ramped to full production on the iPhone 17 lineup. Analysts expect record-setting opening weekend sales driven by the new camera system and AI features.",
    timestamp: minsAgo(45),
  },
  {
    id: "n3",
    ticker: "MSFT",
    headline: "Microsoft Azure revenue growth reaccelerates to 33% in latest quarter",
    source: "CNBC",
    summary:
      "Azure's AI-driven growth lifted Microsoft's cloud segment above consensus estimates. Management guided for continued acceleration as Copilot integrations expand across enterprise customers.",
    timestamp: minsAgo(90),
  },
  {
    id: "n4",
    ticker: "JPM",
    headline: "JPMorgan raises dividend by 9% as capital ratios exceed regulatory minimums",
    source: "WSJ",
    summary:
      "The bank announced a quarterly dividend increase to $1.40 per share alongside an expanded $30B buyback program, citing strong consumer and investment banking performance.",
    timestamp: minsAgo(140),
  },
  {
    id: "n5",
    ticker: "META",
    headline: "Meta's Llama 4 challenges leading frontier models on key benchmarks",
    source: "The Verge",
    summary:
      "Meta released Llama 4 Scout and Maverick, with Maverick matching GPT-4o on MMLU and HumanEval. The open-weight release is expected to accelerate adoption in enterprise AI workflows.",
    timestamp: minsAgo(195),
  },
  {
    id: "n6",
    ticker: "COP",
    headline: "ConocoPhillips cuts capex guidance as crude settles below $75",
    source: "Reuters",
    summary:
      "ConocoPhillips trimmed its 2026 capital budget by $400M in response to sustained crude price weakness, but maintained production targets by optimizing Permian Basin operations.",
    timestamp: minsAgo(260),
  },
  {
    id: "n7",
    ticker: "TLT",
    headline: "Treasury yields fall as jobs data shows cooling labor market",
    source: "Bloomberg",
    summary:
      "The 10-year yield slipped 8bps after nonfarm payrolls came in below expectations for the second consecutive month, reviving rate-cut speculation for the September FOMC meeting.",
    timestamp: minsAgo(310),
  },
  {
    id: "n8",
    ticker: "BRK.B",
    headline: "Berkshire Hathaway cash pile hits record $189B as Buffett stays patient",
    source: "FT",
    summary:
      "Despite elevated equity valuations, Berkshire added to its T-bill position rather than deploying capital into equities. Analysts debate whether this signals a near-term market correction view.",
    timestamp: minsAgo(420),
  },
  {
    id: "n9",
    ticker: "VOO",
    headline: "S&P 500 closes at record high on tech rally and cooling inflation data",
    source: "MarketWatch",
    summary:
      "The index gained 1.2% for the week, driven by semiconductor and mega-cap technology names. PCE inflation printed at 2.1%, just above the Fed's 2% target.",
    timestamp: minsAgo(500),
  },
  {
    id: "n10",
    ticker: "GOOGL",
    headline: "Alphabet's Waymo expands robotaxi operations to 10 new US cities",
    source: "Bloomberg",
    summary:
      "Waymo will launch commercial operations in Atlanta, Denver, and eight additional metro areas by year-end, marking the fastest geographic expansion in the company's history.",
    timestamp: minsAgo(600),
  },
  {
    id: "n11",
    ticker: "AVUV",
    headline: "Small-cap value outperforms growth for third consecutive month",
    source: "Morningstar",
    summary:
      "The Russell 2000 Value index gained 2.8% in May, outpacing large-cap growth by 1.4 percentage points. Factor analysts attribute the rotation to rising inflation expectations and improving credit conditions.",
    timestamp: minsAgo(720),
  },
  {
    id: "n12",
    ticker: "VTI",
    headline: "Vanguard reports record $180B in net ETF inflows for the year",
    source: "ETF.com",
    summary:
      "Index fund flows continue to accelerate as retail investors increase exposure to broad market vehicles. VTI and VXUS together captured 22% of total US ETF inflows.",
    timestamp: minsAgo(900),
  },
];

/* ─── Macro rates ─── */
export const MACRO_RATES: MacroRate[] = [
  { label: "Fed Funds",    value: "5.33%",  change: 0,    unit: "target" },
  { label: "10Y Treasury", value: "4.61%",  change: -8,   unit: "bps" },
  { label: "2Y Treasury",  value: "4.88%",  change: -5,   unit: "bps" },
  { label: "2s10s Spread", value: "-0.27%", change: -3,   unit: "bps" },
  { label: "CPI (YoY)",    value: "3.4%",   change: -10,  unit: "bps" },
  { label: "PCE (YoY)",    value: "2.7%",   change: -5,   unit: "bps" },
];

/* ─── Seeded PRNG (mulberry32) — deterministic ─── */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ─── Commodity chart data (365 days) ─── */
function generateDailyPrices(
  base: number,
  volatility: number,
  trend: number,
  seed: number,
  days = 365
): CommodityPoint[] {
  const rand = mulberry32(seed);
  const points: CommodityPoint[] = [];
  let price = base;
  const startDate = new Date(EPOCH);
  startDate.setUTCDate(startDate.getUTCDate() - days);

  for (let i = 0; i <= days; i++) {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + i);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;

    price = price * (1 + trend / 252 + (rand() - 0.48) * volatility);
    points.push({
      date: d.toISOString().split("T")[0],
      price: Math.round(price * 100) / 100,
    });
  }
  return points;
}

/* Seeded generation — deterministic enough for mock */
const copperData = generateDailyPrices(3.8, 0.018, 0.04, 1001, 365);
const goldData    = generateDailyPrices(1980, 0.012, 0.12, 2002, 365);
const wtiData     = generateDailyPrices(78, 0.022, -0.06, 3003, 365);
const silverData  = generateDailyPrices(22, 0.020, 0.08, 4004, 365);

function daysBack(n: number): string {
  const d = new Date(EPOCH);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split("T")[0];
}

export const COMMODITIES: Commodity[] = [
  {
    id: "copper",
    ticker: "HG",
    name: "Copper",
    unit: "$/lb",
    currentPrice: 4.18,
    change: -0.8,
    data: copperData,
    catalysts: [
      { date: daysBack(320), label: "China stimulus" },
      { date: daysBack(245), label: "Chile strike" },
      { date: daysBack(180), label: "Fed pivot signal" },
      { date: daysBack(90),  label: "EV demand surge" },
      { date: daysBack(22),  label: "Inventory build" },
    ],
  },
  {
    id: "gold",
    ticker: "GC",
    name: "Gold",
    unit: "$/oz",
    currentPrice: 2387,
    change: 0.6,
    data: goldData,
    catalysts: [
      { date: daysBack(290), label: "Central bank buying" },
      { date: daysBack(200), label: "Banking stress" },
      { date: daysBack(120), label: "Rate cut bets rise" },
      { date: daysBack(40),  label: "Middle East tensions" },
    ],
  },
  {
    id: "wti",
    ticker: "CL",
    name: "WTI Crude",
    unit: "$/bbl",
    currentPrice: 74.2,
    change: -1.4,
    data: wtiData,
    catalysts: [
      { date: daysBack(310), label: "OPEC+ cut" },
      { date: daysBack(220), label: "Demand revision" },
      { date: daysBack(140), label: "SPR release" },
      { date: daysBack(55),  label: "Supply glut concerns" },
    ],
  },
  {
    id: "silver",
    ticker: "SI",
    name: "Silver",
    unit: "$/oz",
    currentPrice: 28.4,
    change: 1.1,
    data: silverData,
    catalysts: [
      { date: daysBack(280), label: "Solar demand" },
      { date: daysBack(160), label: "Gold/silver ratio" },
      { date: daysBack(60),  label: "Industrial rebound" },
    ],
  },
];
