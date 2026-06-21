"use client";

import { useMemo, useState } from "react";
import { payoffAtTime, type Leg } from "@/lib/options-math";

/**
 * OptionStrat-style P/L matrix: underlying price on the Y axis, calendar date
 * (today → expiry) on the X axis, each cell colored by the position's
 * mark-to-market P/L there (Black-Scholes valued, so time decay is visible).
 */
export function PnlHeatmap({
  legs,
  spot,
  expiry,
  onExpand,
}: {
  legs: Leg[];
  spot: number;
  /** Latest leg expiry, unix seconds. */
  expiry: number;
  /** Click-to-expand into the full matrix modal. */
  onExpand?: () => void;
}) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);

  const grid = useMemo(() => {
    const nowSec = Date.now() / 1000;
    const end = Math.max(expiry, nowSec + 86400);

    // Price band: cover all strikes + spot with padding, centered enough to read.
    const strikes = legs.filter((l) => l.type !== "stock").map((l) => l.strike);
    const lo = Math.max(0.01, Math.min(spot, ...strikes) * 0.82);
    const hi = Math.max(spot, ...strikes) * 1.18;

    const ROWS = 27;
    const days = Math.max(1, Math.ceil((end - nowSec) / 86400));
    const COLS = Math.min(days + 1, 46);

    const prices = Array.from({ length: ROWS }, (_, i) => hi - ((hi - lo) * i) / (ROWS - 1)); // top = high
    const times = Array.from({ length: COLS }, (_, j) => nowSec + ((end - nowSec) * j) / (COLS - 1));
    const dates = times.map((t) => new Date(t * 1000));

    let maxAbs = 0;
    const cells = prices.map((p) =>
      times.map((t) => {
        const pl = payoffAtTime(legs, p, t);
        if (Math.abs(pl) > maxAbs) maxAbs = Math.abs(pl);
        return pl;
      })
    );
    return { prices, times, dates, cells, maxAbs: maxAbs || 1, lo, hi, COLS, ROWS, nowSec, end };
  }, [legs, spot, expiry]);

  const { prices, dates, cells, maxAbs, COLS, ROWS } = grid;

  // Geometry.
  const W = 580, H = 320, padL = 46, padR = 12, padT = 10, padB = 30;
  const gw = W - padL - padR, gh = H - padT - padB;
  const cw = gw / COLS, ch = gh / ROWS;

  const color = (pl: number) => {
    const t = Math.pow(Math.min(Math.abs(pl) / maxAbs, 1), 0.7);
    const alpha = 0.1 + t * 0.8;
    return { fill: pl >= 0 ? "var(--positive)" : "var(--negative)", opacity: alpha };
  };

  // Spot row position (for a reference line).
  const spotY = padT + ((grid.hi - spot) / (grid.hi - grid.lo)) * gh;

  // A few axis ticks.
  const priceTicks = [0, Math.floor(ROWS / 4), Math.floor(ROWS / 2), Math.floor((3 * ROWS) / 4), ROWS - 1];
  const dateTicks = [0, Math.floor((COLS - 1) / 2), COLS - 1];

  const hovered = hover ? { pl: cells[hover.r][hover.c], price: prices[hover.r], date: dates[hover.c] } : null;
  const fmtUsd = (n: number) => (n < 0 ? "-" : "+") + "$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div className="relative" onClick={onExpand} style={{ cursor: onExpand ? "zoom-in" : "default" }}>
      {onExpand && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onExpand(); }}
          aria-label="Expand P/L matrix"
          title="Expand"
          className="absolute right-1 top-1 z-10 grid h-6 w-6 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ display: "block" }}>
        {/* Cells */}
        {cells.map((row, r) =>
          row.map((pl, c) => {
            const { fill, opacity } = color(pl);
            const isHover = hover?.r === r && hover?.c === c;
            return (
              <rect
                key={`${r}-${c}`}
                x={padL + c * cw}
                y={padT + r * ch}
                width={cw + 0.5}
                height={ch + 0.5}
                fill={fill}
                opacity={opacity}
                stroke={isHover ? "var(--foreground)" : "none"}
                strokeWidth={isHover ? 1 : 0}
                onMouseEnter={() => setHover({ r, c })}
              />
            );
          })
        )}

        {/* Spot reference line */}
        {spotY > padT && spotY < H - padB && (
          <>
            <line x1={padL} x2={W - padR} y1={spotY} y2={spotY} stroke="oklch(0.85 0.005 74)" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
            <text x={padL - 4} y={spotY + 3} textAnchor="end" fontSize={9} fill="oklch(0.7 0.008 74)" fontFamily="var(--font-geist-mono), monospace">
              {spot.toFixed(0)}
            </text>
          </>
        )}

        {/* Price axis ticks */}
        {priceTicks.map((r) => (
          <text key={`p${r}`} x={padL - 4} y={padT + r * ch + ch / 2 + 3} textAnchor="end" fontSize={9} fill="oklch(0.6 0.008 74)" fontFamily="var(--font-geist-mono), monospace">
            {prices[r].toFixed(0)}
          </text>
        ))}

        {/* Date axis ticks */}
        {dateTicks.map((c) => (
          <text key={`d${c}`} x={padL + c * cw + cw / 2} y={H - padB + 14} textAnchor={c === 0 ? "start" : c === COLS - 1 ? "end" : "middle"} fontSize={9} fill="oklch(0.6 0.008 74)" fontFamily="var(--font-geist-mono), monospace">
            {c === 0 ? "Today" : c === COLS - 1 ? "Expiry" : fmtDate(dates[c])}
          </text>
        ))}

        {/* Hover capture (transparent grid) */}
        <rect
          x={padL} y={padT} width={gw} height={gh} fill="transparent"
          onMouseMove={(e) => {
            const rect = (e.target as SVGRectElement).getBoundingClientRect();
            const c = Math.floor(((e.clientX - rect.left) / rect.width) * COLS);
            const r = Math.floor(((e.clientY - rect.top) / rect.height) * ROWS);
            if (r >= 0 && r < ROWS && c >= 0 && c < COLS) setHover({ r, c });
          }}
          onMouseLeave={() => setHover(null)}
        />
      </svg>

      {/* Readout + legend */}
      <div className="mt-1 flex items-center justify-between text-xs font-mono" style={{ minHeight: 20 }}>
        <span>
          {hovered ? (
            <span className="text-muted-foreground">
              {fmtDate(hovered.date)} @ <span className="text-foreground">${hovered.price.toFixed(2)}</span>
              <span className="mx-1 opacity-50">·</span>
              <span style={{ color: hovered.pl >= 0 ? "var(--positive)" : "var(--negative)" }}>{fmtUsd(hovered.pl)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground opacity-50">Hover a cell for P/L on that date &amp; price</span>
          )}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{fmtUsd(-maxAbs)}</span>
          <span style={{ width: 60, height: 8, borderRadius: 2, background: "linear-gradient(90deg, var(--negative), transparent 50%, var(--positive))" }} />
          <span>{fmtUsd(maxAbs)}</span>
        </span>
      </div>
    </div>
  );
}
