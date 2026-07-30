"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CHART } from "../charts";

/* Small shared control primitives for the Monte-Carlo tool. Kept here rather
   than in the generic ui.tsx because the shapes (money fields, percent fields,
   a disclosure that remembers nothing) are specific to this tool's dense
   settings area. */

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.08em]" style={{ color: CHART.muted }}>
        {label}
        {hint && <span className="ml-1 normal-case tracking-normal opacity-70">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

export function Pill({
  active,
  onClick,
  children,
  title,
  tone = "primary",
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  tone?: "primary" | "warn";
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[12.5px] transition-colors duration-150",
        active
          ? tone === "warn"
            ? "border-[oklch(0.66_0.19_25_/_0.5)] bg-[oklch(0.66_0.19_25_/_0.13)] text-[oklch(0.72_0.16_25)]"
            : "border-[oklch(0.72_0.14_74_/_0.5)] bg-[oklch(0.72_0.14_74_/_0.13)] text-primary"
          : "border-border bg-card text-muted-foreground hover:border-[oklch(0.28_0_0)] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function PillRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

export function MoneyInput({
  value,
  onChange,
  placeholder,
  width = "w-24",
}: {
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
  width?: string;
}) {
  return (
    <div className="flex items-center rounded-sm border border-border bg-card focus-within:border-[oklch(0.72_0.14_74_/_0.5)]">
      <span className="pl-2.5 pr-1 text-[12px]" style={{ color: CHART.muted }}>
        $
      </span>
      <input
        type="number"
        min={0}
        value={value === 0 ? "" : value}
        placeholder={placeholder ?? "0"}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) && n >= 0 ? n : 0);
        }}
        className={cn(
          "bg-transparent py-2 pr-2.5 text-right font-mono text-[12px] tabular-nums text-foreground outline-none placeholder:text-[oklch(0.50_0.006_74)]",
          width,
        )}
      />
    </div>
  );
}

/** A number field with a trailing unit, for percents and counts. */
export function NumInput({
  value,
  onChange,
  unit,
  step = 1,
  min = 0,
  max,
  placeholder,
  width = "w-16",
}: {
  value: number;
  onChange: (n: number) => void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  width?: string;
}) {
  return (
    <div className="flex items-center rounded-sm border border-border bg-card focus-within:border-[oklch(0.72_0.14_74_/_0.5)]">
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value === 0 && placeholder ? "" : value}
        placeholder={placeholder}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return onChange(min);
          onChange(Math.min(max ?? Infinity, Math.max(min, n)));
        }}
        className={cn(
          "bg-transparent py-2 pl-2.5 text-right font-mono text-[12px] tabular-nums text-foreground outline-none placeholder:text-[oklch(0.50_0.006_74)]",
          width,
        )}
      />
      {unit && (
        <span className="pl-1 pr-2.5 text-[11.5px]" style={{ color: CHART.muted }}>
          {unit}
        </span>
      )}
    </div>
  );
}

export function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (b: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2 text-[12.5px] text-foreground">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[oklch(0.72_0.14_74)]"
      />
      <span className="flex flex-col">
        <span>{label}</span>
        {hint && (
          <span className="text-[11px] leading-snug" style={{ color: CHART.muted }}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

/** Collapsible settings group. There are enough knobs now that showing them all
    at once buries the ones that matter. */
export function Section({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left"
      >
        <span className="flex items-baseline gap-2.5">
          <span className="text-[12.5px] font-medium text-foreground">{title}</span>
          {summary && !open && (
            <span className="text-[11.5px]" style={{ color: CHART.muted }}>
              {summary}
            </span>
          )}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-150", open && "rotate-180")}
          style={{ color: CHART.muted }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && <div className="border-t border-border px-3.5 py-3.5">{children}</div>}
    </div>
  );
}

export function LegendItem({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: CHART.muted }}>
      <span
        className="h-2 w-4 rounded-full"
        style={dashed ? { backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` } : { background: color }}
      />
      {label}
    </span>
  );
}

/** Amber inline note for caveats that shouldn't be buried in methodology. */
export function Caveat({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-sm border border-[oklch(0.72_0.14_74_/_0.25)] bg-[oklch(0.72_0.14_74_/_0.07)] px-2.5 py-1.5 text-[11.5px] leading-relaxed text-primary">
      {children}
    </p>
  );
}
