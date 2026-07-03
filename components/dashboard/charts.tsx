"use client";

import { useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency, formatCurrencyCompact, formatPercent } from "@/lib/format";
import { usePrivacy, MONEY_MASK } from "@/lib/privacy";

const AMBER = "oklch(0.72 0.14 74)";
const POSITIVE = "oklch(0.72 0.15 152)";
const NEGATIVE = "oklch(0.66 0.19 25)";
const AXIS = "oklch(0.52 0.008 74)";
const GRID = "oklch(0.20 0 0)";
const MUTED = "oklch(0.64 0.008 74)";

const tooltipStyle = {
  background: "oklch(0.14 0 0)",
  border: "1px solid oklch(0.24 0 0)",
  borderRadius: 4,
  fontSize: 12,
  color: "oklch(0.94 0.005 74)",
} as const;

export type PerfMetric = "value" | "return";

/* A performance-chart point carries every figure the tooltip surfaces, but only
   `metric` (value $ or return %) is plotted depending on the selected mode. */
export interface PerfPoint {
  label: string;        // x-axis label (short date)
  date: string;         // full date, for the tooltip header
  metric: number;       // the plotted figure (account value, or % return)
  total: number;        // total account value on this day
  securities: number;   // market value of holdings
  cash: number;         // core + sweep cash
  gain: number;         // cumulative $ gain since window start (contrib-adjusted)
  returnPct: number;    // cumulative % return since window start
}

export interface ReturnPoint {
  label: string;
  pct: number;
}

export interface AllocationPoint {
  label: string;
  value: number;
  color: string;
}

/* ─── Performance over time — interactive (Value $ or Return %) ───
   The amber line is the brand "single lamp"; gain/loss color is earned only in
   the tooltip figures. A baseline reference line marks the window start. */
export function PerformanceChart({ data, metric }: { data: PerfPoint[]; metric: PerfMetric }) {
  const { hidden } = usePrivacy();
  const isReturn = metric === "return";
  // Return % isn't sensitive; the Value $ axis is a portfolio balance → masked.
  const fmtY = (v: number) =>
    isReturn ? `${v.toFixed(0)}%` : hidden ? MONEY_MASK : formatCurrencyCompact(v);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="perfFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={AMBER} stopOpacity={0.32} />
            <stop offset="100%" stopColor={AMBER} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="label"
          tick={{ fill: AXIS, fontSize: 11 }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          tick={{ fill: AXIS, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={isReturn ? 40 : 52}
          tickFormatter={(v) => fmtY(v as number)}
          domain={["auto", "auto"]}
        />
        {isReturn && <ReferenceLine y={0} stroke={GRID} strokeWidth={1} />}
        <Tooltip
          cursor={{ stroke: AXIS, strokeWidth: 1, strokeDasharray: "3 3" }}
          content={<PerfTooltip />}
        />
        <Area
          type="monotone"
          dataKey="metric"
          stroke={AMBER}
          strokeWidth={2}
          fill="url(#perfFill)"
          isAnimationActive={false}
          dot={false}
          activeDot={{ r: 3, fill: AMBER, stroke: "none" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* Rich crosshair tooltip — value, gain, return %, and the securities/cash split
   for the hovered day. */
function PerfTooltip({ active, payload }: {
  active?: boolean;
  payload?: { payload: PerfPoint }[];
}) {
  const { hidden } = usePrivacy();
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  const gainColor = p.gain >= 0 ? POSITIVE : NEGATIVE;
  const money = (n: number, sign = false) =>
    hidden ? MONEY_MASK : `${sign && n >= 0 ? "+" : ""}${formatCurrency(n)}`;
  return (
    <div style={{ ...tooltipStyle, padding: "8px 10px", minWidth: 168 }}>
      <div style={{ color: MUTED, fontSize: 11, marginBottom: 6 }}>{p.date}</div>
      <Row label="Value" value={money(p.total)} mono />
      <Row label="Gain" value={money(p.gain, true)} color={gainColor} mono />
      <Row label="Return" value={formatPercent(p.returnPct)} color={gainColor} mono />
      <div style={{ height: 1, background: "oklch(0.24 0 0)", margin: "6px 0" }} />
      <Row label="Holdings" value={money(p.securities)} muted mono />
      <Row label="Cash" value={money(p.cash)} muted mono />
    </div>
  );
}

function Row({ label, value, color, muted, mono }: {
  label: string; value: string; color?: string; muted?: boolean; mono?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, lineHeight: 1.7 }}>
      <span style={{ color: muted ? MUTED : "oklch(0.78 0.005 74)" }}>{label}</span>
      <span style={{ color: color ?? (muted ? MUTED : "oklch(0.94 0.005 74)"), fontFamily: mono ? "var(--font-geist-mono), monospace" : undefined }}>
        {value}
      </span>
    </div>
  );
}

/* ─── Asset allocation donut ─── */
export function AllocationDonut({ data }: { data: AllocationPoint[] }) {
  const { hidden } = usePrivacy();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius="62%"
          outerRadius="92%"
          paddingAngle={2}
          stroke="none"
          isAnimationActive={false}
        >
          {data.map((slice) => (
            <Cell key={slice.label} fill={slice.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v, n) => [hidden ? MONEY_MASK : formatCurrencyCompact(v as number), n as string]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

/* ─── Periodic returns bars (monthly or yearly) ───
   Compact version for the card. No hover labels. Always includes 0 on Y axis. */
export function ReturnsBarChart({ data }: { data: ReturnPoint[] }) {
  const minVal = Math.min(0, ...data.map((d) => d.pct));
  const maxVal = Math.max(0, ...data.map((d) => d.pct));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <XAxis
          dataKey="label"
          tick={{ fill: AXIS, fontSize: 11 }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: AXIS, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={36}
          tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
          domain={[minVal, maxVal]}
        />
        <ReferenceLine y={0} stroke={GRID} strokeWidth={1} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v) => [formatPercent(v as number), "Return"]}
          cursor={{ fill: "oklch(0.16 0 0)" }}
        />
        <Bar dataKey="pct" radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {data.map((m) => (
            <Cell key={m.label} fill={m.pct >= 0 ? POSITIVE : NEGATIVE} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ─── Expanded returns bars — click shows % on opposite side of bar ─── */
export function ReturnsBarChartExpanded({ data }: { data: ReturnPoint[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const minVal = Math.min(0, ...data.map((d) => d.pct));
  const maxVal = Math.max(0, ...data.map((d) => d.pct));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 24, right: 12, bottom: 24, left: 12 }}>
        <XAxis
          dataKey="label"
          tick={{ fill: AXIS, fontSize: 12 }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: AXIS, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={44}
          tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
          domain={[minVal, maxVal]}
        />
        <ReferenceLine y={0} stroke={GRID} strokeWidth={1} />
        <Bar
          dataKey="pct"
          radius={[2, 2, 0, 0]}
          isAnimationActive={false}
          cursor="pointer"
          onClick={(_, index) => setSelected((s) => (s === index ? null : index))}
          label={(props) => {
            const x = Number(props.x ?? 0);
            const y = Number(props.y ?? 0);
            const w = Number(props.width ?? 0);
            const h = Number(props.height ?? 0);
            const value = Number(props.value ?? 0);
            const index = Number(props.index ?? -1);
            if (selected == null || selected !== index) return <text key={index} />;
            const isPositive = value >= 0;
            const labelY = isPositive ? y + h + 16 : y - 8;
            return (
              <text
                key={index}
                x={x + w / 2}
                y={labelY}
                textAnchor="middle"
                fontSize={13}
                fontWeight={600}
                fill={isPositive ? POSITIVE : NEGATIVE}
              >
                {formatPercent(value)}
              </text>
            );
          }}
        >
          {data.map((m, i) => (
            <Cell
              key={m.label}
              fill={m.pct >= 0 ? POSITIVE : NEGATIVE}
              fillOpacity={selected === null || selected === i ? 1 : 0.35}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
