"use client";

import { useEffect, useState } from "react";
import type { SentimentData, Component } from "@/app/api/sentiment/route";

const EMERALD = "var(--positive)";
const RUBY = "var(--negative)";

interface CardSpec {
  title: string;
  left: string;  // bullish pole (green)
  right: string; // bearish pole (red)
  comp: Component;
}

export function MarketBreadth() {
  const [data, setData] = useState<SentimentData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/sentiment")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d && !d.error ? d : null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton rounded-sm" style={{ height: 72 }} />
        ))}
      </div>
    );
  }
  if (!data) return null;

  const c = data.components;
  const cards: CardSpec[] = [
    { title: "Price Breadth",  left: "Advancing", right: "Declining", comp: c.breadth },
    { title: "52-Wk Strength", left: "New Highs", right: "New Lows",  comp: c.strength },
    { title: "S&P Momentum",   left: "Above Avg", right: "Below Avg", comp: c.momentum },
    { title: "Put / Call",     left: "Calls",     right: "Puts",      comp: c.putCall },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        {cards.map((card) => <BreadthCard key={card.title} {...card} />)}
        <BullBearCard score={data.score} history={data.history} />
      </div>
      <p className="text-muted-foreground" style={{ fontSize: "0.65rem" }}>
        Market internals from CNN Fear &amp; Greed component scores (0–100), not raw issue counts.
      </p>
    </div>
  );
}

function BreadthCard({ title, left, right, comp }: CardSpec) {
  const green = comp.score;          // bullish share
  const red = 100 - comp.score;      // bearish share
  return (
    <div className="rounded-sm border border-border bg-card px-3 py-2.5 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: EMERALD }}>{left}</span>
        <span className="text-xs font-medium" style={{ color: RUBY }}>{right}</span>
      </div>
      <div className="flex items-baseline justify-between font-mono text-xs">
        <span style={{ color: EMERALD }}>{green}%</span>
        <span className="text-muted-foreground" style={{ fontSize: "0.6rem" }}>{title}</span>
        <span style={{ color: RUBY }}>{red}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden flex">
        <div style={{ width: `${green}%`, background: EMERALD }} />
        <div style={{ width: `${red}%`, background: RUBY }} />
      </div>
    </div>
  );
}

function BullBearCard({ score, history }: { score: number; history: Array<{ t: number; score: number }> }) {
  const bull = score;
  const bear = 100 - score;
  const bullish = score >= 50;
  const lineColor = bullish ? EMERALD : RUBY;

  // sparkline geometry
  const W = 120, H = 36, pad = 2;
  const ys = history.map((p) => p.score);
  const lo = Math.min(...ys, 0);
  const hi = Math.max(...ys, 100);
  const range = hi - lo || 1;
  const x = (i: number) => (history.length <= 1 ? pad : pad + (i / (history.length - 1)) * (W - pad * 2));
  const y = (v: number) => pad + (1 - (v - lo) / range) * (H - pad * 2);
  const path = history.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.score).toFixed(1)}`).join(" ");

  return (
    <div className="rounded-sm border border-border bg-card px-3 py-2.5 flex items-center gap-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="flex-1 min-w-0" style={{ height: 36 }} role="img" aria-label="Fear & Greed trend">
        {history.length > 1 && (
          <path d={path} fill="none" stroke={lineColor} strokeWidth={1.5} strokeLinejoin="round" />
        )}
      </svg>
      <div className="flex flex-col gap-1 shrink-0">
        <span
          className="text-xs font-mono px-1.5 py-0.5 rounded-sm text-center"
          style={{ background: "oklch(0.72 0.15 152 / 0.15)", color: EMERALD }}
        >
          {bull}% Bull
        </span>
        <span
          className="text-xs font-mono px-1.5 py-0.5 rounded-sm text-center"
          style={{ background: "oklch(0.66 0.19 25 / 0.15)", color: RUBY }}
        >
          {bear}% Bear
        </span>
      </div>
    </div>
  );
}
