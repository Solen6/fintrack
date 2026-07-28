/* ──────────────────────────────────────────────────────────────────────────
   Small dense linear algebra over number[][], used by the mean-variance
   optimizer and the parametric Monte-Carlo sampler. Portfolios here are small
   (a few dozen assets at most), so clarity beats micro-optimization.
   All functions are pure.
   ────────────────────────────────────────────────────────────────────────── */

export type Vec = number[];
export type Mat = number[][];

export function zeros(n: number): Vec {
  return new Array(n).fill(0);
}

export function identity(n: number): Mat {
  const m: Mat = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) m[i][i] = 1;
  return m;
}

export function transpose(a: Mat): Mat {
  const rows = a.length;
  const cols = a[0]?.length ?? 0;
  const t: Mat = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) t[j][i] = a[i][j];
  return t;
}

export function matMul(a: Mat, b: Mat): Mat {
  const n = a.length;
  const m = b[0].length;
  const k = b.length;
  const out: Mat = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let p = 0; p < k; p++) {
      const aip = a[i][p];
      if (aip === 0) continue;
      for (let j = 0; j < m; j++) out[i][j] += aip * b[p][j];
    }
  }
  return out;
}

export function matVec(a: Mat, x: Vec): Vec {
  const n = a.length;
  const out = zeros(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const row = a[i];
    for (let j = 0; j < row.length; j++) s += row[j] * x[j];
    out[i] = s;
  }
  return out;
}

export function dot(a: Vec, b: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function addVec(a: Vec, b: Vec): Vec {
  return a.map((v, i) => v + b[i]);
}

export function subVec(a: Vec, b: Vec): Vec {
  return a.map((v, i) => v - b[i]);
}

export function scaleVec(a: Vec, s: number): Vec {
  return a.map((v) => v * s);
}

/** Gauss-Jordan inverse with partial pivoting. Returns null if singular. */
export function inverse(a: Mat): Mat | null {
  const n = a.length;
  // Augment [A | I]
  const m: Mat = a.map((row, i) => [
    ...row,
    ...identity(n)[i],
  ]);

  for (let col = 0; col < n; col++) {
    // pivot: largest magnitude in this column at/below the diagonal
    let pivot = col;
    let best = Math.abs(m[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(m[r][col]);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (best < 1e-14) return null; // singular
    if (pivot !== col) {
      const tmp = m[pivot];
      m[pivot] = m[col];
      m[col] = tmp;
    }
    const pv = m[col][col];
    for (let j = 0; j < 2 * n; j++) m[col][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[col][j];
    }
  }
  return m.map((row) => row.slice(n));
}

/**
 * Cholesky decomposition A = L·Lᵀ for a symmetric positive-definite A.
 * Returns the lower-triangular L, or null if A is not positive-definite.
 * Used to draw correlated normals for parametric Monte Carlo.
 */
export function cholesky(a: Mat): Mat | null {
  const n = a.length;
  const L: Mat = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) return null; // not positive-definite
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

/**
 * Euclidean projection of a vector onto the probability simplex
 * { w : w_i ≥ 0, Σ w_i = 1 }. Duchi et al. (2008), O(n log n).
 * This is the constraint step of the long-only mean-variance optimizer.
 */
export function projectToSimplex(v: Vec): Vec {
  const n = v.length;
  if (n === 0) return [];
  const u = [...v].sort((a, b) => b - a);
  let cssv = 0;
  let rho = -1;
  let theta = 0;
  for (let i = 0; i < n; i++) {
    cssv += u[i];
    const t = (cssv - 1) / (i + 1);
    if (u[i] - t > 0) {
      rho = i;
      theta = t;
    }
  }
  if (rho < 0) {
    // Fallback (shouldn't happen for finite input): uniform.
    return new Array(n).fill(1 / n);
  }
  return v.map((x) => Math.max(0, x - theta));
}
