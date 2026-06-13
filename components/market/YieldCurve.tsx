"use client";

import { useEffect, useState } from "react";
import type { YieldCurveData, CurvePoint } from "@/app/api/yieldcurve/route";

const AMBER = "oklch(0.72 0.14 74)";

export function YieldCurve() {
  const [data, setData] = useState<YieldCurveData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/yieldcurve")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d && !d.error ? d : null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="rounded-sm border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Treasury Yield Curve
        </h2>
        {data && (
          <span className="text-xs text-muted-foreground">
            {new Date(`${data.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        )}
      </div>

      {loading ? (
        <div className="skeleton rounded-sm" style={{ height: 150 }} />
      ) : !data || data.points.length < 2 ? (
        <p className="text-xs text-muted-foreground py-2">Yield curve unavailable.</p>
      ) : (
        <CurveBody data={data} />
      )}
    </section>
  );
}

function CurveBody({ data }: { data: YieldCurveData }) {
  const pts = data.points;
  const inverted = data.spread2s10s < 0;
  const spreadColor = inverted ? "var(--negative)" : "var(--positive)";

  // ── SVG geometry ──
  const W = 300, H = 140, padX = 10, padTop = 12, padBot = 24;
  const yields = pts.map((p) => p.yield);
  const yMin = Math.min(...yields);
  const yMax = Math.max(...yields);
  const range = yMax - yMin || 1;

  const x = (i: number) => padX + (i / (pts.length - 1)) * (W - padX * 2);
  const y = (v: number) => padTop + (1 - (v - yMin) / range) * (H - padTop - padBot);

  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.yield).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${x(pts.length - 1).toFixed(1)} ${H - padBot} L ${x(0).toFixed(1)} ${H - padBot} Z`;

  // label a readable subset on the x-axis
  const labelSet = new Set(["3M", "2Y", "10Y", "30Y"]);

  const find = (label: string) => pts.find((p) => p.label === label);
  const key2Y = find("2Y");
  const key10Y = find("10Y");
  const key30Y = find("30Y");

  return (
    <div className="flex flex-col gap-3">
      {/* curve */}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 140 }} role="img" aria-label="Treasury yield curve">
        <defs>
          <linearGradient id="ycFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={AMBER} stopOpacity={0.22} />
            <stop offset="100%" stopColor={AMBER} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#ycFill)" />
        <path d={linePath} fill="none" stroke={AMBER} strokeWidth={1.75} strokeLinejoin="round" />
        {pts.map((p, i) => (
          <g key={p.label}>
            <circle cx={x(i)} cy={y(p.yield)} r={2} fill={AMBER} />
            {labelSet.has(p.label) && (
              <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={9} fill="oklch(0.52 0.008 74)">
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>

      {/* key points */}
      <div className="grid grid-cols-3 gap-2">
        <KeyPoint point={key2Y} />
        <KeyPoint point={key10Y} />
        <KeyPoint point={key30Y} />
      </div>

      {/* 2s10s spread */}
      <div className="flex items-center justify-between border-t border-border/60 pt-2.5">
        <span className="text-xs text-muted-foreground">2s10s spread</span>
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-mono" style={{ color: spreadColor }}>
            {data.spread2s10s > 0 ? "+" : ""}{data.spread2s10s.toFixed(2)}%
          </span>
          <span className="text-xs font-medium" style={{ color: spreadColor }}>
            {inverted ? "Inverted" : "Normal"}
          </span>
        </div>
      </div>
    </div>
  );
}

function KeyPoint({ point }: { point: CurvePoint | undefined }) {
  if (!point) return <div />;
  const pos = point.change > 0;
  const neg = point.change < 0;
  const changeColor = pos ? "var(--positive)" : neg ? "var(--negative)" : "oklch(0.52 0.008 74)";
  const bp = Math.round(point.change * 100);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground leading-none">{point.label}</span>
      <span className="font-mono text-sm text-foreground leading-none">{point.yield.toFixed(2)}%</span>
      <span className="font-mono leading-none" style={{ fontSize: "0.65rem", color: changeColor }}>
        {point.change === 0 ? "—" : `${bp > 0 ? "+" : ""}${bp}bp`}
      </span>
    </div>
  );
}
