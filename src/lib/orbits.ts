import type { V3 } from "./bodies";

/** Patched-conic tools. Units: km, s, km/s. */
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const lerp3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const unit = (a: V3): V3 => {
  const n = norm(a);
  return n > 0 ? mul(a, 1 / n) : [0, 0, 0];
};
/** Rotate v about unit axis k by angle a (Rodrigues). */
export function rotate(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}
/** Signed angle from a to b about the unit axis n, in [0, 2π). */
export function angleAbout(a: V3, b: V3, n: V3) {
  const ang = Math.atan2(dot(cross(a, b), n), dot(a, b));
  return ang < 0 ? ang + 2 * Math.PI : ang;
}
/** The part of v perpendicular to the unit vector n. */
export const perp = (v: V3, n: V3): V3 => sub(v, mul(n, dot(v, n)));
export const smoothstep = (x: number) => {
  const c = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return c * c * (3 - 2 * c);
};

function stumpC(z: number) {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 0.5 - z / 24 + (z * z) / 720;
}
function stumpS(z: number) {
  if (z > 1e-6) {
    const s = Math.sqrt(z);
    return (s - Math.sin(s)) / (s * s * s);
  }
  if (z < -1e-6) {
    const s = Math.sqrt(-z);
    return (Math.sinh(s) - s) / (s * s * s);
  }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

export interface State {
  r: V3;
  v: V3;
}

/**
 * A two-body orbit (ellipse, parabola or hyperbola) through a state at time t0.
 * Propagation uses universal variables; Kepler's equation is solved by Newton's method
 * inside a bracket that always holds the root, so it cannot run away.
 */
export class Conic {
  readonly r0: V3;
  readonly v0: V3;
  readonly t0: number;
  readonly mu: number;
  /** orbital period (s), Infinity for open orbits */
  readonly period: number;
  /** 1/a: positive for ellipses, negative for hyperbolas */
  readonly alpha: number;
  private R0: number;
  private vr0: number;
  private sm: number;

  constructor(r0: V3, v0: V3, t0: number, mu: number) {
    this.r0 = r0;
    this.v0 = v0;
    this.t0 = t0;
    this.mu = mu;
    this.R0 = norm(r0);
    this.vr0 = dot(r0, v0) / this.R0;
    this.alpha = 2 / this.R0 - dot(v0, v0) / mu;
    this.sm = Math.sqrt(mu);
    this.period = this.alpha > 1e-12 ? (2 * Math.PI) / Math.sqrt(mu * this.alpha ** 3) : Infinity;
  }

  private F(x: number, dt: number) {
    const z = this.alpha * x * x;
    return ((this.R0 * this.vr0) / this.sm) * x * x * stumpC(z) + (1 - this.alpha * this.R0) * x * x * x * stumpS(z) + this.R0 * x - this.sm * dt;
  }
  private dF(x: number) {
    const z = this.alpha * x * x;
    return ((this.R0 * this.vr0) / this.sm) * x * (1 - z * stumpS(z)) + (1 - this.alpha * this.R0) * x * x * stumpC(z) + this.R0;
  }

  /** universal anomaly for a time step; F(x) rises with x, so bracket then refine */
  private solve(dt: number) {
    const sgn = dt >= 0 ? 1 : -1;
    // a first guess that is never too large for hyperbolas (where cosh would overflow)
    let g = (this.sm * Math.abs(dt)) / this.R0;
    if (this.alpha > 0) g = Math.min(g, this.sm * this.alpha * Math.abs(dt) + 1e-9);
    if (this.alpha < 0) {
      const a = -1 / this.alpha;
      const n = Math.sqrt(this.mu / (a * a * a));
      g = Math.min(g, Math.sqrt(a) * (Math.asinh(n * Math.abs(dt)) + 1));
    }
    g = Math.max(g, 1e-9);
    // outward search for a bracket [lo, hi] around the root
    const over = (x: number) => {
      const f = this.F(x, dt);
      return Number.isNaN(f) ? x * sgn > 0 : f * sgn > 0;
    };
    let lo = 0;
    let hi = sgn * g;
    for (let i = 0; i < 200 && !over(hi); i++) {
      lo = hi;
      hi *= 2;
    }
    let a = Math.min(lo, hi);
    let b = Math.max(lo, hi);
    let x = 0.5 * (a + b);
    for (let i = 0; i < 100; i++) {
      const f = this.F(x, dt);
      if (Number.isNaN(f) || f > 0) b = x;
      else a = x;
      if (Math.abs(f) < 1e-10 * Math.max(1, this.sm * Math.abs(dt))) break;
      const d = this.dF(x);
      let xn = x - f / d;
      if (!(xn > a && xn < b) || !Number.isFinite(xn)) xn = 0.5 * (a + b);
      if (Math.abs(xn - x) < 1e-13 * Math.max(1, Math.abs(x))) {
        x = xn;
        break;
      }
      x = xn;
    }
    return x;
  }

  at(t: number): State {
    let dt = t - this.t0;
    if (Number.isFinite(this.period)) dt -= this.period * Math.round(dt / this.period);
    if (Math.abs(dt) < 1e-9) return { r: [...this.r0] as V3, v: [...this.v0] as V3 };
    const x = this.solve(dt);
    const z = this.alpha * x * x;
    const C = stumpC(z);
    const S = stumpS(z);
    const f = 1 - (x * x * C) / this.R0;
    const g = dt - (x * x * x * S) / this.sm;
    const r = add(mul(this.r0, f), mul(this.v0, g));
    const R = norm(r);
    const fd = (this.sm / (R * this.R0)) * (z * S - 1) * x;
    const gd = 1 - (x * x * C) / R;
    return { r, v: add(mul(this.r0, fd), mul(this.v0, gd)) };
  }
}

/** Two-body propagation of a state by dt seconds. */
export function propagate(r0: V3, v0: V3, dt: number, mu: number): State {
  return new Conic(r0, v0, 0, mu).at(dt);
}

/** Time from periapsis to true anomaly θ (signed) on a conic with eccentricity e and semi-latus rectum p. */
export function timeFromPeri(e: number, p: number, mu: number, theta: number): number {
  if (Math.abs(e - 1) < 1e-7) {
    const D = Math.tan(theta / 2);
    return 0.5 * Math.sqrt((p * p * p) / mu) * (D + (D * D * D) / 3);
  }
  const a = p / (1 - e * e);
  if (e < 1) {
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(theta / 2));
    return (E - e * Math.sin(E)) / Math.sqrt(mu / (a * a * a));
  }
  const F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(theta / 2));
  return (e * Math.sinh(F) - F) / Math.sqrt(mu / (-a * -a * -a));
}

/** Periapsis frame of a conic: unit vectors towards periapsis (P) and along the motion there (Q). */
export interface Peri {
  P: V3;
  Q: V3;
  e: number;
  p: number;
}
/** State at true anomaly θ on a conic given by its periapsis frame. */
export function periState(o: Peri, mu: number, theta: number): State {
  const r = o.p / (1 + o.e * Math.cos(theta));
  const k = Math.sqrt(mu / o.p);
  return {
    r: add(mul(o.P, r * Math.cos(theta)), mul(o.Q, r * Math.sin(theta))),
    v: add(mul(o.P, -k * Math.sin(theta)), mul(o.Q, k * (o.e + Math.cos(theta)))),
  };
}
/** A Conic from its periapsis frame, passing periapsis at time tp. */
export function conicFromPeri(o: Peri, mu: number, tp: number): Conic {
  const s = periState(o, mu, 0);
  return new Conic(s.r, s.v, tp, mu);
}

/**
 * Hyperbola with periapsis radius rp and excess velocity vinf (vector). For a departure
 * (`out`) vinf is the velocity it leaves with; for an arrival (`in`) the one it comes in
 * with. `side` picks which way the periapsis leans: towards that direction (made
 * perpendicular to vinf). Returns the periapsis frame and the B-plane offset of the
 * asymptote (the miss distance an outer trajectory should aim at).
 */
export function hyperbola(vinf: V3, rp: number, mu: number, sense: "in" | "out", side: V3) {
  const V = norm(vinf);
  const u = unit(vinf);
  const e = 1 + (rp * V * V) / mu;
  const th = Math.acos(-1 / e);
  let w = unit(perp(side, u));
  if (norm(w) < 1e-9) w = unit(perp(Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u));
  // arrival: P = −cos θ∞ û + sin θ∞ w; departure: P = cos θ∞ û + sin θ∞ w (û outgoing).
  // In both cases the plane normal is w × û and the asymptote passes the body at b along w.
  const P = sense === "in" ? add(mul(u, -Math.cos(th)), mul(w, Math.sin(th))) : add(mul(u, Math.cos(th)), mul(w, Math.sin(th)));
  const n = unit(cross(w, u));
  const Q = cross(n, P);
  const b = rp * Math.sqrt(1 + (2 * mu) / (rp * V * V));
  return { peri: { P, Q, e, p: rp * (1 + e) } as Peri, n, b, B: w, thInf: th };
}

/** Periapsis frame of the conic through a state. */
export function periOf(r: V3, v: V3, mu: number): Peri {
  const h = cross(r, v);
  const hm = norm(h);
  const ev = sub(mul(cross(v, h), 1 / mu), unit(r));
  const e = norm(ev);
  const P = e > 1e-9 ? unit(ev) : unit(r);
  return { P, Q: cross(unit(h), P), e, p: (hm * hm) / mu };
}

/** Where a hyperbola's asymptote passes its body: b along the B-plane direction. */
export function asymptoteOffset(o: Peri, sense: "in" | "out"): V3 {
  if (o.e <= 1) return [0, 0, 0];
  const th = Math.acos(-1 / o.e);
  const b = o.p / Math.sqrt(o.e * o.e - 1);
  const B = sense === "in" ? add(mul(o.P, Math.sin(th)), mul(o.Q, Math.cos(th))) : sub(mul(o.P, Math.sin(th)), mul(o.Q, Math.cos(th)));
  return mul(B, b);
}

/** First time after (sense 1) or before (−1) t0 where f changes sign, bracketed by doubling steps. */
export function crossing(f: (t: number) => number, t0: number, step: number, sense: 1 | -1, limit: number): number | null {
  const f0 = f(t0);
  let a = t0;
  let d = step;
  for (let i = 0; i < 40 && d <= limit; i++) {
    const b = t0 + sense * d;
    if (f(b) * f0 <= 0) return bisect(f, Math.min(a, b), Math.max(a, b));
    a = b;
    d *= 2;
  }
  return null;
}

/** Sphere-of-influence radii (km), a·(m/M☉)^0.4. */
export const SOI_KM: Record<string, number> = {
  mercury: 1.12e5,
  venus: 6.16e5,
  earth: 9.25e5,
  moon: 6.61e4,
  mars: 5.77e5,
  jupiter: 4.82e7,
  saturn: 5.48e7,
  uranus: 5.18e7,
  neptune: 8.68e7,
};

/** Time (s) between periapsis and radius r on the hyperbola. */
export function hyperTime(o: Peri, mu: number, r: number) {
  const c = Math.max(-1, Math.min(1, (o.p / r - 1) / o.e));
  return timeFromPeri(o.e, o.p, mu, Math.acos(c));
}

/**
 * Velocity at point r of the hyperbola that has excess velocity vinf: as t → +∞ for
 * `out` (it escapes along vinf), as t → −∞ for `in` (it arrived along vinf).
 */
export function hyperbolaThrough(r: V3, vinf: V3, mu: number, sense: "in" | "out"): V3 | null {
  const vi = sense === "out" ? vinf : mul(vinf, -1);
  const R = norm(r);
  const V = norm(vi);
  const rh = unit(r);
  const s = unit(vi);
  let n = cross(rh, s);
  if (norm(n) < 1e-9) return null;
  n = unit(n);
  const phi = Math.acos(Math.max(-1, Math.min(1, dot(rh, s))));
  const A = R * V * V;
  const k = (A * Math.sin(phi) + Math.sqrt(A * A * Math.sin(phi) ** 2 + 4 * mu * A * (1 - Math.cos(phi)))) / (2 * mu);
  const e = Math.sqrt(1 + k * k);
  const p = (mu * k * k) / (V * V);
  const th0 = Math.acos(-1 / e) - phi;
  const hmag = Math.sqrt(mu * p);
  const vr = (mu / hmag) * e * Math.sin(th0);
  const vt = (mu / hmag) * (1 + e * Math.cos(th0));
  const v = add(mul(rh, vr), mul(cross(n, rh), vt));
  return sense === "out" ? v : mul(v, -1);
}

/**
 * Lambert's problem (single revolution, prograde with respect to `normal` when given),
 * universal-variable bisection. Returns departure and arrival velocities.
 */
export function lambert(r1: V3, r2: V3, tof: number, mu: number, normal: V3 = [0, 1, 0]): { v1: V3; v2: V3 } | null {
  const R1 = norm(r1);
  const R2 = norm(r2);
  let dth = Math.acos(Math.max(-1, Math.min(1, dot(r1, r2) / (R1 * R2))));
  if (dot(cross(r1, r2), normal) < 0) dth = 2 * Math.PI - dth;
  const Aa = Math.sin(dth) * Math.sqrt((R1 * R2) / (1 - Math.cos(dth)));
  if (!Number.isFinite(Aa) || Math.abs(Aa) < 1e-9) return null;
  const y = (z: number) => R1 + R2 + (Aa * (z * stumpS(z) - 1)) / Math.sqrt(stumpC(z));
  const F = (z: number) => {
    const yy = y(z);
    return Math.pow(yy / stumpC(z), 1.5) * stumpS(z) + Aa * Math.sqrt(yy) - Math.sqrt(mu) * tof;
  };
  let lo = -4 * Math.PI * Math.PI;
  let hi = 4 * Math.PI * Math.PI - 1e-6;
  let guard = 0;
  while (y(lo) < 0 && guard++ < 400) lo += 0.1;
  if (y(lo) < 0) return null;
  if (F(lo) > 0 || F(hi) < 0) return null;
  for (let i = 0; i < 100; i++) {
    const m = (lo + hi) / 2;
    if (F(m) > 0) hi = m;
    else lo = m;
  }
  const z = (lo + hi) / 2;
  const yy = y(z);
  const f = 1 - yy / R1;
  const g = Aa * Math.sqrt(yy / mu);
  const gd = 1 - yy / R2;
  if (!Number.isFinite(g) || g === 0) return null;
  return { v1: mul(sub(r2, mul(r1, f)), 1 / g), v2: mul(sub(mul(r2, gd), r1), 1 / g) };
}

/** Speed change to leave a circular orbit of radius r on a hyperbola with excess speed vinf. */
export function escapeDv(vinf: number, mu: number, r: number) {
  return Math.sqrt(vinf * vinf + (2 * mu) / r) - Math.sqrt(mu / r);
}

/** Hohmann transfer time between circular orbits (s). */
export function hohmannTime(r1: number, r2: number, mu: number) {
  const a = (r1 + r2) / 2;
  return Math.PI * Math.sqrt((a * a * a) / mu);
}

/** Bisection for an increasing or decreasing function on [a, b]; null when no sign change. */
export function bisect(f: (x: number) => number, a: number, b: number, iters = 80): number | null {
  let fa = f(a);
  const fb = f(b);
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) return null;
  for (let i = 0; i < iters; i++) {
    const m = 0.5 * (a + b);
    const fm = f(m);
    if (fm * fa <= 0) b = m;
    else {
      a = m;
      fa = fm;
    }
  }
  return 0.5 * (a + b);
}
