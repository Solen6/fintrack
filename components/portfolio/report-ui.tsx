/* Shared presentational primitives for the Reports tab (monthly + annual). */

export const MUTED = "oklch(0.64 0.008 74)";
export const DIM = "oklch(0.52 0.008 74)";

export function gainColor(n: number): string | undefined {
  if (n > 0) return "var(--positive)";
  if (n < 0) return "var(--negative)";
  return undefined;
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground">{title}</h3>
        {hint && <span className="text-xs" style={{ color: DIM }}>{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div className="bg-card px-3 py-2.5 flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-mono tabular-nums" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

export function StatGrid({ children, cols = 4 }: { children: React.ReactNode; cols?: number }) {
  return (
    <div
      className={`grid gap-px rounded-sm overflow-hidden ${cols === 6 ? "grid-cols-3 lg:grid-cols-6" : "grid-cols-2 lg:grid-cols-4"}`}
      style={{ background: "var(--border)" }}
    >
      {children}
    </div>
  );
}
