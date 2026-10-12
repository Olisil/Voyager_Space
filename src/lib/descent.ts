import { groundVelocity } from "./ascent";
import { BODIES, bodyBasis, type BodyId, type V3 } from "./bodies";
import { pchip } from "./interp";
import { add, cross, dot, mul, norm, unit, type State } from "./orbits";

/**
 * Landings. Airless bodies: a braking burn from a low periapsis down to the surface, like
 * Apollo's powered descent. Bodies with air: entry, parachutes and touchdown along
 * published profiles (Apollo for Earth, Perseverance for Mars, Venera for Venus).
 */

export interface Descent {
  /** seconds from the start of the descent to touchdown */
  T: number;
  /** body-centred inertial state, τ seconds after the start */
  at: (tau: number) => State;
  tele: (tau: number) => { speed: number; alt: number };
  events: { dt: number; label: string }[];
}

/** Entry interface altitude (km) and the flight-path angle to hit it at (degrees). */
export const ENTRY: Partial<Record<BodyId, { alt: number; fpa: number }>> = {
  earth: { alt: 120, fpa: -6.5 },
  mars: { alt: 125, fpa: -15.5 },
  venus: { alt: 200, fpa: -12 },
};
export const hasAir = (b: BodyId) => !!ENTRY[b];
/** Bodies a lander can touch down on. */
export const LANDABLE: BodyId[] = ["earth", "moon", "mars", "mercury", "venus"];
/** Periapsis altitude (km) of the orbit a powered descent starts from. */
export const DESCENT_PERI = 15;

function planeOf(r: V3, v: V3) {
  const P = unit(r);
  let n = unit(cross(r, v));
  if (norm(n) < 1e-9) n = unit(cross(P, Math.abs(P[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  return { P, Q: cross(n, P) };
}

function integrate(R: number, T: number, h: (t: number) => number, vh: (t: number) => number) {
  const N = 600;
  const th = new Float64Array(N + 1);
  for (let j = 0; j < N; j++) {
    const t0 = (j / N) * T;
    const t1 = ((j + 1) / N) * T;
    const tm = 0.5 * (t0 + t1);
    th[j + 1] = th[j] + (vh(tm) / (R + h(tm))) * (t1 - t0);
  }
  return (t: number) => {
    const x = Math.max(0, Math.min(N, (t / T) * N));
    const j = Math.min(N - 1, Math.floor(x));
    return th[j] + (th[j + 1] - th[j]) * (x - j);
  };
}

function build(R: number, r0: V3, v0: V3, T: number, h: (t: number) => number, hd: (t: number) => number, vh: (t: number) => number, speed: (t: number) => number, events: Descent["events"]): Descent {
  const { P, Q } = planeOf(r0, v0);
  const theta = integrate(R, T, h, vh);
  const at = (tau: number): State => {
    // before the start, carry on in a straight line, so the blend from the orbit is smooth
    if (tau < 0) return { r: add(r0, mul(v0, tau)), v: v0 };
    const t = Math.min(T, tau);
    const th = theta(t);
    const rh: V3 = add(mul(P, Math.cos(th)), mul(Q, Math.sin(th)));
    const tv: V3 = add(mul(P, -Math.sin(th)), mul(Q, Math.cos(th)));
    return { r: mul(rh, R + h(t)), v: add(mul(rh, hd(t)), mul(tv, vh(t))) };
  };
  return { T, at, tele: (tau) => ({ speed: speed(Math.max(0, Math.min(T, tau))), alt: Math.max(0, h(Math.max(0, Math.min(T, tau)))) }), events };
}

/** Airless: from the periapsis of a low descent orbit (state r0, v0), braking to a standstill on the ground. */
export function poweredDescent(body: BodyId, r0: V3, v0: V3): Descent {
  const R = BODIES[body].radiusKm;
  const h0 = norm(r0) - R;
  const vp = norm(v0);
  const T = 720 * Math.max(0.6, vp / 1.69);
  const a = 2.0;
  const b = 2.2;
  const u = (t: number) => Math.max(0, Math.min(1, t / T));
  const h = (t: number) => h0 * Math.pow(1 - u(t), b);
  const hd = (t: number) => (-b * h0 * Math.pow(1 - u(t), b - 1)) / T;
  const vh = (t: number) => vp * Math.pow(1 - u(t), a);
  const speed = (t: number) => Math.hypot(vh(t), hd(t));
  return build(R, r0, v0, T, h, hd, vh, speed, [
    { dt: 0, label: "POWERED DESCENT" },
    { dt: T, label: "TOUCHDOWN" },
  ]);
}

interface Key {
  t: number;
  h: number;
  /** speed, km/s; a fraction of the entry speed when `rel` */
  v: number;
  rel?: boolean;
  label?: string;
}

const PROFILES: Partial<Record<BodyId, Key[]>> = {
  // Perseverance, 2021: "seven minutes of terror"
  mars: [
    { t: 0, h: 125, v: 1, rel: true, label: "ENTRY INTERFACE" },
    { t: 80, h: 45, v: 0.86, rel: true, label: "PEAK HEATING" },
    { t: 110, h: 28, v: 0.45, rel: true },
    { t: 240, h: 11, v: 0.4, label: "PARACHUTE DEPLOY" },
    { t: 260, h: 9.6, v: 0.15, label: "HEAT SHIELD SEP" },
    { t: 380, h: 2.1, v: 0.085, label: "POWERED DESCENT" },
    { t: 406, h: 0.02, v: 0.0008 },
    { t: 418, h: 0, v: 0, label: "TOUCHDOWN" },
  ],
  // Apollo command module returning from the Moon
  earth: [
    { t: 0, h: 120, v: 1, rel: true, label: "ENTRY INTERFACE" },
    { t: 70, h: 70, v: 0.95, rel: true, label: "PEAK HEATING" },
    { t: 130, h: 58, v: 0.55, rel: true },
    { t: 260, h: 38, v: 2.0 },
    { t: 420, h: 12, v: 0.33 },
    { t: 480, h: 7.3, v: 0.15, label: "DROGUE CHUTES" },
    { t: 530, h: 3.0, v: 0.06, label: "MAIN CHUTES" },
    { t: 830, h: 0, v: 0, label: "SPLASHDOWN" },
  ],
  // Venera landers: a short fiery entry, then a long fall through the thick air
  venus: [
    { t: 0, h: 200, v: 1, rel: true, label: "ENTRY INTERFACE" },
    { t: 45, h: 110, v: 0.92, rel: true, label: "PEAK HEATING" },
    { t: 90, h: 75, v: 0.25, rel: true },
    { t: 200, h: 62, v: 0.2, label: "PARACHUTE DEPLOY" },
    { t: 700, h: 48, v: 0.05 },
    { t: 3000, h: 0, v: 0, label: "TOUCHDOWN" },
  ],
};

/** Atmospheric entry from the entry-interface state (rEI, vEI). */
export function atmosphericEntry(body: BodyId, rEI: V3, vEI: V3): Descent {
  const R = BODIES[body].radiusKm;
  const keys = PROFILES[body] ?? PROFILES.mars!;
  const vE = norm(vEI);
  const ts = keys.map((k) => k.t);
  const hs = keys.map((k, i) => (i === 0 ? norm(rEI) - R : k.h));
  const vs = keys.map((k) => (k.rel ? k.v * vE : Math.min(k.v, vE)));
  const hdot0 = dot(vEI, unit(rEI));
  const H = pchip(ts, hs, { d0: hdot0, d1: 0 });
  const V = pchip(ts, vs, { d1: 0 });
  const T = ts[ts.length - 1];
  const h = (t: number) => Math.max(0, H.f(t));
  const hd = (t: number) => (t >= T ? 0 : H.df(t));
  const speed = (t: number) => Math.max(0, V.f(t), Math.abs(hd(t)));
  const vh = (t: number) => {
    const v = Math.max(0, V.f(t));
    const d = hd(t);
    return Math.sqrt(Math.max(v * v - d * d, (0.03 * v) ** 2));
  };
  return build(R, rEI, vEI, T, h, hd, vh, speed, keys.filter((k) => k.label).map((k) => ({ dt: k.t, label: k.label! })));
}

/** Sitting on the ground after touchdown: turns with the body. */
export function onSurface(body: BodyId, rTouch: V3, launch: Date, tTouch: number) {
  const b0 = bodyBasis(body, new Date(launch.getTime() + tTouch * 1000));
  const c: V3 = [dot(rTouch, b0.x), dot(rTouch, b0.y), dot(rTouch, b0.z)];
  return (t: number): State => {
    const date = new Date(launch.getTime() + t * 1000);
    const b = bodyBasis(body, date);
    const r = add(add(mul(b.x, c[0]), mul(b.y, c[1])), mul(b.z, c[2]));
    return { r, v: groundVelocity(body, r, date) };
  };
}
