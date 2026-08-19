"use client";

/**
 * Shared extended-hours (pre/post market) display bits.
 *
 * Fed by the optional `ext*` fields that lib/finnhub.ts fills in from Yahoo's
 * `includePrePost` bars and /api/quotes passes through untouched. Everything
 * here is purely additive: when a quote carries no extended session — a mutual
 * fund, crypto, or simply the middle of the regular day — these render `null`,
 * so a surface can drop them in without changing how it looks during market
 * hours.
 *
 * ⚠️ These read `extPrice`/`extChangePct` ONLY. The regular-session
 * `price`/`changePct` a row already shows must keep coming from the quote
 * itself — after-hours never substitutes for the official close (see the
 * snapshot-cron warning in lib/finnhub.ts).
 */

import { extSessionLabel, hasExtHours, type ExtHoursQuote } from "@/lib/ext-hours";

/** Short form for the badge itself; the long form lives in extSessionLabel. */
const badgeLabel = (q: ExtHoursQuote) => (q.extSession === "pre" ? "Pre" : "AH");

const POS = "oklch(0.72 0.15 152)";       // matches pctTone's emerald
const NEG = "var(--negative)";

const timeET = (t: number) =>
  new Date(t * 1000).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });

/** `withPrice` mirrors the pill's own `showPrice`: the holdings table wraps
 *  every price in <Sensitive> for Private mode, so a tooltip that spelled the
 *  after-hours price out anyway would quietly defeat the masking. */
function tooltip(q: ExtHoursQuote, withPrice: boolean): string {
  const name = extSessionLabel(q.extSession);
  const pct = q.extChangePct !== undefined
    ? `${q.extChangePct >= 0 ? "+" : ""}${q.extChangePct.toFixed(2)}%`
    : "—";
  const when = q.extTime ? `${timeET(q.extTime)} ET` : "—";
  const stale = q.marketState === "closed" ? " · session closed" : "";
  if (!withPrice) return `${name} ${pct} vs the regular-session close, as of ${when}${stale}`;
  const px = q.extPrice !== undefined ? q.extPrice.toFixed(2) : "—";
  const chg = q.extChange !== undefined ? `${q.extChange >= 0 ? "+" : ""}${q.extChange.toFixed(2)}` : "—";
  return `${name} ${px} (${chg}) as of ${when}${stale} — vs the regular-session close`;
}

/** Compact "AH +0.42%" pill. Renders nothing when there is no extended move. */
export function ExtHoursPill({
  quote,
  showPrice = false,
}: {
  quote: ExtHoursQuote | null | undefined;
  showPrice?: boolean;
}) {
  if (!hasExtHours(quote)) return null;
  const q = quote as ExtHoursQuote;
  const pct = q.extChangePct as number;
  const tone = pct >= 0 ? POS : NEG;

  return (
    <span
      title={tooltip(q, showPrice)}
      className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[10px] leading-none tabular-nums"
      style={{ color: tone, backgroundColor: `color-mix(in oklch, ${tone} 14%, transparent)` }}
    >
      <span className="opacity-70">{badgeLabel(q)}</span>
      {showPrice && q.extPrice !== undefined && <span>{q.extPrice.toFixed(2)}</span>}
      <span>{`${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`}</span>
    </span>
  );
}

/** Inline SVG sparkline of the extended session, with the regular close drawn
 *  as a dashed baseline so the move reads against it at a glance.
 *
 *  Deliberately hand-rolled rather than Recharts (which every other chart here
 *  uses): those are `nextDynamic` imports, and one per holdings row would mean
 *  dozens of lazily-loaded chart instances in a single table. */
export function ExtHoursSparkline({
  series,
  baseline,
  width = 54,
  height = 16,
}: {
  series: number[] | undefined;
  baseline: number | undefined;
  width?: number;
  height?: number;
}) {
  if (!series || series.length < 2 || !baseline || !(baseline > 0)) return null;

  /* The y-domain is the 5th–95th percentile of the session, NOT its min/max.
     Extended-hours bars are thin and carry the occasional bad print — one
     observed MSFT session dipped to 455 against a 481.63 close while every
     other bar sat at 481.3–481.5, and a min/max domain let that single bar
     flatten the entire line into a spike. Percentiles trim a lone outlier
     while still tracking a real earnings gap, which moves the whole
     distribution rather than one bar. Out-of-domain points are clamped to the
     edge, so nothing is dropped — the direction still reads. */
  const sorted = [...series].sort((a, b) => a - b);
  const pct = (f: number) => sorted[Math.round(f * (sorted.length - 1))];
  let lo = Math.min(pct(0.05), baseline);
  let hi = Math.max(pct(0.95), baseline);

  /* Floor the span, or a near-flat name gets amplified into noise: SGOV moved
     0.0099% across a whole session and auto-scaling drew it as violent chop. */
  const minHalfSpan = baseline * 0.0015;
  if (hi - baseline < minHalfSpan) hi = baseline + minHalfSpan;
  if (baseline - lo < minHalfSpan) lo = baseline - minHalfSpan;

  const span = hi - lo || 1;
  const clamp = (v: number) => (v < lo ? lo : v > hi ? hi : v);
  const px = (i: number) => (i / (series.length - 1)) * (width - 1) + 0.5;
  const py = (v: number) => height - 1 - ((clamp(v) - lo) / span) * (height - 2);

  const points = series.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const tone = series[series.length - 1] >= baseline ? POS : NEG;
  const baseY = py(baseline).toFixed(1);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <line
        x1={0}
        y1={baseY}
        x2={width}
        y2={baseY}
        stroke="var(--muted-foreground)"
        strokeWidth={0.5}
        strokeDasharray="2 2"
        opacity={0.55}
      />
      <polyline
        points={points}
        fill="none"
        stroke={tone}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
