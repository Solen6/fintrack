"use client";

import { useEffect, useRef } from "react";
import type { ChainStrike } from "@/lib/option-strategies";

/**
 * Full options-chain explorer. Calls on the left, puts on the right, strike in
 * the center. Shows Volume / OI / IV / Bid / Ask per side. In custom mode a row
 * is clickable to add a leg (the dot flips Buy/Sell). ITM rows are shaded, the
 * ATM row is highlighted and auto-scrolled into view.
 */
export function OptionChainTable({
  rows,
  spot,
  loading,
  customMap,
  onToggle,
  onToggleSide,
}: {
  rows: ChainStrike[];
  spot: number;
  loading: boolean;
  /** strike→side per type, keyed "<strike>-CALL" / "<strike>-PUT". Undefined in strategy mode (read-only). */
  customMap?: Map<string, "BUY" | "SELL">;
  onToggle?: (strike: number, type: "CALL" | "PUT") => void;
  onToggleSide?: (strike: number, type: "CALL" | "PUT") => void;
}) {
  const atmRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (rows.length > 0 && atmRef.current) {
      atmRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [rows]);

  if (loading) {
    return (
      <div className="p-4 flex flex-col gap-1.5">
        {Array.from({ length: 12 }).map((_, i) => <div key={i} className="skeleton h-7 rounded-sm" />)}
      </div>
    );
  }
  if (rows.length === 0) {
    return <div className="p-8 text-center text-sm text-muted-foreground">No strikes for this expiry.</div>;
  }

  // ATM index.
  let atmIdx = 0, bestD = Infinity;
  rows.forEach((r, i) => {
    const d = Math.abs(r.strike - spot);
    if (d < bestD) { bestD = d; atmIdx = i; }
  });

  const num = (n: number | undefined, dp = 2) => (n && n > 0 ? n.toFixed(dp) : "—");
  const ivPct = (iv: number) => (iv > 0 ? (iv * 100).toFixed(1) : "—");
  const interactive = !!onToggle;

  return (
    <div className="overflow-auto" style={{ maxHeight: 560 }}>
      <table className="w-full text-xs" style={{ borderCollapse: "collapse", minWidth: 640 }}>
        <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
          <tr style={{ background: "oklch(0.10 0 0)" }} className="text-muted-foreground">
            <th className="text-right py-2 px-2 font-medium w-12">Vol</th>
            <th className="text-right py-2 px-2 font-medium w-12">OI</th>
            <th className="text-right py-2 px-2 font-medium w-12">IV</th>
            <th className="text-right py-2 px-2 font-medium w-14">Bid</th>
            <th className="text-right py-2 px-2 font-medium w-14">Ask</th>
            <th className="py-2 px-1 w-5" />
            <th className="text-center py-2 px-3 font-semibold" style={{ color: "var(--primary)" }}>CALLS</th>
            <th className="text-center py-2 px-3 font-semibold" style={{ background: "oklch(0.13 0 0)", color: "var(--foreground)" }}>STRIKE</th>
            <th className="text-center py-2 px-3 font-semibold" style={{ color: "var(--primary)" }}>PUTS</th>
            <th className="py-2 px-1 w-5" />
            <th className="text-left py-2 px-2 font-medium w-14">Bid</th>
            <th className="text-left py-2 px-2 font-medium w-14">Ask</th>
            <th className="text-left py-2 px-2 font-medium w-12">IV</th>
            <th className="text-left py-2 px-2 font-medium w-12">OI</th>
            <th className="text-left py-2 px-2 font-medium w-12">Vol</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isAtm = i === atmIdx;
            const itmCall = row.strike < spot; // call ITM when strike below spot
            const itmPut = row.strike > spot;  // put ITM when strike above spot

            const callKey = `${row.strike}-CALL`;
            const putKey = `${row.strike}-PUT`;
            const callSide = customMap?.get(callKey);
            const putSide = customMap?.get(putKey);
            const callSel = callSide !== undefined;
            const putSel = putSide !== undefined;

            const callBg = isAtm ? "oklch(0.16 0.012 74 / 0.7)" : itmCall ? "oklch(0.14 0 0 / 0.5)" : "transparent";
            const putBg = isAtm ? "oklch(0.16 0.012 74 / 0.7)" : itmPut ? "oklch(0.14 0 0 / 0.5)" : "transparent";

            const callCells = (cls: string) => ({
              className: `py-1.5 px-2 font-mono ${cls} ${interactive ? "cursor-pointer" : ""}`,
              style: { background: callBg } as React.CSSProperties,
              onClick: interactive ? () => onToggle?.(row.strike, "CALL") : undefined,
            });
            const putCells = (cls: string) => ({
              className: `py-1.5 px-2 font-mono ${cls} ${interactive ? "cursor-pointer" : ""}`,
              style: { background: putBg } as React.CSSProperties,
              onClick: interactive ? () => onToggle?.(row.strike, "PUT") : undefined,
            });

            const dot = (sel: boolean, side: "BUY" | "SELL" | undefined, onFlip: () => void) =>
              sel ? (
                <button
                  className="rounded-full w-4 h-4 inline-flex items-center justify-center text-[8px] font-bold"
                  style={{ background: side === "SELL" ? "var(--negative)" : "var(--positive)", color: "oklch(0.08 0 0)" }}
                  onClick={(e) => { e.stopPropagation(); onFlip(); }}
                  title={`Toggle Buy/Sell (currently ${side})`}
                >
                  {side === "SELL" ? "S" : "B"}
                </button>
              ) : null;

            return (
              <tr key={row.strike} ref={isAtm ? atmRef : undefined} style={{ borderBottom: "1px solid oklch(0.18 0 0)" }} className={interactive ? "hover:brightness-110" : ""}>
                {/* Call side */}
                <td {...callCells("text-right text-muted-foreground")}>{num(row.callVol, 0)}</td>
                <td {...callCells("text-right text-muted-foreground")}>{num(row.callOI, 0)}</td>
                <td {...callCells("text-right text-muted-foreground")}>{ivPct(row.callIV)}</td>
                <td {...callCells("text-right")} style={{ background: callBg, color: callSel ? (callSide === "SELL" ? "var(--negative)" : "var(--positive)") : "var(--foreground)", fontWeight: callSel ? 600 : 400 }}>{num(row.callBid)}</td>
                <td {...callCells("text-right")} style={{ background: callBg, color: callSel ? (callSide === "SELL" ? "var(--negative)" : "var(--positive)") : "var(--foreground)", fontWeight: callSel ? 600 : 400 }}>{num(row.callAsk)}</td>
                <td className="py-1.5 px-1 text-center" style={{ width: 20, background: callBg }}>{dot(callSel, callSide, () => onToggleSide?.(row.strike, "CALL"))}</td>
                <td className="py-1.5 px-3" style={{ background: callBg }} />

                {/* Strike */}
                <td className="py-1.5 px-3 text-center font-mono font-medium" style={{ background: isAtm ? "oklch(0.16 0.012 74 / 0.8)" : "oklch(0.12 0 0)", color: isAtm ? "var(--primary)" : "var(--foreground)" }}>
                  {row.strike.toFixed(row.strike % 1 === 0 ? 0 : 1)}
                </td>

                {/* Put side */}
                <td className="py-1.5 px-3" style={{ background: putBg }} />
                <td className="py-1.5 px-1 text-center" style={{ width: 20, background: putBg }}>{dot(putSel, putSide, () => onToggleSide?.(row.strike, "PUT"))}</td>
                <td {...putCells("text-left")} style={{ background: putBg, color: putSel ? (putSide === "SELL" ? "var(--negative)" : "var(--positive)") : "var(--foreground)", fontWeight: putSel ? 600 : 400 }}>{num(row.putBid)}</td>
                <td {...putCells("text-left")} style={{ background: putBg, color: putSel ? (putSide === "SELL" ? "var(--negative)" : "var(--positive)") : "var(--foreground)", fontWeight: putSel ? 600 : 400 }}>{num(row.putAsk)}</td>
                <td {...putCells("text-left text-muted-foreground")}>{ivPct(row.putIV)}</td>
                <td {...putCells("text-left text-muted-foreground")}>{num(row.putOI, 0)}</td>
                <td {...putCells("text-left text-muted-foreground")}>{num(row.putVol, 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
