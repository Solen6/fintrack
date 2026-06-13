import { NextResponse } from "next/server";

// ─── Cache ────────────────────────────────────────────────────────────────────
const cache = new Map<string, { data: unknown; ts: number }>();

function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.data as T);
  return fn()
    .then((data) => { cache.set(key, { data, ts: Date.now() }); return data; })
    .catch(() => null);
}

const TTL_QUOTES  = 60_000;        // 1 min — indices / movers
const TTL_EARN    = 30 * 60_000;   // 30 min — earnings calendar

const UA = "Mozilla/5.0 (compatible; fintrack/1.0)";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface IndexQuote {
  symbol: string;
  name: string;
  value: number;
  change: number;
  changePct: number;
}

export interface Mover {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  volume?: string;
}

export interface EarningsRow {
  ticker: string;
  name: string;
  date: string;
  when: "BMO" | "AMC" | "—";
  epsEst: number | null;
  epsActual?: number;
}

export interface MarketResponse {
  indices: IndexQuote[];
  gainers: Mover[];
  losers: Mover[];
  mostActive: Mover[];
  upcomingEarnings: EarningsRow[];
  recentEarnings: EarningsRow[];
  updatedAt: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Yahoo v8 chart — returns current price + prev close for an arbitrary symbol */
async function yahooChart(symbol: string): Promise<{ price: number; prevClose: number; name: string } | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d&includePrePost=false`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    next: { revalidate: 60 },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) return null;
  return {
    price:     meta.regularMarketPrice as number,
    prevClose: (meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice) as number,
    name:      (meta.longName ?? meta.shortName ?? symbol) as string,
  };
}

const INDEX_SYMBOLS: { symbol: string; label: string }[] = [
  { symbol: "^GSPC",    label: "S&P 500"      },
  { symbol: "^IXIC",    label: "Nasdaq Comp." },
  { symbol: "^DJI",     label: "Dow Jones"    },
  { symbol: "^RUT",     label: "Russell 2000" },
  { symbol: "^VIX",     label: "VIX"          },
];

async function fetchIndices(): Promise<IndexQuote[]> {
  const results = await Promise.all(
    INDEX_SYMBOLS.map(({ symbol, label }) =>
      yahooChart(symbol).then((q) => {
        if (!q) return null;
        const change    = q.price - q.prevClose;
        const changePct = q.prevClose > 0 ? (change / q.prevClose) * 100 : 0;
        return { symbol, name: label, value: q.price, change, changePct } satisfies IndexQuote;
      })
    )
  );
  return results.filter((r): r is IndexQuote => r !== null);
}

/** Yahoo predefined screener — scrIds: day_gainers | day_losers | most_actives */
async function fetchMovers(scrId: string, count = 8): Promise<Mover[]> {
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${scrId}&count=${count}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    next: { revalidate: 60 },
  });
  if (!res.ok) return [];
  const json = await res.json();
  const quotes: Record<string, unknown>[] = json?.finance?.result?.[0]?.quotes ?? [];
  return quotes.map((q) => {
    const rawVol = q.regularMarketVolume as number | undefined;
    const volume = rawVol != null ? fmtVol(rawVol) : undefined;
    return {
      ticker:    String(q.symbol ?? ""),
      name:      String(q.shortName ?? q.longName ?? ""),
      price:     Number(q.regularMarketPrice ?? 0),
      change:    Number(q.regularMarketChange ?? 0),
      changePct: Number(q.regularMarketChangePercent ?? 0),
      ...(volume ? { volume } : {}),
    } satisfies Mover;
  });
}

function fmtVol(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(0) + "M";
  if (n >= 1_000)         return (n / 1_000).toFixed(0) + "K";
  return String(n);
}

/** Finnhub earnings calendar — upcoming window from today through +14 days */
async function fetchEarningsCalendar(): Promise<{ upcoming: EarningsRow[]; recent: EarningsRow[] }> {
  const key   = process.env.FINNHUB_API_KEY;
  if (!key) return { upcoming: [], recent: [] };

  const now   = new Date();
  const past  = new Date(now); past.setDate(now.getDate() - 7);
  const future = new Date(now); future.setDate(now.getDate() + 14);

  const fmt   = (d: Date) => d.toISOString().slice(0, 10);
  const url   = `https://finnhub.io/api/v1/calendar/earnings?from=${fmt(past)}&to=${fmt(future)}&token=${key}`;
  const res   = await fetch(url, { next: { revalidate: 1800 } });
  if (!res.ok) return { upcoming: [], recent: [] };

  const json  = await res.json();
  type FinnEntry = {
    symbol: string; name?: string; date: string;
    hour?: string; epsEstimate?: number | null; epsActual?: number | null;
  };
  const entries: FinnEntry[] = json?.earningsCalendar ?? [];

  const todayStr = fmt(now);
  const upcoming: EarningsRow[] = [];
  const recent:   EarningsRow[] = [];

  for (const e of entries) {
    if (!e.symbol || !e.date) continue;
    const when: "BMO" | "AMC" | "—" =
      e.hour === "bmo" ? "BMO" : e.hour === "amc" ? "AMC" : "—";

    // Format date "Jun 13"
    const d = new Date(e.date + "T12:00:00Z");
    const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

    const row: EarningsRow = {
      ticker:   e.symbol,
      name:     e.name ?? e.symbol,
      date:     label,
      when,
      epsEst:   e.epsEstimate ?? null,
      ...(e.epsActual != null ? { epsActual: e.epsActual } : {}),
    };

    if (e.date >= todayStr) upcoming.push(row);
    else                    recent.push(row);
  }

  // Upcoming: sort ascending, take first 8; Recent: sort descending, take first 8
  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  recent.sort((a, b) => b.date.localeCompare(a.date));

  // Filter recent to only entries that have actually reported (have epsActual)
  return {
    upcoming: upcoming.slice(0, 8),
    recent:   recent.filter((r) => r.epsActual !== undefined).slice(0, 8),
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────
export async function GET() {
  const [indices, gainers, losers, mostActive, earnings] = await Promise.all([
    cached("market:indices",     TTL_QUOTES, fetchIndices),
    cached("market:gainers",     TTL_QUOTES, () => fetchMovers("day_gainers")),
    cached("market:losers",      TTL_QUOTES, () => fetchMovers("day_losers")),
    cached("market:most_active", TTL_QUOTES, () => fetchMovers("most_actives")),
    cached("market:earnings",    TTL_EARN,   fetchEarningsCalendar),
  ]);

  const response: MarketResponse = {
    indices:         indices        ?? [],
    gainers:         gainers        ?? [],
    losers:          losers         ?? [],
    mostActive:      mostActive     ?? [],
    upcomingEarnings: earnings?.upcoming ?? [],
    recentEarnings:  earnings?.recent   ?? [],
    updatedAt:       Date.now(),
  };

  return NextResponse.json(response);
}
