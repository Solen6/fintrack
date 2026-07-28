"use client";

import Link from "next/link";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ──────────────────────────────────────────────────────────────────────────
   Shared building blocks for the Analysis tool pages, so every tool reads as
   one system: the page frame (ToolShell), cards (Panel), metric tiles (Stat),
   the three data states, and a "how it's computed" disclosure.
   ────────────────────────────────────────────────────────────────────────── */

const MUTED = "oklch(0.50 0.006 74)";

export function ToolShell({
  category,
  title,
  subtitle,
  asOf,
  children,
}: {
  category: string;
  title: string;
  subtitle: string;
  asOf?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-6 pt-6 pb-16">
        <Link
          href="/analysis"
          className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
          Analysis
        </Link>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              {category}
            </div>
            <h1 className="mt-1.5 mb-1 text-[23px] font-semibold tracking-tight text-balance">
              {title}
            </h1>
            <p className="m-0 max-w-[62ch] text-[13.5px] text-muted-foreground">
              {subtitle}
            </p>
          </div>
          {asOf && (
            <span className="font-mono text-[11px] tabular-nums" style={{ color: MUTED }}>
              as of {asOf}
            </span>
          )}
        </div>

        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export function Panel({
  title,
  right,
  children,
  className,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-md border border-border bg-card p-4", className)}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && (
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: MUTED }}>
              {title}
            </h2>
          )}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "positive" | "negative" | "muted";
}) {
  const toneClass =
    tone === "positive"
      ? "text-positive"
      : tone === "negative"
        ? "text-negative"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card px-4 py-3">
      <span className="text-[10px] uppercase tracking-[0.08em]" style={{ color: MUTED }}>
        {label}
      </span>
      <span className={cn("font-mono text-[19px] font-semibold tabular-nums tracking-tight", toneClass)}>
        {value}
      </span>
      {sub != null && (
        <span className="font-mono text-[11px] tabular-nums" style={{ color: MUTED }}>
          {sub}
        </span>
      )}
    </div>
  );
}

/** Small inline action button used in panel headers. */
export function MiniButton({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-sm border px-2.5 py-1 text-[11.5px] transition-colors duration-150 disabled:opacity-40",
        primary
          ? "border-[oklch(0.72_0.14_74_/_0.45)] bg-[oklch(0.72_0.14_74_/_0.12)] text-primary hover:bg-[oklch(0.72_0.14_74_/_0.2)]"
          : "border-border bg-[oklch(0.16_0_0)] text-foreground hover:border-[oklch(0.28_0_0)]",
      )}
    >
      {children}
    </button>
  );
}

export function StatRow({ children, cols }: { children: ReactNode; cols?: string }) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: cols ?? "repeat(auto-fit, minmax(150px, 1fr))" }}
    >
      {children}
    </div>
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[74px] rounded-md skeleton" />
        ))}
      </div>
      <div className="h-[260px] rounded-md skeleton" />
      <span className="text-[12px]" style={{ color: MUTED }}>{label}</span>
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-md border border-border bg-card px-5 py-8 text-center">
      <p className="m-0 text-[13.5px] text-foreground">Couldn&apos;t load this tool</p>
      <p className="mx-auto mt-1 mb-0 max-w-[46ch] text-[12.5px] text-muted-foreground">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-sm border border-border bg-[oklch(0.16_0_0)] px-3.5 py-2 text-[12.5px] text-foreground transition-colors duration-150 hover:border-[oklch(0.28_0_0)]"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyBlock({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-5 py-10 text-center">
      <p className="m-0 text-[13.5px] text-foreground">{title}</p>
      {hint && <p className="mx-auto mt-1 mb-0 max-w-[52ch] text-[12.5px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** "How this is computed" disclosure, closed by default. */
export function MethodologyNote({ children }: { children: ReactNode }) {
  return (
    <details className="mt-6 rounded-md border border-border bg-card px-4 py-3 [&_summary]:cursor-pointer">
      <summary className="text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground marker:text-[oklch(0.50_0.006_74)]">
        How this is computed
      </summary>
      <div className="mt-3 space-y-2 text-[12.5px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}
