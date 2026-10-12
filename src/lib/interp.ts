/**
 * Monotone cubic interpolation (Fritsch–Carlson PCHIP): smooth through the points, never
 * overshoots them. Used for time warps and for descent profiles.
 */
export interface Curve {
  f: (x: number) => number;
  df: (x: number) => number;
  xs: number[];
}

export function pchip(xs: number[], ys: number[], ends: { d0?: number; d1?: number } = {}): Curve {
  const n = xs.length;
  if (n === 1) return { f: () => ys[0], df: () => 0, xs };
  const h: number[] = [];
  const del: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    h.push(xs[k + 1] - xs[k]);
    del.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  }
  const m = new Array<number>(n).fill(0);
  for (let k = 1; k < n - 1; k++) {
    if (del[k - 1] * del[k] <= 0) m[k] = 0;
    else {
      const w1 = 2 * h[k] + h[k - 1];
      const w2 = h[k] + 2 * h[k - 1];
      m[k] = (w1 + w2) / (w1 / del[k - 1] + w2 / del[k]);
    }
  }
  const endSlope = (h0: number, h1: number, d0: number, d1: number) => {
    if (h1 === undefined || d1 === undefined) return d0;
    let s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (Math.sign(s) !== Math.sign(d0)) s = 0;
    else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(s) > Math.abs(3 * d0)) s = 3 * d0;
    return s;
  };
  m[0] = ends.d0 ?? (n > 2 ? endSlope(h[0], h[1], del[0], del[1]) : del[0]);
  m[n - 1] = ends.d1 ?? (n > 2 ? endSlope(h[n - 2], h[n - 3], del[n - 2], del[n - 3]) : del[n - 2]);
  const seg = (x: number) => {
    let lo = 0;
    let hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const f = (x: number) => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    const k = seg(x);
    const t = (x - xs[k]) / h[k];
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h[k] * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h[k] * m[k + 1];
  };
  const df = (x: number) => {
    if (x <= xs[0]) return m[0];
    if (x >= xs[n - 1]) return m[n - 1];
    const k = seg(x);
    const t = (x - xs[k]) / h[k];
    const t2 = t * t;
    return ((6 * t2 - 6 * t) * ys[k]) / h[k] + (3 * t2 - 4 * t + 1) * m[k] + ((-6 * t2 + 6 * t) * ys[k + 1]) / h[k] + (3 * t2 - 2 * t) * m[k + 1];
  };
  return { f, df, xs };
}

/** Inverse of an increasing function on [a, b] by bisection. */
export function invert(f: (x: number) => number, y: number, a: number, b: number, iters = 60) {
  if (y <= f(a)) return a;
  if (y >= f(b)) return b;
  for (let i = 0; i < iters; i++) {
    const m = 0.5 * (a + b);
    if (f(m) < y) a = m;
    else b = m;
  }
  return 0.5 * (a + b);
}
