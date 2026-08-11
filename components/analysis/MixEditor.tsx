"use client";

import { CHART } from "./charts";
import { Panel, MiniButton } from "./ui";

/* ──────────────────────────────────────────────────────────────────────────
   Shared per-ticker weight editor: "how much of the portfolio is each name".

   Entries need NOT sum to 100 — the owning tool normalizes before using them,
   so only relative sizes matter. The running total says so rather than forcing
   the user to do arithmetic while typing.
   ────────────────────────────────────────────────────────────────────────── */

/** Bar width as a rounded CSS percentage — full float precision buys no visible
    accuracy and makes React's hydration diff noisy. */
const barPct = (v: number, max: number) => `${((v / max) * 100).toFixed(2)}%`;

export function MixEditor({
  title = "Your mix · asset weights",
  description,
  tickers,
  weightPct,
  setWeight,
  sum,
  onLoadCurrent,
  onLoadRebalance,
  rebalanceChoices,
  onPickRebalance,
  onCancelRebalance,
  onEqualWeight,
  onScaleTo100,
  onSave,
  saveLabel = "Save as portfolio",
  busy = false,
  inactiveNote,
  note,
}: {
  title?: string;
  description: string;
  tickers: string[];
  weightPct: Record<string, number>;
  setWeight: (ticker: string, pct: number) => void;
  /** Total of the entered weights, computed by the owner over the same tickers. */
  sum: number;
  /** Omitted when there are no real account weights to load. */
  onLoadCurrent?: () => void;
  /** Pulls the saved targets from the Rebalancer tool. */
  onLoadRebalance?: () => void;
  /** Set by the owner when more than one account has saved targets: rebalance
      targets are percentages of a SINGLE account, so there's no combined
      vector to load and the account has to be chosen. */
  rebalanceChoices?: { account: string; updatedAt: string | null }[] | null;
  onPickRebalance?: (account: string) => void;
  onCancelRebalance?: () => void;
  onEqualWeight: () => void;
  onScaleTo100: () => void;
  /** Omitted by tools that have nowhere to save a mix. */
  onSave?: () => void;
  saveLabel?: string;
  busy?: boolean;
  /** Set when the weights exist but aren't currently driving anything. */
  inactiveNote?: string;
  /** Transient status from a load action (e.g. "no targets saved yet"). */
  note?: string | null;
}) {
  const off = Math.abs(sum - 100) > 0.05;

  return (
    <Panel
      title={title}
      right={
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.08em]" style={{ color: CHART.muted }}>
            Load
          </span>
          {onLoadCurrent && (
            <MiniButton onClick={onLoadCurrent} disabled={busy}>
              Current weights
            </MiniButton>
          )}
          {onLoadRebalance && (
            <MiniButton onClick={onLoadRebalance} disabled={busy}>
              Rebalance targets
            </MiniButton>
          )}
          <MiniButton onClick={onEqualWeight}>Equal weight</MiniButton>
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          <MiniButton onClick={onScaleTo100} disabled={!off || sum <= 0}>
            Scale to 100%
          </MiniButton>
          {onSave && (
            <MiniButton onClick={onSave} disabled={busy} primary>
              {saveLabel}
            </MiniButton>
          )}
        </div>
      }
    >
      <p className="m-0 mb-3 text-[11.5px]" style={{ color: CHART.muted }}>
        {description}
      </p>

      {inactiveNote && (
        <p className="m-0 mb-3 text-[11.5px]" style={{ color: CHART.amber }}>
          {inactiveNote}
        </p>
      )}

      {note && (
        <p className="m-0 mb-3 text-[11.5px]" style={{ color: CHART.muted }}>
          {note}
        </p>
      )}

      {rebalanceChoices && rebalanceChoices.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-sm border border-border bg-[oklch(0.10_0_0)] p-2.5">
          <span className="mr-1 text-[11.5px]" style={{ color: CHART.muted }}>
            Targets are saved per account — load which one?
          </span>
          {rebalanceChoices.map((c) => (
            <MiniButton key={c.account} onClick={() => onPickRebalance?.(c.account)} disabled={busy}>
              {c.account}
            </MiniButton>
          ))}
          {onCancelRebalance && (
            <MiniButton onClick={onCancelRebalance}>Cancel</MiniButton>
          )}
        </div>
      )}

      <div
        className="grid max-h-[280px] gap-x-4 gap-y-1.5 overflow-y-auto pr-1"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", opacity: inactiveNote ? 0.55 : 1 }}
      >
        {tickers.map((t) => {
          const v = weightPct[t] ?? 0;
          return (
            <label key={t} className="flex items-center gap-2 text-[12.5px]">
              <span className="w-[62px] shrink-0 truncate font-medium" title={t}>
                {t}
              </span>
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={Number.isFinite(v) ? Number(v.toFixed(2)) : 0}
                onChange={(e) => setWeight(t, Number(e.target.value))}
                aria-label={`${t} weight, percent`}
                className="w-[68px] rounded-sm border border-border bg-background px-1.5 py-1 text-right font-mono text-[12px] tabular-nums text-foreground outline-none focus:border-[oklch(0.72_0.14_74_/_0.5)]"
              />
              <span className="text-[11px]" style={{ color: CHART.muted }}>%</span>
              <div className="relative h-[6px] flex-1 overflow-hidden rounded-full bg-[oklch(0.16_0_0)]">
                <div
                  className="absolute left-0 top-0 h-full rounded-full"
                  style={{ width: barPct(Math.min(v, 100), 100), background: CHART.steel }}
                />
              </div>
            </label>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-[11.5px]">
        <span className="font-mono tabular-nums" style={{ color: off ? CHART.amber : CHART.positive }}>
          {sum.toFixed(1)}% entered
        </span>
        <span style={{ color: CHART.muted }}>
          {sum <= 0
            ? "nothing entered — falling back to equal weight"
            : off
              ? "normalized to 100% before use; relative sizes are what matter"
              : "sums to 100%"}
        </span>
      </div>
    </Panel>
  );
}
