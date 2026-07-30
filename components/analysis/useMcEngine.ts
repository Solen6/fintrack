"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runSimulation, solveFor, type McRun, type McSpec, type SolveRequest, type SolveResult } from "@/lib/analytics/montecarlo";
import type { McWorkerRequest, McWorkerResponse } from "@/lib/analytics/mc-worker";

/** Paths we're willing to run on the main thread when there's no Worker. */
const FALLBACK_PATH_CAP = 2000;

export interface McEngine {
  result: McRun | null;
  busy: boolean;
  error: string | null;
  /** True when the simulation is actually running off the main thread. */
  offThread: boolean;
  /** Set when no Worker was available and the path count had to be capped. */
  cappedTo: number | null;
  solve: (request: SolveRequest) => Promise<SolveResult>;
}

/** A request we can re-run on the main thread if the worker dies mid-flight. */
type Pending =
  | { kind: "run"; spec: McSpec; settle: (r: McWorkerResponse) => void }
  | { kind: "solve"; request: SolveRequest; settle: (r: McWorkerResponse) => void };

/**
 * Runs a Monte-Carlo spec, off the main thread when the browser allows it.
 *
 * `spec` MUST be memoized by the caller — its object identity is the trigger to
 * re-simulate. Hashing it instead would mean stringifying a 60 × 500 return
 * matrix on every keystroke.
 *
 * Results are debounced, and a stale reply is dropped rather than applied, so
 * dragging a slider can't leave the chart showing an earlier configuration. If
 * the worker fails to start or dies, in-flight work is re-run inline at a
 * reduced path count rather than left hanging.
 */
export function useMcEngine(spec: McSpec | null, debounceMs = 180): McEngine {
  /* Result and the spec that produced it live together so `busy` can be
     DERIVED rather than set. Setting it synchronously in the effect would mean
     a cascading render on every keystroke, and would also leave a stale `busy`
     visible for one frame. */
  const [done, setDone] = useState<{ spec: McSpec | null; run: McRun | null; error: string | null }>({
    spec: null,
    run: null,
    error: null,
  });
  const [offThread, setOffThread] = useState(false);
  const [cappedTo, setCappedTo] = useState<number | null>(null);

  const workerRef = useRef<Worker | null>(null);
  /** True once we've decided a Worker can't be used at all. */
  const workerDead = useRef(false);
  const nextId = useRef(1);
  const latestRun = useRef(0);
  const pending = useRef(new Map<number, Pending>());

  /** Run a request on the main thread, capping paths so the tab stays alive. */
  const inline = useCallback((p: Pending, id: number) => {
    try {
      if (p.kind === "run") {
        const capped = p.spec.paths > FALLBACK_PATH_CAP;
        setCappedTo(capped ? FALLBACK_PATH_CAP : null);
        const run = runSimulation(capped ? { ...p.spec, paths: FALLBACK_PATH_CAP } : p.spec);
        p.settle({ id, kind: "run", run });
      } else {
        const req = p.request;
        p.settle({
          id,
          kind: "solve",
          result: solveFor({ ...req, spec: { ...req.spec, paths: Math.min(req.spec.paths, FALLBACK_PATH_CAP) } }),
        });
      }
    } catch (e) {
      p.settle({ id, kind: "error", message: e instanceof Error ? e.message : "Simulation failed" });
    }
  }, []);

  /** Lazily create the worker; null means "run inline". */
  const getWorker = useCallback((): Worker | null => {
    if (workerRef.current) return workerRef.current;
    if (workerDead.current || typeof window === "undefined" || typeof Worker === "undefined") return null;
    try {
      const w = new Worker(new URL("../../lib/analytics/mc-worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<McWorkerResponse>) => {
        const msg = e.data;
        const p = pending.current.get(msg.id);
        if (p) {
          pending.current.delete(msg.id);
          p.settle(msg);
        }
      };
      w.onerror = (ev) => {
        // Give up on the worker permanently, then finish whatever it owed us on
        // the main thread — otherwise the tool sits on "busy" forever.
        ev.preventDefault?.();
        workerDead.current = true;
        workerRef.current = null;
        setOffThread(false);
        w.terminate();
        const owed = [...pending.current.entries()];
        pending.current.clear();
        for (const [id, p] of owed) inline(p, id);
      };
      workerRef.current = w;
      setOffThread(true);
      return w;
    } catch {
      workerDead.current = true;
      setOffThread(false);
      return null;
    }
  }, [inline]);

  useEffect(() => {
    const inFlight = pending.current;
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      inFlight.clear();
    };
  }, []);

  useEffect(() => {
    if (!spec) return;
    const id = nextId.current++;
    latestRun.current = id;

    const timer = setTimeout(() => {
      // A newer spec arrived while we were waiting out the debounce.
      if (latestRun.current !== id) return;

      const p: Pending = {
        kind: "run",
        spec,
        settle: (msg) => {
          // Discard anything that isn't the run we're still waiting on.
          if (latestRun.current !== id) return;
          if (msg.kind === "error") setDone((d) => ({ spec, run: d.run, error: msg.message }));
          else if (msg.kind === "run") setDone({ spec, run: msg.run, error: null });
        },
      };

      const worker = getWorker();
      if (!worker) {
        inline(p, id);
        return;
      }
      setCappedTo(null);
      pending.current.set(id, p);
      const req: McWorkerRequest = { id, kind: "run", spec };
      worker.postMessage(req);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [spec, debounceMs, getWorker, inline]);

  const solve = useCallback(
    (request: SolveRequest): Promise<SolveResult> =>
      new Promise<SolveResult>((resolve, reject) => {
        const id = nextId.current++;
        const p: Pending = {
          kind: "solve",
          request,
          settle: (msg) => {
            if (msg.kind === "solve") resolve(msg.result);
            else reject(new Error(msg.kind === "error" ? msg.message : "Unexpected reply"));
          },
        };
        const worker = getWorker();
        if (!worker) {
          inline(p, id);
          return;
        }
        pending.current.set(id, p);
        const req: McWorkerRequest = { id, kind: "solve", request };
        worker.postMessage(req);
      }),
    [getWorker, inline],
  );

  return {
    // Keep showing the last completed run while a new one computes, so the
    // charts don't blank out on every settings change.
    result: done.run,
    busy: !!spec && done.spec !== spec,
    error: done.error,
    offThread,
    cappedTo,
    solve,
  };
}
