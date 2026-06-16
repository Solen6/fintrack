"use client";

import { useId, useState } from "react";
import type { PayoffPoint } from "@/lib/options-math";

const fmtUsd = (n: number) =>
  (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

export function PayoffChart({
  points,
  spot,
  breakevens,
}: {
  points: PayoffPoint[];
  spot: number;
  breakevens: number[];
}) {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const W = 560, H = 300, padL = 8, padR = 8, padT = 18, padB = 28;

  const prices = points.map((p) => p.price);
  const pls = points.map((p) => p.pl);
  const xMin = 0;
  const xMax = Math.max(...prices);
  const plMax = Math.max(...pls, 0);
  const plMin = Math.min(...pls, 0);
  const plPad = (plMax - plMin) * 0.08 || 1;

  const x = (price: number) => padL + ((price - xMin) / (xMax - xMin)) * (W - padL - padR);
  const y = (pl: number) =>
    padT + (1 - (pl - (plMin - plPad)) / (plMax + plPad - (plMin - plPad))) * (H - padT - padB);

  const zeroY = y(0);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.price).toFixed(1)} ${y(p.pl).toFixed(1)}`).join(" ");
  // Area from the curve down to the zero baseline; clipped halves color profit vs loss.
  const area = `${line} L ${x(points[points.length - 1].price).toFixed(1)} ${zeroY.toFixed(1)} L ${x(points[0].price).toFixed(1)} ${zeroY.toFixed(1)} Z`;

  const hovered = hover != null ? points[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ display: "block" }}>
        <defs>
          <clipPath id={`${clipId}-profit`}>
            <rect x={0} y={0} width={W} height={zeroY} />
          </clipPath>
          <clipPath id={`${clipId}-loss`}>
            <rect x={0} y={zeroY} width={W} height={H - zeroY} />
          </clipPath>
        </defs>

        {/* Profit / loss fills */}
        <path d={area} fill="var(--positive)" opacity={0.16} clipPath={`url(#${clipId}-profit)`} />
        <path d={area} fill="var(--negative)" opacity={0.16} clipPath={`url(#${clipId}-loss)`} />

        {/* Zero baseline */}
        <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="oklch(0.5 0.01 74)" strokeWidth={1} strokeDasharray="2 3" />

        {/* P/L curve, colored by sign via clipped overlays */}
        <path d={line} fill="none" stroke="var(--positive)" strokeWidth={2} clipPath={`url(#${clipId}-profit)`} />
        <path d={line} fill="none" stroke="var(--negative)" strokeWidth={2} clipPath={`url(#${clipId}-loss)`} />

        {/* Current spot */}
        <line x1={x(spot)} x2={x(spot)} y1={padT} y2={H - padB} stroke="oklch(0.62 0.008 74)" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
        <text x={x(spot)} y={H - padB + 18} textAnchor="middle" fontSize={10} fill="oklch(0.64 0.008 74)" fontFamily="var(--font-geist-mono), monospace">
          {spot.toFixed(0)}
        </text>

        {/* Breakevens (amber — the one place amber is earned here) */}
        {breakevens.map((be, i) => (
          <g key={i}>
            <line x1={x(be)} x2={x(be)} y1={padT} y2={H - padB} stroke="var(--primary)" strokeWidth={1} strokeDasharray="2 2" opacity={0.65} />
            <circle cx={x(be)} cy={zeroY} r={3} fill="var(--primary)" />
          </g>
        ))}

        {/* Hover marker */}
        {hovered && (
          <>
            <line x1={x(hovered.price)} x2={x(hovered.price)} y1={padT} y2={H - padB} stroke="oklch(0.8 0.005 74)" strokeWidth={1} opacity={0.35} />
            <circle cx={x(hovered.price)} cy={y(hovered.pl)} r={3.5} fill={hovered.pl >= 0 ? "var(--positive)" : "var(--negative)"} />
          </>
        )}

        {/* Hover capture */}
        <rect
          x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} fill="transparent"
          onMouseMove={(e) => {
            const rect = (e.target as SVGRectElement).getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * (W - padL - padR) + padL;
            const price = xMin + ((px - padL) / (W - padL - padR)) * (xMax - xMin);
            const idx = Math.round((price / xMax) * (points.length - 1));
            setHover(Math.max(0, Math.min(points.length - 1, idx)));
          }}
          onMouseLeave={() => setHover(null)}
        />
      </svg>

      {/* Hover readout */}
      <div className="h-5 mt-1 text-xs font-mono text-center" style={{ minHeight: 20 }}>
        {hovered ? (
          <span className="text-muted-foreground">
            @ <span className="text-foreground">${hovered.price.toFixed(2)}</span>
            <span className="mx-1 opacity-50">·</span>
            {((hovered.price - spot) / spot * 100 >= 0 ? "+" : "")}
            {((hovered.price - spot) / spot * 100).toFixed(1)}%
            <span className="mx-1 opacity-50">·</span>
            <span style={{ color: hovered.pl >= 0 ? "var(--positive)" : "var(--negative)" }}>
              {hovered.pl >= 0 ? "+" : ""}{fmtUsd(hovered.pl)}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground opacity-50">Hover the curve for P/L at any price</span>
        )}
      </div>
    </div>
  );
}
