"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { payoffAtTime, RISK_FREE, type Leg } from "@/lib/options-math";

/**
 * Expanded OptionStrat-style P/L matrix. Price (Y) × calendar date (X), each
 * cell labeled with its P/L, plus a breakeven curve, an expected-move cone, an
 * earnings marker, an IV-crush slider, a price-range (zoom) slider, and a
 * $/% toggle.
 */
export function PnlMatrixModal({
  open,
  onClose,
  title,
  legs,
  spot,
  expiry,
  netCost,
  maxLoss,
  earningsDate,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  legs: Leg[];
  spot: number;
  expiry: number;          // unix seconds
  netCost: number;         // >0 debit, <0 credit
  maxLoss: number;         // negative; -Infinity = unbounded
  earningsDate: string | null; // YYYY-MM-DD
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const clipId = useId();
  const [ivScale, setIvScale] = useState(1);
  const [range, setRange] = useState(25);      // ± % price band around spot
  const [unit, setUnit] = useState<"usd" | "pct">("usd");
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  // Reset transient controls + center the range on the strategy's strikes.
  useEffect(() => {
    if (!open) return;
    setIvScale(1); setUnit("usd"); setHover(null);
    const o = legs.filter((l) => l.type !== "stock");
    const maxDist = o.length ? Math.max(...o.map((l) => Math.abs(l.strike - spot) / spot)) : 0.2;
    setRange(Math.min(80, Math.max(10, Math.ceil((maxDist * 130) / 5) * 5)));
  }, [open, legs, spot]);

  // Capital at risk for % returns.
  const denom = netCost > 0 ? netCost : Number.isFinite(maxLoss) ? Math.abs(maxLoss) : 0;
  const pctOk = denom > 0;

  // Average option IV (for the expected-move cone), scaled by the slider.
  const avgIV = useMemo(() => {
    const o = legs.filter((l) => l.type !== "stock");
    return o.length ? (o.reduce((s, l) => s + l.iv, 0) / o.length) : 0;
  }, [legs]);

  // Geometry — larger canvas + fewer/bigger cells for legibility.
  const W = 1120, H = 660, padL = 64, padR = 22, padT = 20, padB = 60;
  const gw = W - padL - padR, gh = H - padT - padB;

  const grid = useMemo(() => {
    const now = Date.now() / 1000;
    const end = Math.max(expiry, now + 86400);
    // Symmetric price band around spot, set by the range slider.
    const lo = Math.max(0.01, spot * (1 - range / 100));
    const hi = spot * (1 + range / 100);

    const ROWS = 21; // odd → the center row sits exactly on spot
    const days = Math.max(1, Math.ceil((end - now) / 86400));
    const COLS = Math.min(days, 24);

    // Block-centered sampling so overlay times align with cell centers.
    const prices = Array.from({ length: ROWS }, (_, i) => hi - ((i + 0.5) / ROWS) * (hi - lo));
    const times = Array.from({ length: COLS }, (_, j) => now + ((j + 0.5) / COLS) * (end - now));

    let maxAbs = 0;
    const cells = prices.map((p) =>
      times.map((t) => {
        const pl = payoffAtTime(legs, p, t, RISK_FREE, ivScale);
        if (Math.abs(pl) > maxAbs) maxAbs = Math.abs(pl);
        return pl;
      })
    );

    // Breakeven crossings per column (dense price scan, independent of display rows).
    const SCAN = 220;
    const beByCol = times.map((t) => {
      const xs: number[] = [];
      let prev = payoffAtTime(legs, lo, t, RISK_FREE, ivScale);
      for (let k = 1; k <= SCAN; k++) {
        const p = lo + ((hi - lo) * k) / SCAN;
        const cur = payoffAtTime(legs, p, t, RISK_FREE, ivScale);
        if ((prev < 0) !== (cur < 0) && cur !== prev) {
          const pPrev = lo + ((hi - lo) * (k - 1)) / SCAN;
          xs.push(pPrev + (-prev / (cur - prev)) * (p - pPrev));
        }
        prev = cur;
      }
      return xs.sort((a, b) => a - b);
    });

    return { now, end, lo, hi, ROWS, COLS, prices, times, cells, maxAbs: maxAbs || 1, beByCol };
  }, [legs, spot, expiry, ivScale, range]);

  const { now, end, lo, hi, ROWS, COLS, prices, times, cells, maxAbs, beByCol } = grid;

  const cw = gw / COLS, ch = gh / ROWS;
  const xT = (t: number) => padL + ((t - now) / (end - now)) * gw;
  const yP = (p: number) => padT + ((hi - p) / (hi - lo)) * gh;

  const color = (pl: number) => {
    const t = Math.pow(Math.min(Math.abs(pl) / maxAbs, 1), 0.7);
    return { fill: pl >= 0 ? "var(--positive)" : "var(--negative)", opacity: 0.1 + t * 0.82 };
  };

  const fmtVal = (pl: number) => {
    if (unit === "pct" && pctOk) {
      const v = Math.round((pl / denom) * 100);
      const r = v === 0 ? 0 : v; // avoid "-0%"
      return (r >= 0 ? "+" : "") + r + "%";
    }
    const r = Math.round(pl) === 0 ? 0 : pl; // avoid "-0"
    const a = Math.abs(r), s = r < 0 ? "-" : "+";
    if (a >= 10000) return s + (a / 1000).toFixed(0) + "k";
    return s + a.toFixed(0);
  };
  const fmtDate = (t: number) => new Date(t * 1000).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

  // Expected-move cone (±1σ, ±2σ) under lognormal terminal model. Points outside
  // the band are kept but clipped by the grid clip-path.
  const conePath = (k: number, dir: 1 | -1) => {
    if (avgIV <= 0) return "";
    const iv = avgIV * ivScale;
    const pts: string[] = [];
    for (let j = 0; j < COLS; j++) {
      const dt = Math.max((times[j] - now) / (365 * 86400), 0);
      const p = spot * Math.exp(dir * k * iv * Math.sqrt(dt));
      pts.push(`${j === 0 ? "M" : "L"} ${xT(times[j]).toFixed(1)} ${yP(p).toFixed(1)}`);
    }
    return pts.join(" ");
  };

  // Breakeven polylines: connect k-th crossing across columns.
  const maxBE = beByCol.reduce((m, xs) => Math.max(m, xs.length), 0);
  const bePaths: string[] = [];
  for (let k = 0; k < maxBE; k++) {
    let d = "";
    for (let j = 0; j < COLS; j++) {
      const xs = beByCol[j];
      if (xs.length <= k) { d && bePaths.push(d); d = ""; continue; }
      d += `${d ? "L" : "M"} ${xT(times[j]).toFixed(1)} ${yP(xs[k]).toFixed(1)} `;
    }
    if (d) bePaths.push(d);
  }

  const spotY = yP(spot);
  const earnT = earningsDate ? Date.parse(earningsDate + "T16:00:00Z") / 1000 : null;
  const earnInRange = earnT != null && earnT >= now && earnT <= end;
  const nowPL = payoffAtTime(legs, spot, now, RISK_FREE, ivScale);

  const priceTicks = Array.from({ length: 8 }, (_, i) => Math.round((ROWS - 1) * (i / 7)));
  const dateTicks = Array.from({ length: Math.min(8, COLS) }, (_, i) => Math.round((COLS - 1) * (i / Math.min(7, COLS - 1 || 1))));

  const hovered = hover ? { pl: cells[hover.r][hover.c], price: prices[hover.r], t: times[hover.c] } : null;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="app-dialog m-auto max-h-[94vh] w-[min(98vw,1240px)] overflow-y-auto rounded-md border border-border bg-popover p-0 text-foreground"
    >
      <div className="flex flex-col gap-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2 min-w-0">
            <h2 className="text-lg font-medium text-foreground truncate">{title}</h2>
            <span className="text-xs text-muted-foreground shrink-0">P/L · price × date to expiry</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Show</span>
            <div className="flex rounded-sm overflow-hidden border border-border text-xs font-medium">
              {([["usd", "$"], ["pct", "%"]] as ["usd" | "pct", string][]).map(([u, label]) => {
                const active = unit === u, disabled = u === "pct" && !pctOk;
                return (
                  <button
                    key={u}
                    disabled={disabled}
                    onClick={() => setUnit(u)}
                    title={disabled ? "% needs a defined capital at risk" : undefined}
                    className="px-3.5 py-1 transition-colors disabled:opacity-40"
                    style={{ background: active ? "var(--primary)" : "transparent", color: active ? "oklch(0.08 0 0)" : "var(--muted-foreground)" }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Range (zoom) slider */}
          <label className="flex items-center gap-2 min-w-[230px]">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">Range</span>
            <input
              type="range" min={5} max={80} step={5}
              value={range}
              onChange={(e) => setRange(parseInt(e.target.value, 10))}
              className="flex-1 accent-[var(--primary)]"
            />
            <span className="text-xs font-mono text-foreground w-16 text-right">±{range}%</span>
          </label>

          {/* IV-crush slider */}
          <label className="flex items-center gap-2 min-w-[230px]">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">IV</span>
            <input
              type="range" min={20} max={200} step={5}
              value={Math.round(ivScale * 100)}
              onChange={(e) => setIvScale(parseInt(e.target.value, 10) / 100)}
              className="flex-1 accent-[var(--primary)]"
            />
            <span className="text-xs font-mono text-foreground w-20 text-right">
              {ivScale >= 1 ? "+" : ""}{Math.round((ivScale - 1) * 100)}%
              {avgIV > 0 && <span className="text-muted-foreground"> · {(avgIV * ivScale * 100).toFixed(0)}</span>}
            </span>
          </label>
          {ivScale !== 1 && (
            <button onClick={() => setIvScale(1)} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">reset IV</button>
          )}

          {/* Legend */}
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground ml-auto">
            <span className="text-[var(--negative)]">loss</span>
            <span style={{ width: 72, height: 9, borderRadius: 2, background: "linear-gradient(90deg, var(--negative), transparent 50%, var(--positive))" }} />
            <span className="text-[var(--positive)]">profit</span>
          </span>
        </div>

        {/* Matrix */}
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ display: "block" }}>
          <defs>
            <clipPath id={clipId}>
              <rect x={padL} y={padT} width={gw} height={gh} />
            </clipPath>
          </defs>

          {/* Cells + values */}
          {cells.map((row, r) =>
            row.map((pl, c) => {
              const { fill, opacity } = color(pl);
              const isHover = hover?.r === r && hover?.c === c;
              return (
                <g key={`${r}-${c}`}>
                  <rect
                    x={padL + c * cw} y={padT + r * ch} width={cw + 0.5} height={ch + 0.5}
                    fill={fill} opacity={opacity}
                    stroke={isHover ? "var(--foreground)" : "none"} strokeWidth={isHover ? 1.4 : 0}
                  />
                  <text
                    x={padL + c * cw + cw / 2} y={padT + r * ch + ch / 2 + 3.2}
                    textAnchor="middle" fontSize={10}
                    fill={pl >= 0 ? "oklch(0.96 0.03 150)" : "oklch(0.96 0.03 25)"}
                    fontFamily="var(--font-geist-mono), monospace" style={{ pointerEvents: "none" }}
                  >
                    {fmtVal(pl)}
                  </text>
                </g>
              );
            })
          )}

          {/* Overlays clipped to the grid so zoom-in hides out-of-band parts */}
          <g clipPath={`url(#${clipId})`}>
            {/* Expected-move cone (±2σ faint, ±1σ stronger) */}
            {avgIV > 0 && [2, 1].map((k) => (
              <g key={`cone${k}`}>
                <path d={conePath(k, 1)} fill="none" stroke="var(--steel)" strokeWidth={1.3} strokeDasharray={k === 2 ? "1 4" : "5 3"} opacity={k === 2 ? 0.4 : 0.75} />
                <path d={conePath(k, -1)} fill="none" stroke="var(--steel)" strokeWidth={1.3} strokeDasharray={k === 2 ? "1 4" : "5 3"} opacity={k === 2 ? 0.4 : 0.75} />
              </g>
            ))}

            {/* Breakeven curve(s) */}
            {bePaths.map((d, i) => (
              <path key={`be${i}`} d={d} fill="none" stroke="oklch(0.97 0.005 100)" strokeWidth={2} opacity={0.94} />
            ))}
          </g>

          {/* Spot reference + now marker */}
          <line x1={padL} x2={W - padR} y1={spotY} y2={spotY} stroke="oklch(0.82 0.005 74)" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
          <circle cx={xT(now)} cy={spotY} r={4} fill="var(--foreground)" />
          <text x={xT(now) + 7} y={spotY - 6} fontSize={10.5} fill="var(--foreground)" fontFamily="var(--font-geist-mono), monospace">
            now {nowPL >= 0 ? "+" : "-"}${Math.abs(nowPL).toFixed(0)}
          </text>

          {/* Earnings marker */}
          {earnInRange && (
            <g>
              <line x1={xT(earnT!)} x2={xT(earnT!)} y1={padT} y2={H - padB} stroke="var(--primary)" strokeWidth={1.4} strokeDasharray="5 3" opacity={0.85} />
              <text x={xT(earnT!)} y={padT + 11} textAnchor="middle" fontSize={10} fill="var(--primary)" fontFamily="var(--font-geist-mono), monospace">⚡ ER</text>
            </g>
          )}

          {/* Price axis */}
          {priceTicks.map((r) => (
            <text key={`p${r}`} x={padL - 7} y={padT + r * ch + ch / 2 + 3.5} textAnchor="end" fontSize={10.5} fill="oklch(0.64 0.008 74)" fontFamily="var(--font-geist-mono), monospace">
              {prices[r].toFixed(prices[r] < 10 ? 1 : 0)}
            </text>
          ))}

          {/* Date axis (angled) — intermediate dates; the last column is expiry, labeled separately below */}
          {[...new Set(dateTicks)].filter((c) => c < COLS - 1).map((c) => (
            <text
              key={`d${c}`} x={padL + c * cw + cw / 2} y={H - padB + 18}
              textAnchor="end" fontSize={10.5} fill="oklch(0.64 0.008 74)"
              fontFamily="var(--font-geist-mono), monospace"
              transform={`rotate(-38 ${padL + c * cw + cw / 2} ${H - padB + 18})`}
            >
              {fmtDate(times[c])}
            </text>
          ))}

          {/* Expiry — right edge of the grid (T+0 at expiration) */}
          <line x1={xT(end)} x2={xT(end)} y1={padT} y2={H - padB} stroke="oklch(0.82 0.005 74)" strokeWidth={1} strokeDasharray="2 4" opacity={0.45} />
          <text
            x={xT(end)} y={H - padB + 18}
            textAnchor="end" fontSize={11} fill="oklch(0.85 0.005 74)"
            fontFamily="var(--font-geist-mono), monospace"
            transform={`rotate(-38 ${xT(end)} ${H - padB + 18})`}
          >
            Exp {fmtDate(end)}
          </text>

          {/* Hover capture */}
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

        {/* Hover readout */}
        <div className="text-sm font-mono text-center" style={{ minHeight: 20 }}>
          {hovered ? (
            <span className="text-muted-foreground">
              {fmtDate(hovered.t)} @ <span className="text-foreground">${hovered.price.toFixed(2)}</span>
              <span className="mx-1.5 opacity-40">·</span>
              {((hovered.price - spot) / spot * 100 >= 0 ? "+" : "")}{((hovered.price - spot) / spot * 100).toFixed(1)}% move
              <span className="mx-1.5 opacity-40">·</span>
              <span style={{ color: hovered.pl >= 0 ? "var(--positive)" : "var(--negative)" }}>
                {hovered.pl >= 0 ? "+" : "-"}${Math.abs(hovered.pl).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                {pctOk && ` (${hovered.pl >= 0 ? "+" : ""}${((hovered.pl / denom) * 100).toFixed(0)}%)`}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground opacity-50">Hover any cell for exact P/L on that date &amp; price · drag Range to zoom</span>
          )}
        </div>

        {/* Key — what each line on the chart means */}
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <svg width="22" height="9" aria-hidden><line x1="1" y1="4.5" x2="21" y2="4.5" stroke="oklch(0.97 0.005 100)" strokeWidth="2" /></svg>
            Breakeven
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="22" height="9" aria-hidden><line x1="1" y1="4.5" x2="21" y2="4.5" stroke="var(--steel)" strokeWidth="1.3" strokeDasharray="5 3" /></svg>
            Expected move ±1σ / ±2σ
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="22" height="9" aria-hidden><line x1="1" y1="4.5" x2="21" y2="4.5" stroke="oklch(0.82 0.005 74)" strokeWidth="1" strokeDasharray="3 3" /></svg>
            Spot ${spot.toFixed(spot < 10 ? 2 : 0)}
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="11" height="11" aria-hidden><circle cx="5.5" cy="5.5" r="3.5" fill="var(--foreground)" /></svg>
            Now (today)
          </span>
          {earnInRange && (
            <span className="flex items-center gap-1.5">
              <svg width="22" height="9" aria-hidden><line x1="1" y1="4.5" x2="21" y2="4.5" stroke="var(--primary)" strokeWidth="1.4" strokeDasharray="5 3" /></svg>
              <span className="text-[var(--primary)]">⚡</span> Earnings {fmtDate(earnT!)}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <svg width="22" height="9" aria-hidden><line x1="11" y1="0" x2="11" y2="9" stroke="oklch(0.82 0.005 74)" strokeWidth="1" strokeDasharray="2 2" /></svg>
            Expiry {fmtDate(end)}
          </span>
        </div>
      </div>
    </dialog>
  );
}
