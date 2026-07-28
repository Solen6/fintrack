/* ──────────────────────────────────────────────────────────────────────────
   Brinson-Hood-Beebower performance attribution.

   Decomposes a portfolio's active return (vs a benchmark) into, per sector:
     • allocation  = (wP − wB) · rB        (did you weight the right sectors?)
     • selection   =  wB · (rP − rB)       (did you pick the right names in them?)
     • interaction = (wP − wB) · (rP − rB)
   Summing all three across sectors equals total active return rP − rB.

   Sector benchmark returns are supplied by the caller (e.g. SPDR sector ETFs);
   the total benchmark return by a broad index (SPY). Pure.
   ────────────────────────────────────────────────────────────────────────── */

export interface SectorInput {
  sector: string;
  /** Portfolio weight in this sector (fraction of equity, sums to ~1). */
  portWeight: number;
  /** Portfolio return within this sector over the window (fraction). */
  portReturn: number;
  /** Benchmark weight in this sector (fraction). */
  benchWeight: number;
  /** Benchmark return within this sector over the window (fraction). */
  benchReturn: number;
}

export interface SectorEffect extends SectorInput {
  allocation: number;
  selection: number;
  interaction: number;
  total: number;
}

export interface AttributionResult {
  sectors: SectorEffect[];
  totals: {
    allocation: number;
    selection: number;
    interaction: number;
    active: number; // portfolio return − benchmark return
    portReturn: number;
    benchReturn: number;
  };
}

export function brinsonAttribution(
  inputs: SectorInput[],
  benchTotalReturn: number,
): AttributionResult {
  const sectors: SectorEffect[] = inputs.map((s) => {
    const allocation = (s.portWeight - s.benchWeight) * (s.benchReturn - benchTotalReturn);
    const selection = s.benchWeight * (s.portReturn - s.benchReturn);
    const interaction = (s.portWeight - s.benchWeight) * (s.portReturn - s.benchReturn);
    return {
      ...s,
      allocation,
      selection,
      interaction,
      total: allocation + selection + interaction,
    };
  });

  const sum = (f: (e: SectorEffect) => number) =>
    sectors.reduce((acc, e) => acc + f(e), 0);

  const portReturn = inputs.reduce((acc, s) => acc + s.portWeight * s.portReturn, 0);

  return {
    sectors,
    totals: {
      allocation: sum((e) => e.allocation),
      selection: sum((e) => e.selection),
      interaction: sum((e) => e.interaction),
      active: portReturn - benchTotalReturn,
      portReturn,
      benchReturn: benchTotalReturn,
    },
  };
}
