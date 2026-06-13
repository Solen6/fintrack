import { NextResponse } from "next/server";

/**
 * US Treasury daily par yield curve — the official source (no API key).
 * Returns the latest curve, each point's day-over-day change, and the 2s10s
 * spread (10Y − 2Y), the classic recession signal. Cached 3h (updates ~once
 * per business day, mid-afternoon ET).
 */

export interface CurvePoint {
  label: string;
  months: number;
  yield: number;
  change: number; // vs prior business day, in percentage points
}

export interface YieldCurveData {
  date: string;
  points: CurvePoint[];
  spread2s10s: number;
  spread2s10sPrev: number;
  updatedAt: string;
}

// BC_ tag → display label + maturity in months
const MATURITIES: Array<{ tag: string; label: string; months: number }> = [
  { tag: "BC_3MONTH", label: "3M",  months: 3 },
  { tag: "BC_6MONTH", label: "6M",  months: 6 },
  { tag: "BC_1YEAR",  label: "1Y",  months: 12 },
  { tag: "BC_2YEAR",  label: "2Y",  months: 24 },
  { tag: "BC_3YEAR",  label: "3Y",  months: 36 },
  { tag: "BC_5YEAR",  label: "5Y",  months: 60 },
  { tag: "BC_7YEAR",  label: "7Y",  months: 84 },
  { tag: "BC_10YEAR", label: "10Y", months: 120 },
  { tag: "BC_20YEAR", label: "20Y", months: 240 },
  { tag: "BC_30YEAR", label: "30Y", months: 360 },
];

let cache: { data: YieldCurveData; ts: number } | null = null;
const TTL = 3 * 60 * 60_000;

type Entry = { date: string; values: Record<string, number> };

function parseEntries(xml: string): Entry[] {
  const out: Entry[] = [];
  const blocks = xml.match(/<m:properties>([\s\S]*?)<\/m:properties>/g) ?? [];
  for (const block of blocks) {
    const dateM = block.match(/<d:NEW_DATE[^>]*>([^<]+)</);
    if (!dateM) continue;
    const values: Record<string, number> = {};
    for (const { tag } of MATURITIES) {
      const m = block.match(new RegExp(`<d:${tag}[^>]*>([^<]*)<`));
      const v = m ? parseFloat(m[1]) : NaN;
      if (!isNaN(v)) values[tag] = v;
    }
    out.push({ date: dateM[1].slice(0, 10), values });
  }
  return out;
}

async function fetchMonth(yyyymm: string): Promise<Entry[]> {
  const res = await fetch(
    `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${yyyymm}`,
    { next: { revalidate: 10800 } }
  );
  if (!res.ok) throw new Error(`Treasury ${res.status}`);
  return parseEntries(await res.text());
}

export async function GET() {
  if (cache && Date.now() - cache.ts < TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    let entries = await fetchMonth(ym);

    // Near the start of a month we may have <2 days; pull prior month for the baseline
    if (entries.length < 2) {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const pym = `${prev.getFullYear()}${String(prev.getMonth() + 1).padStart(2, "0")}`;
      const prevEntries = await fetchMonth(pym).catch(() => []);
      entries = [...prevEntries, ...entries];
    }
    if (entries.length === 0) throw new Error("No curve data");

    const latest = entries[entries.length - 1];
    const prev = entries[entries.length - 2] ?? latest;

    const points: CurvePoint[] = MATURITIES.filter((m) => m.tag in latest.values).map((m) => ({
      label: m.label,
      months: m.months,
      yield: latest.values[m.tag],
      change: parseFloat(((latest.values[m.tag] ?? 0) - (prev.values[m.tag] ?? latest.values[m.tag])).toFixed(2)),
    }));

    const spread = (e: Entry) =>
      e.values.BC_10YEAR != null && e.values.BC_2YEAR != null
        ? parseFloat((e.values.BC_10YEAR - e.values.BC_2YEAR).toFixed(2))
        : 0;

    const data: YieldCurveData = {
      date: latest.date,
      points,
      spread2s10s: spread(latest),
      spread2s10sPrev: spread(prev),
      updatedAt: new Date().toISOString(),
    };

    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `Yield curve unavailable: ${msg}` }, { status: 502 });
  }
}
