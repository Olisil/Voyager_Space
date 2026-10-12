import * as A from "astronomy-engine";
import { AU_KM, BODIES, helioState, toScene, type BodyId, type V3 } from "./bodies";
import { add, mul, norm, sub, type State } from "./orbits";

/**
 * A flight is a chain of legs. Each leg is motion relative to one body (a conic, a powered
 * ascent, a descent). Neighbouring legs overlap for a short window and are blended there:
 * across a burn this stands in for the finite burn (the two conics share the burn point),
 * across a sphere-of-influence crossing it hands over from one body's frame to the other's.
 */

export type Root = "earth" | "sun";

export interface Leg {
  center: BodyId;
  /** state relative to `center` (km, km/s) at t seconds after launch */
  at: (t: number) => State;
  /** ground-relative speed and altitude, when the leg knows them better than the orbit does */
  tele?: (t: number) => { speed: number; alt: number };
  /** end of this leg (s after launch); the last leg runs to the end of the mission */
  t1: number;
  /** half-width (s) of the blend into the next leg */
  blend: number;
}

const DAY = 86400;

/** Geocentric state of the Moon (scene frame, km, km/s). */
export function moonGeo(date: Date): State {
  const s = A.GeoMoonState(A.MakeTime(date));
  return { r: mul(toScene({ x: s.x, y: s.y, z: s.z }), AU_KM), v: mul(toScene({ x: s.vx, y: s.vy, z: s.vz }), AU_KM / DAY) };
}

/** State of body b in the root frame (km, km/s), straight from the ephemeris. */
export function bodyState(b: BodyId, date: Date, root: Root): State {
  if (root === "earth") {
    if (b === "moon") return moonGeo(date);
    if (b === "earth") return { r: [0, 0, 0], v: [0, 0, 0] };
    const e = helioState("earth", date);
    const s = b === "sun" ? { r: [0, 0, 0] as V3, v: [0, 0, 0] as V3 } : helioState(b, date);
    return { r: mul(sub(s.r, e.r), AU_KM), v: sub(s.v, e.v) };
  }
  if (b === "sun") return { r: [0, 0, 0], v: [0, 0, 0] };
  const s = helioState(b, date);
  return { r: mul(s.r, AU_KM), v: s.v };
}

/**
 * Body states over the mission, tabulated and Hermite-interpolated: the path needs them at
 * thousands of moments and the ephemeris is not cheap.
 */
export class Ephem {
  private tables = new Map<BodyId, { t0: number; dt: number; r: V3[]; v: V3[] }>();
  constructor(
    readonly launch: Date,
    readonly root: Root,
    private span: [number, number],
  ) {}
  private table(b: BodyId) {
    let tb = this.tables.get(b);
    if (!tb) {
      const [a, z] = this.span;
      const base = b === "moon" ? 1800 : 6 * 3600;
      const dt = Math.max(base, (z - a) / 6000);
      const n = Math.ceil((z - a) / dt) + 2;
      const r: V3[] = [];
      const v: V3[] = [];
      for (let i = 0; i <= n; i++) {
        const s = bodyState(b, new Date(this.launch.getTime() + (a + i * dt - dt) * 1000), this.root);
        r.push(s.r);
        v.push(s.v);
      }
      tb = { t0: a - dt, dt, r, v };
      this.tables.set(b, tb);
    }
    return tb;
  }
  at(b: BodyId, t: number): State {
    if ((this.root === "earth" && b === "earth") || b === "sun") return { r: [0, 0, 0], v: [0, 0, 0] };
    const tb = this.table(b);
    const x = (t - tb.t0) / tb.dt;
    const i = Math.floor(x);
    if (i < 0 || i >= tb.r.length - 1) return bodyState(b, new Date(this.launch.getTime() + t * 1000), this.root);
    const u = x - i;
    const h = tb.dt;
    const p0 = tb.r[i];
    const p1 = tb.r[i + 1];
    const m0 = mul(tb.v[i], h);
    const m1 = mul(tb.v[i + 1], h);
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    const r: V3 = [0, 1, 2].map((k) => h00 * p0[k] + h10 * m0[k] + h01 * p1[k] + h11 * m1[k]) as V3;
    const d00 = (6 * u2 - 6 * u) / h;
    const d10 = (3 * u2 - 4 * u + 1) / h;
    const d01 = (-6 * u2 + 6 * u) / h;
    const d11 = (3 * u2 - 2 * u) / h;
    const v: V3 = [0, 1, 2].map((k) => d00 * p0[k] + d10 * m0[k] + d01 * p1[k] + d11 * m1[k]) as V3;
    return { r, v };
  }
}

export interface Tele {
  /** km/s, relative to `ref` (ground-relative while flying through or onto a surface) */
  speed: number;
  /** km above `ref`'s surface */
  alt: number;
  ref: BodyId;
}

const smooth = (x: number) => {
  const c = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return c * c * (3 - 2 * c);
};

export class Trajectory {
  readonly end: number;
  constructor(
    readonly root: Root,
    readonly ephem: Ephem,
    readonly legs: Leg[],
  ) {
    this.end = legs[legs.length - 1].t1;
    // keep blend windows inside their legs
    for (let k = 0; k < legs.length - 1; k++) {
      const len0 = legs[k].t1 - (k ? legs[k - 1].t1 : 0);
      const len1 = legs[k + 1].t1 - legs[k].t1;
      legs[k].blend = Math.max(0, Math.min(legs[k].blend, 0.45 * len0, 0.45 * len1));
    }
  }

  private index(t: number) {
    const L = this.legs;
    let lo = 0;
    let hi = L.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (t <= L[m].t1) hi = m;
      else lo = m + 1;
    }
    return lo;
  }

  /** the legs active at t and the blend weight of the second one */
  private mix(t: number): { a: Leg; b: Leg | null; w: number; dw: number; x: number } {
    const L = this.legs;
    const k = this.index(t);
    const prev = k > 0 ? L[k - 1] : null;
    if (prev && prev.blend > 0 && t < prev.t1 + prev.blend) {
      const x = (t - (prev.t1 - prev.blend)) / (2 * prev.blend);
      return { a: prev, b: L[k], w: smooth(x), dw: (6 * x * (1 - x)) / (2 * prev.blend), x };
    }
    const cur = L[k];
    if (k < L.length - 1 && cur.blend > 0 && t > cur.t1 - cur.blend) {
      const x = (t - (cur.t1 - cur.blend)) / (2 * cur.blend);
      return { a: cur, b: L[k + 1], w: smooth(x), dw: (6 * x * (1 - x)) / (2 * cur.blend), x };
    }
    return { a: cur, b: null, w: 0, dw: 0, x: 0 };
  }

  private toRoot(leg: Leg, t: number): State {
    const s = leg.at(t);
    const c = this.ephem.at(leg.center, t);
    return { r: add(c.r, s.r), v: add(c.v, s.v) };
  }

  /** Position and velocity in the root frame (km, km/s). */
  at(t: number): State {
    const tt = Math.max(0, Math.min(this.end, t));
    const m = this.mix(tt);
    if (!m.b) return this.toRoot(m.a, tt);
    const sa = this.toRoot(m.a, tt);
    const sb = this.toRoot(m.b, tt);
    const d = sub(sb.r, sa.r);
    return {
      r: add(sa.r, mul(d, m.w)),
      v: add(add(mul(sa.v, 1 - m.w), mul(sb.v, m.w)), mul(d, m.dw)),
    };
  }

  /** The body the craft is mostly moving around at t. */
  centerAt(t: number): BodyId {
    const m = this.mix(Math.max(0, Math.min(this.end, t)));
    return m.b && m.w > 0.5 ? m.b.center : m.a.center;
  }

  private legTele(leg: Leg, t: number): Tele {
    if (leg.tele) return { ...leg.tele(t), ref: leg.center };
    const s = leg.at(t);
    return { speed: norm(s.v), alt: norm(s.r) - BODIES[leg.center].radiusKm, ref: leg.center };
  }

  /** Speed and altitude for the HUD, blended across hand-overs so the numbers never jump. */
  tele(t: number): Tele {
    const tt = Math.max(0, Math.min(this.end, t));
    const m = this.mix(tt);
    const a = this.legTele(m.a, tt);
    if (!m.b) return a;
    const b = this.legTele(m.b, tt);
    // a change of reference body (speed relative to Earth, then to the Sun) is a quick switch
    const w = a.ref === b.ref ? m.w : smooth((m.x - 0.44) / 0.12);
    const ref = w > 0.5 ? b.ref : a.ref;
    const alt = a.ref === b.ref ? a.alt + (b.alt - a.alt) * w : ref === a.ref ? a.alt : b.alt;
    return { speed: a.speed + (b.speed - a.speed) * w, alt, ref };
  }
}
