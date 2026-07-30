"use client";

import { useState } from "react";
import { formatPercent } from "@/lib/format";
import { Sensitive } from "@/lib/privacy";
import { goalCurve, mcPercentile, probAbove, type McRun, type McSpec, type SolveResult, type SolveVariable } from "@/lib/analytics";
import { CHART, Histogram, LineChart } from "../charts";
import { Panel } from "../ui";
import { Field, MoneyInput, NumInput, Pill, PillRow } from "./controls";

const TRADING_DAYS = 252;

const VARIABLES: { id: SolveVariable; label: string; noun: string }[] = [
  { id: "contribution", label: "Monthly amount", noun: "contribution" },
  { id: "years", label: "Time", noun: "horizon" },
  { id: "initialValue", label: "Starting amount", noun: "starting amount" },
];

export function GoalPanel({
  run,
  goal,
  setGoal,
  format,
  spec,
  solve,
  years,
}: {
  run: McRun;
  goal: number;
  setGoal: (n: number) => void;
  format: (n: number) => string;
  spec: McSpec | null;
  solve: (variable: SolveVariable, target: number) => Promise<SolveResult>;
  years: number;
}) {
  const [variable, setVariable] = useState<SolveVariable>("contribution");
  const [target, setTarget] = useState(80);
  const [solving, setSolving] = useState(false);
  const [solved, setSolved] = useState<{ variable: SolveVariable; result: SolveResult } | null>(null);
  const [solveError, setSolveError] = useState<string | null>(null);

  const prob = goal > 0 ? probAbove(run.terminal, goal) : null;
  const curve = goal > 0 ? goalCurve(run, goal) : [];

  const runSolve = async () => {
    if (!spec || goal <= 0) return;
    setSolving(true);
    setSolveError(null);
    setSolved(null);
    try {
      setSolved({ variable, result: await solve(variable, target / 100) });
    } catch (e) {
      setSolveError(e instanceof Error ? e.message : "Solve failed");
    } finally {
      setSolving(false);
    }
  };

  return (
    <Panel title="Hitting your number">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <Field label="Goal">
          <MoneyInput value={goal} onChange={setGoal} placeholder="none" width="w-32" />
        </Field>
        {prob != null && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.08em]" style={{ color: CHART.muted }}>
              Odds at {years}y
            </span>
            <span
              className="font-mono text-[20px] tabular-nums"
              style={{ color: prob >= target / 100 ? CHART.positive : prob >= 0.5 ? CHART.amber : CHART.negative }}
            >
              {formatPercent(prob * 100, false)}
            </span>
          </div>
        )}
      </div>

      {goal <= 0 ? (
        <p className="mt-3 text-[12px]" style={{ color: CHART.muted }}>
          Set a goal to see the odds of reaching it, how those odds build over time, and what it would take to get there.
        </p>
      ) : (
        <>
          <div className="mt-4">
            <div className="mb-1.5 text-[11.5px]" style={{ color: CHART.muted }}>
              Chance of being at or above {format(goal)}, by year
            </div>
            <LineChart
              height={130}
              showEndDot
              gridLines={2}
              yDomain={[0, 1]}
              yFormat={(v) => `${(v * 100).toFixed(0)}%`}
              series={[{ name: "P(goal)", color: CHART.positive, values: curve, fill: "oklch(0.72 0.15 152 / 0.12)" }]}
            />
            <p className="mt-1.5 text-[11px] leading-relaxed" style={{ color: CHART.muted }}>
              Not necessarily rising: a path can climb above the goal and fall back under it, so the line can tick down
              even while the trend is up.
            </p>
          </div>

          <div className="mt-4 border-t border-border pt-3.5">
            <div className="mb-2.5 text-[12px] text-foreground">What would it take?</div>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <Field label="Solve for">
                <PillRow>
                  {VARIABLES.map((v) => (
                    <Pill key={v.id} active={variable === v.id} onClick={() => { setVariable(v.id); setSolved(null); }}>
                      {v.label}
                    </Pill>
                  ))}
                </PillRow>
              </Field>
              <Field label="Target odds">
                <NumInput value={target} onChange={(n) => { setTarget(n); setSolved(null); }} unit="%" min={1} max={99} />
              </Field>
              <button
                type="button"
                onClick={runSolve}
                disabled={solving || !spec}
                className="rounded-sm border border-border bg-[oklch(0.16_0_0)] px-3.5 py-2 text-[12.5px] text-foreground transition-colors duration-150 hover:border-[oklch(0.28_0_0)] disabled:opacity-50"
              >
                {solving ? "Solving…" : "Solve"}
              </button>
            </div>

            {solveError && (
              <p className="mt-2.5 text-[12px]" style={{ color: CHART.negative }}>
                {solveError}
              </p>
            )}
            {solved && <SolveResultLine solved={solved} target={target} format={format} />}
            {solving && (
              <p className="mt-2.5 text-[11.5px]" style={{ color: CHART.muted }}>
                Bisecting — about two dozen simulations at a reduced path count.
              </p>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

function SolveResultLine({ solved, target, format }: { solved: { variable: SolveVariable; result: SolveResult }; target: number; format: (n: number) => string }) {
  const { variable, result } = solved;
  const noun = VARIABLES.find((v) => v.id === variable)?.noun ?? variable;

  if (result.value == null) {
    return (
      <p className="mt-2.5 text-[12.5px]" style={{ color: CHART.negative }}>
        No {noun} reaches {target}% — even at the search ceiling the odds top out at {formatPercent(result.atMax * 100, false)}.
        The goal, the horizon or the expected return has to move.
      </p>
    );
  }
  const shown =
    variable === "years"
      ? `${result.value.toFixed(1)} years`
      : variable === "contribution"
        ? `${format(result.value)} / month`
        : format(result.value);

  return (
    <p className="mt-2.5 text-[12.5px] text-foreground">
      <Sensitive>{shown}</Sensitive>{" "}
      <span style={{ color: CHART.muted }}>
        gets you to {formatPercent(result.achieved * 100, false)} — the smallest {noun} that clears {target}%.
      </span>
    </p>
  );
}

/** Decumulation view: does the money last, and if not, when does it run out. */
export function DepletionPanel({ run, years }: { run: McRun; years: number }) {
  const ruin = run.ruinFraction;
  const dep = run.depletionYears;
  const survived = 1 - ruin;

  return (
    <Panel title="Does it last?">
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Money lasts" value={formatPercent(survived * 100, false)} tone={survived >= 0.9 ? "positive" : survived >= 0.75 ? undefined : "negative"} sub={`through ${years} years`} />
        <Tile label="Runs out" value={formatPercent(ruin * 100, false)} tone={ruin > 0.1 ? "negative" : undefined} sub="of all paths" />
        <Tile
          label="If it runs out"
          value={dep.length > 0 ? `yr ${mcPercentile(dep, 0.5).toFixed(0)}` : "—"}
          sub={dep.length > 0 ? `median, earliest yr ${dep[0].toFixed(0)}` : "never happens"}
        />
      </div>

      {dep.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[11.5px]" style={{ color: CHART.muted }}>
            When the money runs out, across the {dep.length.toLocaleString()} paths where it does
          </div>
          <Histogram sorted={dep} height={130} color={CHART.negative} clipAt={1} xFormat={(v) => `yr ${v.toFixed(0)}`} />
        </div>
      )}

      <p className="mt-2.5 text-[11px] leading-relaxed" style={{ color: CHART.muted }}>
        Sequence matters more than average return here: the same set of yearly returns in a different order can be the
        difference between lasting and not, because a bad stretch early is withdrawn from at depressed prices. That is
        why this reads off simulated paths rather than an average.
      </p>
    </Panel>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "negative" | "positive" }) {
  const color = tone === "negative" ? CHART.negative : tone === "positive" ? CHART.positive : undefined;
  return (
    <div className="rounded-sm border border-border bg-[oklch(0.10_0_0)] px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.07em]" style={{ color: CHART.muted }}>
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[15px] tabular-nums" style={{ color }}>
        {value}
      </div>
      <div className="text-[10.5px]" style={{ color: CHART.muted }}>
        {sub}
      </div>
    </div>
  );
}

export { TRADING_DAYS };
