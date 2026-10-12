import { AU_KM, BODIES, compress, compressVec, displayPos, displayRadius, moonOffsetKm, SOFT, trueHelio, type BodyId, type V3 } from "./bodies";
import { add, dot, mul, norm, sub, unit } from "./orbits";
import type { Mission } from "./plan";

/**
 * From true positions to the picture. Planets are drawn enlarged, so near a body distances
 * are compressed with its √-scale (a 200 km orbit shows around the enlarged Earth); far away
 * the true heliocentric scale holds. Each body's map hands over smoothly to its parent's
 * (a smooth maximum of the two distances), so the path has no corners anywhere.
 *
 * Near a body the path is also drawn in that body's frame: parking orbits stay round while
 * the planet moves. Each vertex follows its body only while the craft is around it; the
 * rest of the path keeps the place it was flown in.
 */

const GAMMA = 0.12;
const LAMBDA = 1;

interface Radial {
  b: BodyId;
  dk: number;
  ck: number;
  sk: number;
  boost: number;
}

function radialMap(b: BodyId, boost: number, knee: number): Radial {
  const R = BODIES[b].radiusKm;
  const Rd = displayRadius(b, boost);
  const dk = Math.max(knee, 1.5 * R);
  const ck = compress(b, dk, boost);
  const slope = (0.7 * Rd) / (R * Math.sqrt((dk - R) / R + SOFT * SOFT));
  return { b, dk, ck, sk: (dk * slope) / ck, boost };
}
/** display distance (AU) for a true distance d (km) from the body: √-compressed, then slowly growing */
function radial(m: Radial, d: number) {
  if (d <= m.dk) return compress(m.b, d, m.boost);
  const D = Math.log(d / m.dk);
  return m.ck * Math.exp(GAMMA * D + (m.sk - GAMMA) * LAMBDA * (1 - Math.exp(-D / LAMBDA)));
}

/** Hand over from the parent's picture P to body b's own (centre D, true offset δ, own distance g). */
function smax(P: V3, D: V3, delta: V3, g: number): V3 {
  const q = sub(P, D);
  const Q = norm(q);
  const dh = unit(delta);
  if (Q < 1e-18) return add(D, mul(dh, g));
  const r = Q / g;
  const r6 = r ** 6;
  const w = 1 / (1 + r6);
  const m = g * Math.pow(1 + r6, 1 / 6);
  const dir = unit(add(mul(dh, w), mul(q, (1 - w) / Q)));
  return add(D, mul(dir, m));
}

const ss = (x: number) => {
  const c = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return c * c * (3 - 2 * c);
};

function knee(b: BodyId, withMoon: boolean) {
  if (b === "earth") return withMoon ? 466000 : 60000;
  if (b === "moon") return 10000;
  if (b === "jupiter") return 2.07e6;
  return 10 * BODIES[b].radiusKm;
}
/**
 * True distances (km) over which the path lets go of a body's frame. Kept close to the body,
 * where the craft is fast, so the hand-over takes little time and the body moves little.
 */
function hold(b: BodyId): [number, number] {
  if (b === "earth") return [2.5e4, 8e4];
  if (b === "moon") return [4e3, 8e3];
  if (b === "jupiter") return [1.5e6, 4e6];
  const R = BODIES[b].radiusKm;
  if (b === "mars" || b === "mercury" || b === "venus") return [7 * R, 25 * R];
  return [8 * R, 30 * R];
}

interface Zone {
  b: BodyId;
  /** index of the zone this one sits inside (the Moon inside Earth's), or −1 */
  parent: number;
  near: number;
  far: number;
  T0: number;
  T1: number;
}

interface Sample {
  t: number;
  base: V3;
  alpha: number[];
  D: V3[];
}

export class FlightPath {
  readonly root: "earth" | "sun";
  readonly n: number;
  readonly times: Float64Array;
  private P: Float64Array;
  private C: Float32Array;
  /** where each zone's body was drawn at each vertex's moment */
  private D: Float64Array;
  readonly zones: Zone[];
  private maps = new Map<BodyId, Radial>();
  private planets: BodyId[];
  private moon: boolean;

  constructor(
    readonly mission: Mission,
    readonly boost: number,
  ) {
    const m = mission;
    this.root = m.root;
    this.moon = m.bodies.includes("moon");
    this.planets = m.root === "sun" ? m.bodies.filter((b) => b !== "moon") : [];
    for (const b of m.bodies) this.maps.set(b, radialMap(b, boost, knee(b, this.moon)));
    const zb = m.root === "sun" ? m.bodies : m.bodies.filter((b) => b === "moon");
    this.zones = zb.map((b): Zone => {
      const [near, far] = hold(b);
      return { b, parent: -1, near, far, T0: Infinity, T1: -Infinity };
    });
    const ie = this.zones.findIndex((z) => z.b === "earth");
    const im = this.zones.findIndex((z) => z.b === "moon");
    if (im >= 0 && ie >= 0) this.zones[im].parent = ie;

    const samples = this.sampleAll();
    this.n = samples.length;
    this.times = new Float64Array(this.n);
    this.P = new Float64Array(this.n * 3);
    this.C = new Float32Array(this.n * this.zones.length);
    this.D = new Float64Array(this.n * this.zones.length * 3);
    samples.forEach((s, i) => {
      this.times[i] = s.t;
      const c = this.weights(s.alpha);
      let p = s.base;
      c.forEach((ci, z) => {
        this.C[i * this.zones.length + z] = ci;
        this.D.set(s.D[z], (i * this.zones.length + z) * 3);
        p = sub(p, mul(s.D[z], ci));
      });
      this.P.set(p, i * 3);
    });
  }

  /** zone weights: inner zones (the Moon) take precedence over their parents */
  private weights(alpha: number[]): number[] {
    return this.zones.map((_, k) => {
      let c = alpha[k];
      this.zones.forEach((o, j) => {
        if (o.parent === k) c *= 1 - alpha[j];
      });
      return c;
    });
  }

  /** the picture of the craft at t, before any frame-following, with zone data */
  private sample(t: number): Sample {
    const m = this.mission;
    const tr = m.traj!;
    const x = tr.at(t).r;
    const alpha: number[] = [];
    const D: V3[] = [];
    let P: V3;
    const setZone = (b: BodyId, d: number, Db: V3) => {
      const k = this.zones.findIndex((z) => z.b === b);
      if (k < 0) return;
      const z = this.zones[k];
      alpha[k] = 1 - ss((Math.log(d) - Math.log(z.near)) / (Math.log(z.far) - Math.log(z.near)));
      D[k] = Db;
    };
    if (this.root === "sun") {
      P = mul(x, 1 / AU_KM);
      for (const b of this.planets) {
        const bp = tr.ephem.at(b, t).r;
        const Db = mul(bp, 1 / AU_KM);
        const delta = sub(x, bp);
        const d = norm(delta);
        P = smax(P, Db, delta, radial(this.maps.get(b)!, d));
        setZone(b, d, Db);
      }
      if (this.moon) {
        const ep = tr.ephem.at("earth", t).r;
        const mp = tr.ephem.at("moon", t).r;
        const Dm = add(mul(ep, 1 / AU_KM), compressVec("earth", sub(mp, ep), this.boost));
        const delta = sub(x, mp);
        const d = norm(delta);
        P = smax(P, Dm, delta, radial(this.maps.get("moon")!, d));
        setZone("moon", d, Dm);
      }
    } else {
      P = compressVec("earth", x, this.boost);
      if (this.moon) {
        const mp = tr.ephem.at("moon", t).r;
        const Dm = compressVec("earth", mp, this.boost);
        const delta = sub(x, mp);
        const d = norm(delta);
        P = smax(P, Dm, delta, radial(this.maps.get("moon")!, d));
        setZone("moon", d, Dm);
      }
    }
    return { t, base: P, alpha, D };
  }

  private sampleAll(): Sample[] {
    const m = this.mission;
    const T = m.end;
    const seeds = new Set<number>([0, T]);
    for (const ph of m.phases) for (let j = 0; j <= 48; j++) seeds.add(ph.t0 + ((ph.t1 - ph.t0) * j) / 48);
    for (const l of m.traj!.legs) for (const t of [l.t1 - l.blend, l.t1, l.t1 + l.blend]) seeds.add(t);
    for (const e of m.events) seeds.add(e.t);
    const ts = [...seeds].filter((t) => t >= 0 && t <= T).sort((a, b) => a - b);
    const coarse = ts.map((t) => this.sample(t));
    // when the craft is in each zone, and a fixed frame per zone to judge shapes in
    for (const s of coarse)
      s.alpha.forEach((a, k) => {
        if (a > 1e-4) {
          this.zones[k].T0 = Math.min(this.zones[k].T0, s.t);
          this.zones[k].T1 = Math.max(this.zones[k].T1, s.t);
        }
      });
    for (const z of this.zones) {
      if (!Number.isFinite(z.T0)) {
        z.T0 = 0;
        z.T1 = 0;
      }
    }
    const ref = this.zones.map((z) => this.sample(z.T0).D[this.zones.indexOf(z)] ?? [0, 0, 0]);
    const shape = (s: Sample): V3 => {
      const c = this.weights(s.alpha);
      let p = s.base;
      c.forEach((ci, k) => (p = add(p, mul(sub(ref[k], s.D[k]), ci))));
      return p;
    };
    const centres = ref.length ? ref : [[0, 0, 0] as V3];
    const scaleAt = (p: V3) => {
      let best = Infinity;
      for (const c of centres) best = Math.min(best, norm(sub(p, c)));
      if (this.root === "earth") best = Math.min(best, norm(p));
      return Math.max(best, 0.6 * displayRadius("moon", this.boost));
    };
    const out: Sample[] = [];
    let budget = 14000;
    const refine = (a: Sample, b: Sample, A: V3, B: V3, depth: number) => {
      if (depth > 16 || b.t - a.t < 0.02 || budget <= 0) return;
      const mid = this.sample(0.5 * (a.t + b.t));
      const M = shape(mid);
      const AM = sub(M, A);
      const MB = sub(B, M);
      const la = norm(AM);
      const lb = norm(MB);
      const scale = scaleAt(M);
      const cos = la > 0 && lb > 0 ? dot(AM, MB) / (la * lb) : 1;
      const dev = norm(sub(M, mul(add(A, B), 0.5)));
      if (cos < Math.cos((1.2 * Math.PI) / 180) || dev > 0.0015 * scale || la + lb > 0.05 * scale) {
        budget--;
        refine(a, mid, A, M, depth + 1);
        out.push(mid);
        refine(mid, b, M, B, depth + 1);
      }
    };
    for (let i = 0; i < coarse.length; i++) {
      out.push(coarse[i]);
      if (i < coarse.length - 1) refine(coarse[i], coarse[i + 1], shape(coarse[i]), shape(coarse[i + 1]), 0);
    }
    return out;
  }

  /** where each zone's body is drawn at sim time t (absolute, or relative to Earth for root Earth) */
  private zonePos(k: number, t: number): V3 {
    const z = this.zones[k];
    const date = new Date(this.mission.launch.getTime() + t * 1000);
    if (this.root === "earth") return compressVec("earth", moonOffsetKm("moon", date), this.boost);
    if (z.b === "moon") return displayPos("moon", date, this.boost);
    return trueHelio(z.b, date);
  }

  /** Earth's place for root-Earth paths (they are drawn relative to it), else the origin. */
  origin(t: number): V3 {
    return this.root === "earth" ? trueHelio("earth", new Date(this.mission.launch.getTime() + t * 1000)) : [0, 0, 0];
  }

  /** Number of vertices flown by sim time t. */
  doneCount(t: number) {
    let lo = 0;
    let hi = this.n;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.times[m] <= t) lo = m + 1;
      else hi = m;
    }
    return lo;
  }

  /**
   * Vertex positions at sim time `now`, relative to origin(now), into out (3 per vertex).
   * `frames` gives the weight of each body's frame (from the timeline): with weight 1 the
   * whole path rides along with that body, so its orbits stay round and the approach comes
   * straight in; with 0 each vertex keeps the place it was flown in (near a body it follows
   * that body only while the craft is around it).
   */
  positions(now: number, out: Float32Array, frames: Partial<Record<BodyId, number>> = {}) {
    const Z = this.zones.length;
    const tau = this.zones.map((z) => Math.max(z.T0, Math.min(z.T1, now)));
    const Dt = this.zones.map((_, k) => this.zonePos(k, tau[k]));
    const W = this.zones.map((z) => frames[z.b] ?? 0);
    const Dn = this.zones.map((_, k) => (W[k] ? this.zonePos(k, now) : Dt[k]));
    const D = this.D;
    for (let i = 0; i < this.n; i++) {
      let x = this.P[i * 3];
      let y = this.P[i * 3 + 1];
      let w = this.P[i * 3 + 2];
      for (let k = 0; k < Z; k++) {
        const c = this.C[i * Z + k];
        const j = (i * Z + k) * 3;
        if (c) {
          x += c * Dt[k][0];
          y += c * Dt[k][1];
          w += c * Dt[k][2];
        }
        const f = W[k];
        if (f) {
          // full frame: + f·(D(now) − D_i); and take back the zone's own share of it
          x += f * (Dn[k][0] - D[j]) - f * c * (Dt[k][0] - D[j]);
          y += f * (Dn[k][1] - D[j + 1]) - f * c * (Dt[k][1] - D[j + 1]);
          w += f * (Dn[k][2] - D[j + 2]) - f * c * (Dt[k][2] - D[j + 2]);
        }
      }
      out[i * 3] = x;
      out[i * 3 + 1] = y;
      out[i * 3 + 2] = w;
    }
  }

  /** The craft at sim time t: absolute scene position. */
  vehicle(t: number, frames: Partial<Record<BodyId, number>> = {}): V3 {
    const tt = Math.max(0, Math.min(this.mission.end, t));
    const s = this.sample(tt);
    const c = this.weights(s.alpha);
    let p = s.base;
    c.forEach((ci, k) => {
      if (!ci) return;
      const z = this.zones[k];
      const tau = Math.max(z.T0, Math.min(z.T1, tt));
      if (tau === tt) return;
      const f = frames[z.b] ?? 0;
      p = add(p, mul(sub(this.zonePos(k, tau), this.zonePos(k, tt)), ci * (1 - f)));
    });
    return add(this.origin(tt), p);
  }
}

const cache = new WeakMap<Mission, Map<number, FlightPath>>();
/** The display path of a mission at a planet size, built once. */
export function flightPath(m: Mission | null, boost: number): FlightPath | null {
  if (!m || !m.ok || !m.traj) return null;
  let byBoost = cache.get(m);
  if (!byBoost) {
    byBoost = new Map();
    cache.set(m, byBoost);
  }
  let p = byBoost.get(boost);
  if (!p) {
    try {
      p = new FlightPath(m, boost);
    } catch (e) {
      console.error(e);
      return null;
    }
    byBoost.set(boost, p);
  }
  return p;
}
