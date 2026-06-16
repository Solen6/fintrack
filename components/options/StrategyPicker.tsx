"use client";

import { STRATEGIES, type StrategyCategory } from "@/lib/option-strategies";

const CATEGORIES: StrategyCategory[] = ["Single", "Vertical", "Volatility", "Advanced"];

export function StrategyPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {CATEGORIES.map((cat) => (
        <div key={cat} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{cat}</span>
          <div className="flex flex-wrap gap-1.5">
            {STRATEGIES.filter((s) => s.category === cat).map((s) => {
              const active = s.id === selectedId;
              return (
                <button
                  key={s.id}
                  onClick={() => onSelect(s.id)}
                  title={s.description}
                  className="px-2.5 py-1 text-xs rounded-sm border transition-colors"
                  style={{
                    borderColor: active ? "var(--primary)" : "var(--border)",
                    background: active ? "var(--primary)" : "transparent",
                    color: active ? "oklch(0.08 0 0)" : "var(--card-foreground)",
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
