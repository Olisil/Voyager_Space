import type { V3 } from "./bodies";

/** Patched-conic tools. Units: km, s, km/s. */
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
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

function stumpC(z: number) {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 0.5 - z / 24;
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
  return 1 / 6 - z / 120;
}

/** Two-body propagation with universal variables (any conic). */
export function propagate(r0: V3, v0: V3, dt: number, mu: number): { r: V3; v: V3 } {
  if (Math.abs(dt) < 1e-9) return { r: r0, v: v0 };
  const R0 = norm(r0);
  const V0 = norm(v0);
  const vr0 = dot(r0, v0) / R0;
  const alpha = 2 / R0 - (V0 * V0) / mu;
  const sm = Math.sqrt(mu);
  let x = sm * Math.abs(alpha) * dt;
  if (!Number.isFinite(x) || x === 0) x = sm * dt / R0;
  for (let i = 0; i < 60; i++) {
    const z = alpha * x * x;
    const C = stumpC(z);
    const S = stumpS(z);
    const F = ((R0 * vr0) / sm) * x * x * C + (1 - alpha * R0) * x * x * x * S + R0 * x - sm * dt;
    const dF = ((R0 * vr0) / sm) * x * (1 - z * S) + (1 - alpha * R0) * x * x * C + R0;
    const step = F / dF;
    x -= step;
    if (Math.abs(step) < 1e-8) break;
  }
  const z = alpha * x * x;
  const C = stumpC(z);
  const S = stumpS(z);
  const f = 1 - (x * x * C) / R0;
  const g = dt - (x * x * x * S) / sm;
  const r = add(mul(r0, f), mul(v0, g));
  const R = norm(r);
  const fd = (sm / (R * R0)) * (z * S - 1) * x;
  const gd = 1 - (x * x * C) / R;
  return { r, v: add(mul(r0, fd), mul(v0, gd)) };
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
  const hi0 = 4 * Math.PI * Math.PI - 1e-6;
  let hi = hi0;
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
