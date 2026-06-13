"use client";

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
  ResponsiveContainer,
} from "recharts";
import { formatCurrencyCompact, formatPercent } from "@/lib/format";

const AMBER = "oklch(0.72 0.14 74)";
const POSITIVE = "oklch(0.72 0.15 152)";
const NEGATIVE = "oklch(0.66 0.19 25)";
const AXIS = "oklch(0.52 0.008 74)";
const GRID = "oklch(0.20 0 0)";

const tooltipStyle = {
  background: "oklch(0.14 0 0)",
  border: "1px solid oklch(0.24 0 0)",
  borderRadius: 4,
  fontSize: 12,
  color: "oklch(0.94 0.005 74)",
} as const;

export interface PerfPoint {
  label: string;
  value: number;
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

/* ─── Performance over time (from real snapshots) ─── */
export function PerformanceChart({ data }: { data: PerfPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="perfFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={AMBER} stopOpacity={0.35} />
            <stop offset="100%" stopColor={AMBER} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="label"
          tick={{ fill: AXIS, fontSize: 11 }}
          axisLine={{ stroke: GRID }}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          tick={{ fill: AXIS, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={48}
          tickFormatter={(v) => formatCurrencyCompact(v as number)}
          domain={["dataMin", "dataMax"]}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v) => [formatCurrencyCompact(v as number), "Value"]}
          cursor={{ stroke: AXIS, strokeWidth: 1 }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={AMBER}
          strokeWidth={2}
          fill="url(#perfFill)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ─── Asset allocation donut ─── */
export function AllocationDonut({ data }: { data: AllocationPoint[] }) {
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
          formatter={(v, n) => [formatCurrencyCompact(v as number), n as string]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

/* ─── Periodic returns bars (monthly or yearly) ─── */
export function ReturnsBarChart({ data }: { data: ReturnPoint[] }) {
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
          tickFormatter={(v) => `${v}%`}
        />
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
