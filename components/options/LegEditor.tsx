"use client";

import { buildLeg, type ChainStrike } from "@/lib/option-strategies";
import type { Leg, OptionType, Side } from "@/lib/options-math";

/** Call ITM below spot, put ITM above. */
function moneyness(type: "call" | "put", strike: number, spot: number): "ITM" | "ATM" | "OTM" {
  if (Math.abs(strike - spot) < 1e-9) return "ATM";
  if (type === "call") return strike < spot ? "ITM" : "OTM";
  return strike > spot ? "ITM" : "OTM";
}

export function LegEditor({
  legs,
  strikes,
  spot,
  expiry,
  onLegsChange,
  activeIdx,
  onSelectLeg,
}: {
  legs: Leg[];
  strikes: ChainStrike[];
  spot: number;
  expiry: number;
  onLegsChange: (legs: Leg[]) => void;
  /** When set, the strike is picked from the chain (strategy mode) — this leg is highlighted. */
  activeIdx?: number;
  onSelectLeg?: (i: number) => void;
}) {
  const selectable = !!onSelectLeg;
  const update = (i: number, patch: Partial<Pick<Leg, "type" | "side" | "strike" | "qty">>) => {
    const cur = legs[i];
    const type = patch.type ?? cur.type;
    const side = patch.side ?? cur.side;
    const qty = patch.qty ?? cur.qty;
    const strikeVal = patch.strike ?? cur.strike;
    if (type === "stock") {
      onLegsChange(legs.map((l, j) => (j === i ? buildLeg("stock", side, strikes[0], qty, spot, expiry) : l)));
      return;
    }
    const row = strikes.find((s) => s.strike === strikeVal) ?? strikes[0];
    const next = buildLeg(type, side, row, qty, spot, expiry);
    onLegsChange(legs.map((l, j) => (j === i ? next : l)));
  };

  const removeLeg = (i: number) => onLegsChange(legs.filter((_, j) => j !== i));

  return (
    <div className="flex flex-col gap-2">
      {legs.map((leg, i) => {
        const isActive = selectable && activeIdx === i;
        return (
        <div
          key={i}
          className="rounded-sm border bg-card px-3 py-2.5 transition-colors"
          style={{
            borderColor: isActive ? "var(--primary)" : "var(--border)",
            boxShadow: isActive ? "0 0 0 1px var(--primary)" : undefined,
          }}
        >
          {leg.type === "stock" ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SideToggle side={leg.side} onChange={(s) => update(i, { side: s })} />
                <span className="text-sm text-foreground">{leg.qty} shares</span>
              </div>
              <span className="text-xs font-mono text-muted-foreground">@ ${leg.premium.toFixed(2)}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SideToggle side={leg.side} onChange={(s) => update(i, { side: s })} />
                  <TypeToggle type={leg.type as "call" | "put"} onChange={(t) => update(i, { type: t })} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground">${leg.premium.toFixed(2)}</span>
                  {legs.length > 1 && (
                    <button
                      onClick={() => removeLeg(i)}
                      className="text-muted-foreground hover:text-foreground text-sm leading-none px-1"
                      title="Remove leg"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Strike</span>
                  {selectable ? (
                    <button
                      type="button"
                      onClick={() => onSelectLeg?.(i)}
                      className="w-full h-8 px-2 flex items-center justify-between gap-2 text-sm font-mono rounded-sm border bg-background text-foreground focus:outline-none transition-colors"
                      style={{ borderColor: isActive ? "var(--primary)" : "var(--border)" }}
                      title="Click, then pick a strike in the chain"
                    >
                      <span>${leg.strike}</span>
                      <span className="text-[10px] uppercase tracking-wider" style={{ color: isActive ? "var(--primary)" : "var(--muted-foreground)" }}>
                        {isActive ? "pick in chain ↑" : moneyness(leg.type as "call" | "put", leg.strike, spot)}
                      </span>
                    </button>
                  ) : (
                    <select
                      value={leg.strike}
                      onChange={(e) => update(i, { strike: parseFloat(e.target.value) })}
                      className="w-full h-8 px-2 text-sm font-mono rounded-sm border border-border bg-background text-foreground focus:outline-none focus:border-primary"
                    >
                      {strikes.map((s) => (
                        <option key={s.strike} value={s.strike}>{s.strike}</option>
                      ))}
                    </select>
                  )}
                </div>
                <label className="w-20">
                  <span className="block text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Qty</span>
                  <input
                    type="number"
                    min={1}
                    value={leg.qty}
                    onChange={(e) => update(i, { qty: Math.max(1, parseInt(e.target.value || "1", 10)) })}
                    className="w-full h-8 px-2 text-sm font-mono rounded-sm border border-border bg-background text-foreground focus:outline-none focus:border-primary"
                  />
                </label>
              </div>
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}

function SideToggle({ side, onChange }: { side: Side; onChange: (s: Side) => void }) {
  return (
    <div className="flex rounded-sm overflow-hidden border border-border text-xs font-medium">
      {(["long", "short"] as Side[]).map((s) => {
        const active = side === s;
        const label = s === "long" ? "Buy" : "Sell";
        const color = s === "long" ? "var(--positive)" : "var(--negative)";
        return (
          <button
            key={s}
            onClick={() => onChange(s)}
            className="px-2.5 py-1 transition-colors"
            style={{
              background: active ? color : "transparent",
              color: active ? "oklch(0.08 0 0)" : "var(--muted-foreground)",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function TypeToggle({ type, onChange }: { type: "call" | "put"; onChange: (t: OptionType) => void }) {
  return (
    <div className="flex rounded-sm overflow-hidden border border-border text-xs font-medium">
      {(["call", "put"] as const).map((t) => {
        const active = type === t;
        return (
          <button
            key={t}
            onClick={() => onChange(t)}
            className="px-2.5 py-1 transition-colors capitalize"
            style={{
              background: active ? "var(--accent)" : "transparent",
              color: active ? "var(--accent-foreground)" : "var(--muted-foreground)",
            }}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}
