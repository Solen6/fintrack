/* ──────────────────────────────────────────────────────────────────────────
   Web Worker host for the Monte-Carlo engine.

   25,000 paths over a 30-year horizon is ~190 million compounding steps. Run on
   the main thread that locks the tab for seconds; here it's off-thread and the
   UI keeps painting. The engine itself is pure and has no DOM dependencies, so
   this file is only a message envelope around it.

   Float64Arrays are transferred rather than copied, so a 10MB result crosses
   the boundary by handing over ownership instead of serializing.
   ────────────────────────────────────────────────────────────────────────── */

import { runSimulation, solveFor, type McRun, type McSpec, type SolveRequest, type SolveResult } from "./montecarlo";

export type McWorkerRequest =
  | { id: number; kind: "run"; spec: McSpec }
  | { id: number; kind: "solve"; request: SolveRequest };

export type McWorkerResponse =
  | { id: number; kind: "run"; run: McRun }
  | { id: number; kind: "solve"; result: SolveResult }
  | { id: number; kind: "error"; message: string };

/** Every Float64Array in a result, so postMessage can transfer them. */
function transferables(run: McRun): Transferable[] {
  const out: Transferable[] = [run.maxDrawdowns.buffer, run.depletionYears.buffer];
  // `terminal` IS the last column, so listing both would transfer it twice.
  for (const col of run.columns) out.push(col.buffer);
  return out;
}

self.onmessage = (e: MessageEvent<McWorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.kind === "run") {
      const run = runSimulation(msg.spec);
      const reply: McWorkerResponse = { id: msg.id, kind: "run", run };
      (self as unknown as Worker).postMessage(reply, transferables(run));
    } else {
      const result = solveFor(msg.request);
      const reply: McWorkerResponse = { id: msg.id, kind: "solve", result };
      (self as unknown as Worker).postMessage(reply);
    }
  } catch (err) {
    const reply: McWorkerResponse = {
      id: msg.id,
      kind: "error",
      message: err instanceof Error ? err.message : "Simulation failed",
    };
    (self as unknown as Worker).postMessage(reply);
  }
};
