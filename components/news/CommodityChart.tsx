"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

interface CommodityData {
  id: string;
  name: string;
  symbol: string;
  unit: string;
  currentPrice: number;
  changePct: number;
  data: Array<{ date: string; price: number }>;
}

interface Catalyst {
  date: string;  // ISO date "YYYY-MM-DD"
  label: string;
}

const TF_OPTIONS = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y"] as const;
type Timeframe = (typeof TF_OPTIONS)[number];

const INTRADAY: Timeframe[] = ["1D", "5D"];
// Catalyst markers only make sense on the daily, ≤1y windows
const CATALYST_FRAMES: Timeframe[] = ["1M", "6M", "YTD", "1Y"];

// Thematic line color pinned to each commodity (by id), each evoking its material
const COMMODITY_COLORS: Record<string, string> = {
  gold:    "oklch(0.80 0.14 85)",   // gold
  silver:  "oklch(0.80 0.01 250)",  // silver-gray
  oil:     "oklch(0.62 0.10 215)",  // crude (deep teal)
  copper:  "oklch(0.67 0.14 45)",   // copper-orange
  uranium: "oklch(0.82 0.18 140)",  // uranium (glow green)
};
const FALLBACK_COLOR = "oklch(0.66 0.09 240)"; // steel blue, for any unmapped id
const colorFor = (id: string) => COMMODITY_COLORS[id] ?? FALLBACK_COLOR;

/* ─── Curated catalyst events per commodity ─── */
const CATALYSTS: Record<string, Catalyst[]> = {
  GLD: [
    { date: "2025-07-30", label: "Fed hold" },
    { date: "2025-09-18", label: "Fed −25bp" },
    { date: "2025-11-07", label: "Fed −25bp" },
    { date: "2025-12-18", label: "Fed hold" },
    { date: "2026-01-29", label: "Fed hold" },
    { date: "2026-03-19", label: "Fed hold" },
    { date: "2026-04-02", label: "Tariffs" },
    { date: "2026-05-07", label: "Fed hold" },
  ],
  SLV: [
    { date: "2025-09-18", label: "Fed −25bp" },
    { date: "2025-11-07", label: "Fed −25bp" },
    { date: "2026-01-20", label: "Inauguration" },
    { date: "2026-04-02", label: "Tariffs" },
  ],
  USO: [
    { date: "2025-08-01", label: "OPEC+ cut" },
    { date: "2025-11-14", label: "OPEC+ extend" },
    { date: "2026-02-04", label: "Tariff exec orders" },
    { date: "2026-04-03", label: "OPEC+ surge" },
  ],
  CPER: [
    { date: "2025-09-24", label: "China stimulus" },
    { date: "2026-01-20", label: "Inauguration" },
    { date: "2026-04-02", label: "Tariffs" },
    { date: "2026-05-12", label: "US-China truce" },
  ],
};

/* ─── Timeframe-aware date helpers ─── */
function parseDate(val: string, tf: Timeframe): Date {
  // Intraday values are full ISO timestamps; daily values are "YYYY-MM-DD"
  return new Date(INTRADAY.includes(tf) ? val : val + "T00:00:00");
}

function tickBucket(val: string, tf: Timeframe): string {
  const d = parseDate(val, tf);
  if (tf === "1D") return String(d.getHours());
  if (tf === "5D") return d.toDateString();
  if (tf === "5Y") return String(d.getFullYear());
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function formatTick(val: string, tf: Timeframe): string {
  const d = parseDate(val, tf);
  if (tf === "1D") return d.toLocaleTimeString("en-US", { hour: "numeric" });
  if (tf === "5D") return d.toLocaleDateString("en-US", { weekday: "short" });
  if (tf === "5Y") return String(d.getFullYear());
  const mon = d.toLocaleDateString("en-US", { month: "short" });
  return `${mon} '${String(d.getFullYear()).slice(-2)}`;
}

function formatTooltipDate(val: string, tf: Timeframe): string {
  const d = parseDate(val, tf);
  if (INTRADAY.includes(tf)) {
    return d.toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function CommodityChart() {
  const [commodities, setCommodities] = useState<CommodityData[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
  const [addOpen, setAddOpen] = useState(false);
  const [tfOpen, setTfOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);
  const tfRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/commodities?range=${timeframe}`)
      .then((r) => r.json())
      .then((d) => {
        const list: CommodityData[] = d.commodities ?? [];
        setCommodities(list);
        // Keep the current selection across timeframe changes; seed it on first load
        setActive((prev) => {
          if (prev.length) return prev;
          const first = list.find((c) => c.data.length > 0);
          return first ? [first.id] : [];
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [timeframe]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false);
      if (tfRef.current && !tfRef.current.contains(e.target as Node)) setTfOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const addCommodity    = (id: string) => setActive((p) => [...p, id]);
  const removeCommodity = (id: string) => setActive((p) => p.filter((x) => x !== id));

  const activeCommodities = commodities.filter((c) => active.includes(c.id));
  const available         = commodities.filter((c) => !active.includes(c.id) && c.data.length > 0);

  // Normalize each series to % change from its first point
  const chartData = useMemo(() => {
    const base = activeCommodities.find((c) => c.data.length > 0);
    if (!base) return [];
    return base.data.map((point, i) => {
      const row: Record<string, string | number> = { date: point.date };
      for (const c of activeCommodities) {
        const startPrice = c.data[0]?.price ?? 1;
        const p = c.data[i]?.price;
        if (p != null) row[c.id] = parseFloat((((p - startPrice) / startPrice) * 100).toFixed(2));
      }
      return row;
    });
  }, [activeCommodities]);

  // Axis ticks: first point of each time bucket (hour / day / month / year by timeframe)
  const axisTicks = useMemo(() => {
    if (chartData.length === 0) return [];
    const seen = new Set<string>();
    const ticks: string[] = [];
    for (const row of chartData) {
      const date = row.date as string;
      const bucket = tickBucket(date, timeframe);
      if (!seen.has(bucket)) {
        seen.add(bucket);
        ticks.push(date);
      }
    }
    return ticks;
  }, [chartData, timeframe]);

  // Catalyst dates in range of actual data (primary commodity) — daily windows only
  const catalysts = useMemo(() => {
    if (!CATALYST_FRAMES.includes(timeframe)) return [];
    const primary = activeCommodities.find((c) => c.data.length > 0);
    if (!primary) return [];
    const dates = new Set(primary.data.map((d) => d.date));
    const allDates = primary.data.map((d) => d.date).sort();
    const minDate = allDates[0] ?? "";
    const maxDate = allDates[allDates.length - 1] ?? "";

    const events = CATALYSTS[primary.symbol] ?? [];
    return events
      .filter((c) => c.date >= minDate && c.date <= maxDate)
      .map((c) => {
        if (dates.has(c.date)) return c;
        // Snap to nearest available trading day
        const nearest = allDates.reduce((a, b) =>
          Math.abs(new Date(b).getTime() - new Date(c.date).getTime()) <
          Math.abs(new Date(a).getTime() - new Date(c.date).getTime())
            ? b
            : a
        );
        return { ...c, date: nearest };
      });
  }, [activeCommodities, timeframe]);

  return (
    <section className="border-t border-border px-6 py-4 shrink-0" style={{ height: 300 }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h2 className="text-lg font-medium text-foreground leading-none">Commodities</h2>

        {/* Timeframe selector */}
        <div className="relative" ref={tfRef}>
          <button
            onClick={() => setTfOpen((o) => !o)}
            className="flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-sm border border-border text-foreground hover:border-foreground/30 transition-colors duration-150"
            aria-haspopup="listbox"
            aria-expanded={tfOpen}
          >
            {timeframe}
            <span className="text-muted-foreground" style={{ fontSize: "0.6rem" }}>▾</span>
          </button>
          {tfOpen && (
            <div
              className="absolute left-0 top-full mt-1 rounded-sm border border-border overflow-hidden"
              style={{ background: "oklch(0.14 0 0)", zIndex: 50, minWidth: 84 }}
              role="listbox"
            >
              {TF_OPTIONS.map((tf) => (
                <button
                  key={tf}
                  className="w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-accent transition-colors duration-150"
                  style={{ color: tf === timeframe ? "var(--primary)" : "oklch(0.64 0.008 74)" }}
                  onClick={() => { setTimeframe(tf); setTfOpen(false); }}
                  role="option"
                  aria-selected={tf === timeframe}
                >
                  {tf}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex gap-2">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-6 w-16 rounded-sm animate-pulse" style={{ background: "oklch(0.16 0 0)" }} />
            ))}
          </div>
        ) : (
          <>
            {activeCommodities.map((c) => (
              <span
                key={c.id}
                className="flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-sm"
                style={{ background: "oklch(0.16 0 0)", color: colorFor(c.id) }}
              >
                {c.symbol}
                <span
                  className="opacity-60 cursor-pointer hover:opacity-100 transition-opacity"
                  onClick={() => removeCommodity(c.id)}
                  role="button"
                  aria-label={`Remove ${c.name}`}
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && removeCommodity(c.id)}
                >
                  ×
                </span>
              </span>
            ))}

            {available.length > 0 && (
              <div className="relative" ref={addRef}>
                <button
                  onClick={() => setAddOpen((o) => !o)}
                  className="text-xs px-2.5 py-1 rounded-sm border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors duration-150"
                  aria-haspopup="listbox"
                  aria-expanded={addOpen}
                >
                  + Add
                </button>
                {addOpen && (
                  <div
                    className="absolute left-0 top-full mt-1 rounded-sm border border-border overflow-hidden"
                    style={{ background: "oklch(0.14 0 0)", zIndex: 50, minWidth: 160 }}
                    role="listbox"
                  >
                    {available.map((c) => (
                      <button
                        key={c.id}
                        className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-150"
                        onClick={() => { addCommodity(c.id); setAddOpen(false); }}
                        role="option"
                        aria-selected={false}
                      >
                        {c.name}
                        <span className="text-xs text-muted-foreground ml-1.5">{c.unit}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="ml-auto flex items-center gap-4">
              {activeCommodities.map((c) => (
                <span key={c.id} className="text-xs font-mono flex items-center gap-1.5">
                  <span style={{ color: colorFor(c.id) }}>{c.symbol}</span>
                  <span className="text-foreground">
                    {c.currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                  <span style={{ color: c.changePct >= 0 ? "var(--positive)" : "var(--negative)" }}>
                    {c.changePct >= 0 ? "+" : ""}{c.changePct.toFixed(2)}%
                  </span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Chart */}
      <div style={{ height: 186 }}>
        {loading ? (
          <div className="w-full h-full rounded-sm animate-pulse" style={{ background: "oklch(0.11 0 0)" }} />
        ) : active.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">Add a commodity to view its chart.</p>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">No data for this timeframe.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="date"
                ticks={axisTicks}
                tickFormatter={(val) => formatTick(val, timeframe)}
                tick={{ fontSize: 10, fill: "oklch(0.52 0.008 74)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
                tick={{ fontSize: 10, fill: "oklch(0.52 0.008 74)" }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip
                content={<CustomTooltip commodities={activeCommodities} timeframe={timeframe} />}
                cursor={{ stroke: "oklch(0.28 0 0)", strokeWidth: 1 }}
              />

              {/* Zero line */}
              <ReferenceLine y={0} stroke="oklch(0.22 0 0)" strokeWidth={1} />

              {/* Catalyst events */}
              {catalysts.map((cat) => (
                <ReferenceLine
                  key={cat.date + cat.label}
                  x={cat.date}
                  stroke="oklch(0.30 0 0)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  label={<CatalystLabel value={cat.label} />}
                />
              ))}

              {activeCommodities.map((c) => (
                <Line
                  key={c.id}
                  type="monotone"
                  dataKey={c.id}
                  stroke={colorFor(c.id)}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3, fill: colorFor(c.id) }}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

/* ─── Custom tooltip ─── */
function CustomTooltip({
  active, payload, label, commodities, timeframe,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number }>;
  label?: string;
  commodities: CommodityData[];
  timeframe: Timeframe;
}) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-sm border border-border px-3 py-2 text-xs font-mono" style={{ background: "oklch(0.14 0 0)" }}>
      <p className="text-muted-foreground mb-1.5">{formatTooltipDate(label, timeframe)}</p>
      {payload.map((p) => {
        const c = commodities.find((x) => x.id === p.dataKey);
        if (!c) return null;
        return (
          <p key={p.dataKey} style={{ color: colorFor(c.id) }}>
            {c.symbol}: {p.value > 0 ? "+" : ""}{p.value.toFixed(2)}%
          </p>
        );
      })}
    </div>
  );
}

/* ─── Catalyst label rendered as SVG text ─── */
function CatalystLabel({ value, viewBox }: { value: string; viewBox?: { x?: number; y?: number } }) {
  const x = (viewBox?.x ?? 0) + 3;
  const y = (viewBox?.y ?? 0) + 14;
  return (
    <text x={x} y={y} fontSize={9} fill="oklch(0.44 0 0)" style={{ userSelect: "none" }}>
      {value}
    </text>
  );
}
