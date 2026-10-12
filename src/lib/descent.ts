import { groundVelocity, SPIN } from "./ascent";
import { BODIES, bodyBasis, type BodyId, type V3 } from "./bodies";
import { add, cross, dot, mul, norm, rotate, sub, unit, type State } from "./orbits";

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

/** The ground's turn: the body's spin axis at the start of the descent, and its rate (rad/s). */
interface Spin {
  pole: V3;
  w: number;
}
function spinOf(body: BodyId, date: Date): Spin {
  return { pole: bodyBasis(body, date).z, w: SPIN[body] ?? 0 };
}
/** ground-relative velocity of an inertial state */
const groundRel = (r: V3, v: V3, s: Spin): V3 => sub(v, cross(mul(s.pole, s.w), r));

/**
 * The descent is flown relative to the turning ground (that is what brakes it to a standstill
 * on the spot it lands on) and carried round with the body: so it meets the ground at the
 * ground's own speed, and the time on the surface carries on from it without a corner.
 */
function build(
  R: number,
  r0: V3,
  v0: V3,
  spin: Spin,
  T: number,
  h: (t: number) => number,
  hd: (t: number) => number,
  vh: (t: number) => number,
  speed: (t: number) => number,
  events: Descent["events"],
  downrange?: (t: number) => number,
): Descent {
  const vg0 = groundRel(r0, v0, spin);
  const { P, Q } = planeOf(r0, vg0);
  const theta = downrange ?? integrate(R, T, h, vh);
  const wv = mul(spin.pole, spin.w);
  const at = (tau: number): State => {
    // before the start, carry on in a straight line, so the blend from the orbit is smooth
    if (tau < 0) return { r: add(r0, mul(v0, tau)), v: v0 };
    const t = Math.min(T, tau);
    const th = theta(t);
    const rh: V3 = add(mul(P, Math.cos(th)), mul(Q, Math.sin(th)));
    const tv: V3 = add(mul(P, -Math.sin(th)), mul(Q, Math.cos(th)));
    const rg = mul(rh, R + h(t));
    const vg: V3 = tau < T ? add(mul(rh, hd(t)), mul(tv, vh(t))) : [0, 0, 0];
    // from the ground's frame (as it was at the start) to space: turned by the spin since
    const a = spin.w * tau;
    const v = add(vg, cross(wv, rg));
    return a ? { r: rotate(rg, spin.pole, a), v: rotate(v, spin.pole, a) } : { r: rg, v };
  };
  return { T, at, tele: (tau) => ({ speed: speed(Math.max(0, Math.min(T, tau))), alt: Math.max(0, h(Math.max(0, Math.min(T, tau)))) }), events };
}

/** Airless: from the periapsis of a low descent orbit (state r0, v0), braking to a standstill on the ground. */
export function poweredDescent(body: BodyId, r0: V3, v0: V3, date: Date): Descent {
  const R = BODIES[body].radiusKm;
  const spin = spinOf(body, date);
  const h0 = norm(r0) - R;
  const vp = norm(groundRel(r0, v0, spin));
  const T = 720 * Math.max(0.6, vp / 1.69);
  const a = 2.0;
  const b = 2.2;
  const u = (t: number) => Math.max(0, Math.min(1, t / T));
  const h = (t: number) => h0 * Math.pow(1 - u(t), b);
  const hd = (t: number) => (-b * h0 * Math.pow(1 - u(t), b - 1)) / T;
  const vh = (t: number) => vp * Math.pow(1 - u(t), a);
  const speed = (t: number) => Math.hypot(vh(t), hd(t));
  return build(R, r0, v0, spin, T, h, hd, vh, speed, [
    { dt: 0, label: "POWERED DESCENT" },
    { dt: T, label: "TOUCHDOWN" },
  ]);
}

/**
 * Entry vehicles: ballistic coefficient (kg/m²) and the lift they fly with (vertical share of
 * L/D) through the hot part, then their parachutes, each opening on a condition, and for
 * Mars the powered descent at the end (the sky crane).
 */
interface Chute {
  open: (h: number, v: number) => boolean;
  beta: number;
  label: string;
}
interface Craft {
  beta: number;
  ld: number;
  /** atmosphere: density (kg/m³) at a height (km) */
  rho: (h: number) => number;
  chutes: Chute[];
  /** seconds after the first chute that the heat shield drops */
  shieldSep?: number;
  /** powered descent from this altitude, km */
  powered?: number;
  touchdown: string;
}
const CRAFT: Partial<Record<BodyId, Craft>> = {
  // Perseverance, 2021: guided lifting entry, supersonic parachute, sky crane
  mars: {
    beta: 140,
    ld: 0.13,
    rho: (h) => 0.02 * Math.exp(-h / 11.1),
    chutes: [{ open: (_h, v) => v < 0.42, beta: 9, label: "PARACHUTE DEPLOY" }],
    shieldSep: 20,
    powered: 2.1,
    touchdown: "TOUCHDOWN",
  },
  // Apollo command module returning from the Moon: lifting entry, drogues, three mains
  earth: {
    beta: 330,
    ld: 0.12,
    rho: (h) => 1.225 * Math.exp(-h / 7.2),
    chutes: [
      { open: (h, v) => v < 0.17 && h < 9, beta: 110, label: "DROGUE CHUTES" },
      { open: (h) => h < 3.2, beta: 5, label: "MAIN CHUTES" },
    ],
    touchdown: "SPLASHDOWN",
  },
  // Venera landers: a short fierce entry, a parachute high up, then released at about 48 km to
  // fall through the thick air under a small drag plate, touching down at 7–8 m/s after about an hour
  venus: {
    beta: 250,
    ld: 0,
    // dense and warm below the clouds, thin and cold above them
    rho: (h) => (h < 50 ? 65 * Math.exp(-h / 14) : 65 * Math.exp(-50 / 14) * Math.exp(-(h - 50) / 5.5)),
    chutes: [
      { open: (_h, v) => v < 0.25, beta: 20, label: "PARACHUTE DEPLOY" },
      { open: (h) => h < 48, beta: 200, label: "PARACHUTE RELEASE" },
    ],
    touchdown: "TOUCHDOWN",
  },
};

/** Cubic Hermite through samples with known slopes: smooth, and exact at the samples. */
function hermite(ts: number[], ys: number[], ds: number[]) {
  const n = ts.length;
  return (t: number) => {
    if (t <= ts[0]) return ys[0] + ds[0] * (t - ts[0]);
    if (t >= ts[n - 1]) return ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (ts[m] <= t) lo = m;
      else hi = m;
    }
    const h = ts[hi] - ts[lo];
    const u = (t - ts[lo]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[lo] + (u3 - 2 * u2 + u) * h * ds[lo] + (-2 * u3 + 3 * u2) * ys[hi] + (u3 - u2) * h * ds[hi];
  };
}

/**
 * Atmospheric entry from the entry-interface state (rEI, vEI), flown through a simple
 * atmosphere: drag, a little lift, gravity and the curve of the ground, then parachutes (and
 * the powered descent on Mars). Speeds are through the air, i.e. over the ground.
 */
export function atmosphericEntry(body: BodyId, rEI: V3, vEI: V3, date: Date): Descent {
  const R = BODIES[body].radiusKm;
  const mu = BODIES[body].mu;
  const spin = spinOf(body, date);
  const craft = CRAFT[body] ?? CRAFT.mars!;
  const vg0 = groundRel(rEI, vEI, spin);
  const h0 = norm(rEI) - R;
  const v0 = norm(vg0);
  const g0 = Math.asin(Math.max(-1, Math.min(1, dot(vg0, unit(rEI)) / v0)));
  const rho = (h: number) => craft.rho(Math.max(0, h));
  // state: altitude km, speed km/s, flight-path angle, downrange angle
  let beta = craft.beta;
  let ld = craft.ld;
  const f = (y: number[]): number[] => {
    const [h, v, g] = y;
    const r = R + h;
    const grav = mu / (r * r);
    const drag = (1000 * rho(h) * v * v) / (2 * beta);
    const vv = Math.max(v, 1e-4);
    return [v * Math.sin(g), -drag - grav * Math.sin(g), (ld * drag) / vv + (vv / r - grav / vv) * Math.cos(g), (v * Math.cos(g)) / r];
  };
  const ts: number[] = [0];
  const ys: number[][] = [[h0, v0, g0, 0]];
  const events: Descent["events"] = [{ dt: 0, label: "ENTRY INTERFACE" }];
  let y = [h0, v0, g0, 0];
  let t = 0;
  let chute = 0;
  let peak = 0;
  let peakT = 0;
  let poweredAt = -1;
  for (let guard = 0; guard < 60000; guard++) {
    const k1 = f(y);
    // steps short enough for the speed to change only a little (a parachute snaps hard)
    const dt = Math.max(0.01, Math.min(y[1] > 0.6 ? 0.25 : 1, (0.15 * y[1]) / Math.max(1e-9, Math.abs(k1[1]))));
    const k2 = f(y.map((x, i) => x + 0.5 * dt * k1[i]));
    const k3 = f(y.map((x, i) => x + 0.5 * dt * k2[i]));
    const k4 = f(y.map((x, i) => x + dt * k3[i]));
    const next = y.map((x, i) => x + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    // a lifting entry must not climb back out: let go of the lift if it starts to
    if (next[0] > h0 + 5) ld = 0;
    t += dt;
    y = next;
    const heat = rho(y[0]) * y[1] ** 3;
    if (chute === 0 && heat > peak) {
      peak = heat;
      peakT = t;
    }
    if (y[0] <= 0) {
      // land exactly on the ground
      const prev = ys[ys.length - 1];
      const a = prev[0] / Math.max(1e-9, prev[0] - y[0]);
      t = ts[ts.length - 1] + a * dt;
      y = prev.map((x, i) => x + a * (y[i] - x));
      y[0] = 0;
      ts.push(t);
      ys.push(y);
      break;
    }
    ts.push(t);
    ys.push(y);
    while (chute < craft.chutes.length && craft.chutes[chute].open(y[0], y[1])) {
      const c = craft.chutes[chute];
      events.push({ dt: t, label: c.label });
      if (chute === 0 && craft.shieldSep) events.push({ dt: t + craft.shieldSep, label: "HEAT SHIELD SEP" });
      beta = c.beta;
      ld = 0;
      chute++;
    }
    if (craft.powered !== undefined && chute > 0 && y[0] <= craft.powered) {
      poweredAt = ts.length - 1;
      break;
    }
  }
  if (peakT > 0) events.push({ dt: peakT, label: "PEAK HEATING" });
  // the samples, as smooth curves of time
  const hs = ys.map((q) => q[0]);
  const hds = ys.map((q) => q[1] * Math.sin(q[2]));
  const ths = ys.map((q) => q[3]);
  const thds = ys.map((q) => (q[1] * Math.cos(q[2])) / (R + q[0]));
  let T = ts[ts.length - 1];
  let hF = hermite(ts, hs, hds);
  let hdF = (tt: number) => {
    // slope of the Hermite curve, by a small difference (it is only used for velocities)
    const e = 0.05;
    return (hF(Math.min(T, tt + e)) - hF(Math.max(0, tt - e))) / (Math.min(T, tt + e) - Math.max(0, tt - e));
  };
  let thF = hermite(ts, ths, thds);
  let vhF = (tt: number) => {
    const e = 0.05;
    return ((thF(Math.min(T, tt + e)) - thF(Math.max(0, tt - e))) / (Math.min(T, tt + e) - Math.max(0, tt - e))) * (R + hF(tt));
  };
  if (poweredAt >= 0) {
    // the powered descent: from where the parachute leaves it, braking to a standstill on the ground
    const t1 = ts[poweredAt];
    const [h1, v1, g1, th1] = ys[poweredAt];
    const hd1 = Math.min(-1e-3, v1 * Math.sin(g1));
    const vh1 = v1 * Math.cos(g1);
    const Tp = (3 * h1) / -hd1;
    events.push({ dt: t1, label: "POWERED DESCENT" });
    T = t1 + Tp;
    const before = { h: hF, th: thF, hd: hdF, vh: vhF };
    const s = (tt: number) => Math.max(0, Math.min(1, (tt - t1) / Tp));
    hF = (tt) => (tt <= t1 ? before.h(tt) : h1 * (1 - s(tt)) ** 3);
    hdF = (tt) => (tt <= t1 ? before.hd(tt) : (-3 * h1 * (1 - s(tt)) ** 2) / Tp);
    // horizontal speed (1 − s)², so the ground covered is vh1·Tp/3 · (1 − (1 − s)³)
    thF = (tt) => (tt <= t1 ? before.th(tt) : th1 + ((vh1 * Tp) / 3) * (1 - (1 - s(tt)) ** 3) / R);
    vhF = (tt) => (tt <= t1 ? before.vh(tt) : vh1 * (1 - s(tt)) ** 2);
  }
  events.push({ dt: T, label: craft.touchdown });
  const hFinal = hF;
  const hdFinal = hdF;
  const vhFinal = vhF;
  const speed = (tt: number) => Math.hypot(hdFinal(tt), vhFinal(tt));
  return build(R, rEI, vEI, spin, T, (tt) => Math.max(0, hFinal(tt)), hdFinal, vhFinal, speed, events.sort((a, b) => a.dt - b.dt), thF);
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
