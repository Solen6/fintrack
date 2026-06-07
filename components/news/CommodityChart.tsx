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

const LINE_COLORS = [
  "oklch(0.72 0.14 74)",  // amber
  "oklch(0.64 0.07 240)", // steel blue
  "oklch(0.64 0.16 28)",  // warm red
  "oklch(0.78 0.10 140)", // muted green
];

export function CommodityChart() {
  const [commodities, setCommodities] = useState<CommodityData[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  // Fetch real commodity data
  useEffect(() => {
    fetch("/api/commodities")
      .then((r) => r.json())
      .then((d) => {
        const list: CommodityData[] = d.commodities ?? [];
        setCommodities(list);
        // Default: first commodity with data
        const first = list.find((c) => c.data.length > 0);
        if (first) setActive([first.id]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setAddOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const addCommodity = (id: string) => {
    if (!active.includes(id)) setActive((prev) => [...prev, id]);
  };
  const removeCommodity = (id: string) => {
    setActive((prev) => prev.filter((x) => x !== id));
  };

  const activeCommodities = commodities.filter((c) => active.includes(c.id));
  const available = commodities.filter((c) => !active.includes(c.id) && c.data.length > 0);

  // Normalize all active commodities to % change from day 0, merged by date index
  const chartData = useMemo(() => {
    if (activeCommodities.length === 0) return [];
    const base = activeCommodities[0];
    return base.data.map((point, i) => {
      const row: Record<string, string | number> = { date: point.date };
      for (const c of activeCommodities) {
        const startPrice = c.data[0]?.price ?? 1;
        const p = c.data[i]?.price;
        if (p != null) {
          row[c.id] = parseFloat((((p - startPrice) / startPrice) * 100).toFixed(2));
        }
      }
      return row;
    });
  }, [activeCommodities]);

  const xTickFormatter = (val: string) => {
    const d = new Date(val + "T00:00:00");
    return d.getDate() <= 7
      ? d.toLocaleDateString("en-US", { month: "short" })
      : "";
  };

  return (
    <section className="border-t border-border px-6 py-4 shrink-0" style={{ height: 280 }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <p className="text-xs font-medium text-muted-foreground mr-2">
          Commodities · 365d % change
        </p>

        {loading ? (
          <div className="flex gap-2">
            {[...Array(2)].map((_, i) => (
              <div
                key={i}
                className="h-6 w-16 rounded-sm animate-pulse"
                style={{ background: "oklch(0.16 0 0)" }}
              />
            ))}
          </div>
        ) : (
          <>
            {/* Active chips */}
            {activeCommodities.map((c, i) => (
              <span
                key={c.id}
                className="flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-sm"
                style={{ background: "oklch(0.16 0 0)", color: LINE_COLORS[i] }}
              >
                {c.symbol}
                <span
                  className="text-xs opacity-60 cursor-pointer hover:opacity-100 transition-opacity"
                  onClick={() => removeCommodity(c.id)}
                  role="button"
                  aria-label={`Remove ${c.name}`}
                  tabIndex={0}
                  onKeyDown={(e) =>
                    (e.key === "Enter" || e.key === " ") && removeCommodity(c.id)
                  }
                >
                  ×
                </span>
              </span>
            ))}

            {/* Add dropdown */}
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

            {/* Current prices */}
            <div className="ml-auto flex items-center gap-4">
              {activeCommodities.map((c, i) => (
                <span key={c.id} className="text-xs font-mono flex items-center gap-1.5">
                  <span style={{ color: LINE_COLORS[i] }}>{c.symbol}</span>
                  <span className="text-foreground">
                    {c.currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                  </span>
                  <span
                    style={{
                      color: c.changePct >= 0 ? "oklch(0.72 0.14 74)" : "oklch(0.64 0.16 28)",
                    }}
                  >
                    {c.changePct >= 0 ? "+" : ""}
                    {c.changePct.toFixed(2)}%
                  </span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Chart area */}
      <div style={{ height: 186 }}>
        {loading ? (
          <div
            className="w-full h-full rounded-sm animate-pulse"
            style={{ background: "oklch(0.11 0 0)" }}
          />
        ) : active.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">Add a commodity to view its chart.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
            >
              <XAxis
                dataKey="date"
                tickFormatter={xTickFormatter}
                tick={{ fontSize: 10, fill: "oklch(0.52 0.008 74)" }}
                axisLine={false}
                tickLine={false}
                interval={19}
              />
              <YAxis
                tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
                tick={{ fontSize: 10, fill: "oklch(0.52 0.008 74)" }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip
                content={
                  <CustomTooltip commodities={activeCommodities} colors={LINE_COLORS} />
                }
                cursor={{ stroke: "oklch(0.28 0 0)", strokeWidth: 1 }}
              />
              <ReferenceLine y={0} stroke="oklch(0.22 0 0)" strokeWidth={1} />
              {activeCommodities.map((c, i) => (
                <Line
                  key={c.id}
                  type="monotone"
                  dataKey={c.id}
                  stroke={LINE_COLORS[i]}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3, fill: LINE_COLORS[i] }}
                  isAnimationActive={false}
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
  active,
  payload,
  label,
  commodities,
  colors,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number }>;
  label?: string;
  commodities: CommodityData[];
  colors: string[];
}) {
  if (!active || !payload?.length || !label) return null;
  const date = new Date(label + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  return (
    <div
      className="rounded-sm border border-border px-3 py-2 text-xs font-mono"
      style={{ background: "oklch(0.14 0 0)" }}
    >
      <p className="text-muted-foreground mb-1.5">{date}</p>
      {payload.map((p) => {
        const c = commodities.find((x) => x.id === p.dataKey);
        if (!c) return null;
        const i = commodities.indexOf(c);
        return (
          <p key={p.dataKey} style={{ color: colors[i] }}>
            {c.symbol}: {p.value > 0 ? "+" : ""}{p.value.toFixed(2)}%
          </p>
        );
      })}
    </div>
  );
}
