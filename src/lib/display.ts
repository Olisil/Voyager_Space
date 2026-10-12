import { SPIN } from "./ascent";
import { AU_KM, BODIES, bodyBasis, compress, compressVec, displayPos, displayRadius, moonOffsetKm, SOFT, trueHelio, type BodyId, type V3 } from "./bodies";
import { add, dot, mul, norm, sub, unit } from "./orbits";
import type { Mission } from "./plan";

/**
 * From true positions to the picture. Planets are drawn enlarged, so near a body distances
 * are compressed with its √-scale (a 200 km orbit shows around the enlarged Earth); far away
 * the true heliocentric scale holds. Each body's map hands over smoothly to its parent's
 * (a smooth maximum of the two distances over a bounded band), so the path has no corners
 * anywhere, and near each body only its own map counts: a craft on the pad or on the ground
 * is drawn exactly on the drawn globe.
 *
 * Near a body the path is also drawn in that body's frame: parking orbits stay round while
 * the planet moves. Each vertex follows its body only while the craft is around it; the
 * rest of the path keeps the place it was flown in. Seen from one body's frame, the other
 * bodies' enlarged neighbourhoods are held still relative to it (see heldTime), so the path
 * out there is not dragged along by the two bodies' motion against each other.
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

/**
 * A smooth maximum of 0 and x that is exactly max(0, x) once |x| ≥ k, with its slope.
 * The bend is spread as (1 − (x/k)²)³ over −k…k, so the result is smooth to the third
 * derivative and leaves everything outside that band untouched.
 */
function softMax0(x: number, k: number): [number, number] {
  if (x <= -k) return [0, 0];
  if (x >= k) return [x, 1];
  const u = x / k;
  const u2 = u * u;
  const u4 = u2 * u2;
  const F = u * (1 - u2 + 0.6 * u4 - (u4 * u2) / 7);
  const G = u2 * (0.5 - u2 / 4 + u4 / 10 - (u4 * u2) / 56);
  return [(k * (35 * (G - 93 / 280) + 16 * (u + 1))) / 32, (35 * F + 16) / 32];
}

/**
 * How widely (in the log of the distance ratio) a body's enlarged neighbourhood hands over to
 * its parent's picture: a long, gentle bend, so paths leaving or reaching a body do not kink.
 * The Moon's band reaches back to Earth's neighbourhood; it is let go of close to Earth (see
 * moonOver), and stops well short of low lunar orbit on the inside.
 */
const HAND_PLANET = 1.2;
const HAND_MOON = 1.4;

/**
 * Hand over from the parent's picture P to body b's own (centre D, true offset δ, own distance g):
 * a smooth maximum of the two distances, exact on either side of the band: near the body only
 * its own map counts, far from it only the parent's.
 */
function smax(P: V3, D: V3, delta: V3, g: number, k: number): V3 {
  const q = sub(P, D);
  const Q = norm(q);
  const dh = unit(delta);
  if (Q < 1e-18) return add(D, mul(dh, g));
  const [S, slope] = softMax0(Math.log(Q / g), k);
  const w = 1 - slope;
  const m = g * Math.exp(S);
  const dir = w >= 1 ? dh : w <= 0 ? mul(q, 1 / Q) : unit(add(mul(dh, w), mul(q, (1 - w) / Q)));
  return add(D, mul(dir, m));
}

/** 0 → 1 over 0…1, smooth to the second derivative */
const smoother = (x: number) => {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * t * (10 - 15 * t + 6 * t * t);
};

/** 1 deep in a body's own neighbourhood (x = ln(Q/g) ≤ −4: low orbits, the way out to a million km or so), 0 from x ≥ −2.5 */
const deep = (x: number) => 1 - smoother((x + 4) / 1.5);

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
  /** the picture as seen from outside every body's frame */
  base: V3;
  /** per zone: the picture as seen in that body's frame, where it differs (see heldTime) */
  alt: (V3 | undefined)[];
  alpha: number[];
  D: V3[];
}

/**
 * How long (s) a body's neighbourhood takes to come to rest, as seen from another body's frame,
 * after the craft leaves it (or to start moving before the craft arrives).
 */
const EASE_MOON = 4 * 3600;
const EASE_PLANET = 4 * 86400;
/** 0…1 → 0…8/15: slope 1 → 0, smooth at both ends */
const ease = (s: number) => s - (2 / 3) * s * s * s + (s * s * s * s * s) / 5;

/**
 * Near the ground the path turns with the body: the climb from the pad stays on the pad while
 * the craft climbs, and after touchdown the descent stays on the spot the craft sits on.
 */
interface Attach {
  body: BodyId;
  kind: "ascent" | "landing";
  /** end of the ascent / touchdown (s after launch) */
  t: number;
  idx: Int32Array;
  rho: Float32Array;
  /** offsets (display units) from the body's centre, as drawn at the vertex's moment */
  off: Float64Array;
}

export class FlightPath {
  readonly root: "earth" | "sun";
  readonly n: number;
  readonly times: Float64Array;
  private P: Float64Array;
  private C: Float32Array;
  /** where each zone's body was drawn at each vertex's moment */
  private D: Float64Array;
  /** what a zone's frame follows for the rest of the path (the body's true place, for the Moon around the Sun) */
  private F: Float64Array;
  readonly zones: Zone[];
  private maps = new Map<BodyId, Radial>();
  private planets: BodyId[];
  private moon: boolean;
  private attach: Attach[] = [];
  /** the Moon's zone, or −1 */
  private moonZone: number;
  /** per zone: the picture in that body's frame minus the outside picture, per vertex (null when the same throughout) */
  private alt: (Float64Array | null)[] = [];
  /** zone times are known (the pictures held still need them) */
  private ready = false;

  constructor(
    readonly mission: Mission,
    readonly boost: number,
  ) {
    const m = mission;
    this.root = m.root;
    this.moon = m.bodies.includes("moon");
    // planets in the order their maps are applied: where the flight starts first, where it ends last
    const planetOf = (b: BodyId): BodyId => (b === "moon" ? "earth" : b);
    const rank = (b: BodyId) => (b === planetOf(m.from) ? 0 : b === planetOf(m.to) ? 2 : 1);
    this.planets = m.root === "sun" ? m.bodies.filter((b) => b !== "moon").sort((a, b) => rank(a) - rank(b)) : [];
    for (const b of m.bodies) this.maps.set(b, radialMap(b, boost, knee(b, this.moon)));
    const zb = m.root === "sun" ? m.bodies : m.bodies.filter((b) => b === "moon");
    this.zones = zb.map((b): Zone => {
      const [near, far] = hold(b);
      return { b, parent: -1, near, far, T0: Infinity, T1: -Infinity };
    });
    const ie = this.zones.findIndex((z) => z.b === "earth");
    const im = this.zones.findIndex((z) => z.b === "moon");
    if (im >= 0 && ie >= 0) this.zones[im].parent = ie;
    this.moonZone = im;

    const samples = this.sampleAll();
    this.n = samples.length;
    this.times = new Float64Array(this.n);
    this.P = new Float64Array(this.n * 3);
    this.C = new Float32Array(this.n * this.zones.length);
    this.D = new Float64Array(this.n * this.zones.length * 3);
    this.F = new Float64Array(this.n * this.zones.length * 3);
    this.alt = this.zones.map((_, k) => (samples.some((s) => s.alt[k]) ? new Float64Array(this.n * 3) : null));
    samples.forEach((s, i) => {
      this.times[i] = s.t;
      s.alt.forEach((a, k) => {
        if (a) this.alt[k]!.set(sub(a, s.base), i * 3);
      });
      const c = this.weights(s.alpha);
      let p = s.base;
      c.forEach((ci, z) => {
        this.C[i * this.zones.length + z] = ci;
        this.D.set(s.D[z], (i * this.zones.length + z) * 3);
        this.F.set(this.framePos(z, s.t, s.D[z]), (i * this.zones.length + z) * 3);
        p = sub(p, mul(s.D[z], ci));
      });
      this.P.set(p, i * 3);
    });
    this.attach = this.groundAttach(samples);
  }

  /** frame reference of zone k at sim time t (Dk: where its body is drawn then) */
  private framePos(k: number, t: number, Dk: V3): V3 {
    // the Moon is drawn far out from Earth (its distance compressed with Earth's map); a path
    // around the Sun that follows it would take on its monthly swing. Follow its true place.
    if (this.root === "sun" && this.zones[k].b === "moon") return trueHelio("moon", new Date(this.mission.launch.getTime() + t * 1000));
    return Dk;
  }

  private groundAttach(samples: Sample[]): Attach[] {
    const m = this.mission;
    const tr = m.traj!;
    const out: Attach[] = [];
    const zoneOf = (b: BodyId) => this.zones.findIndex((z) => z.b === b);
    const make = (body: BodyId, kind: Attach["kind"], t: number, rhoOf: (s: Sample) => number) => {
      if (!SPIN[body]) return;
      const k = zoneOf(body);
      if (k < 0 && !(this.root === "earth" && body === "earth")) return;
      const idx: number[] = [];
      const rho: number[] = [];
      const off: number[] = [];
      samples.forEach((s, i) => {
        const r = rhoOf(s);
        if (r <= 1e-4) return;
        idx.push(i);
        rho.push(r);
        const D = k < 0 ? ([0, 0, 0] as V3) : s.D[k];
        off.push(s.base[0] - D[0], s.base[1] - D[1], s.base[2] - D[2]);
      });
      if (idx.length) out.push({ body, kind, t, idx: Int32Array.from(idx), rho: Float32Array.from(rho), off: Float64Array.from(off) });
    };
    const asc = m.phases[0] && /ascent/i.test(m.phases[0].name) ? m.phases[0].t1 : 0;
    if (asc > 0) make(m.from, "ascent", asc, (s) => (s.t <= asc ? 1 - ss(s.t / asc) : 0));
    if (m.landed) {
      const td = (m.arrival.getTime() - m.launch.getTime()) / 1000;
      const R = BODIES[m.to].radiusKm;
      make(m.to, "landing", td, (s) => {
        if (s.t <= asc) return 0;
        const d = norm(sub(tr.at(s.t).r, tr.ephem.at(m.to, s.t).r));
        return 1 - ss((d - R) / (0.6 * R));
      });
    }
    return out;
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
    const alt: (V3 | undefined)[] = this.zones.map(() => undefined);
    const zoneOf = (b: BodyId) => this.zones.findIndex((z) => z.b === b);
    const setZone = (b: BodyId, d: number, Db: V3) => {
      const k = zoneOf(b);
      if (k < 0) return;
      const z = this.zones[k];
      alpha[k] = 1 - ss((Math.log(d) - Math.log(z.near)) / (Math.log(z.far) - Math.log(z.near)));
      D[k] = Db;
    };
    // where body b is taken to be at t: itself, or, seen from `frame`'s frame, held still
    // relative to it (see heldTime)
    const where = (b: BodyId, frame: BodyId | null): V3 => {
      const bt = tr.ephem.at(b, t).r;
      if (!frame || frame === b) return bt;
      const u = this.heldTime(zoneOf(b), t);
      if (u === t) return bt;
      return add(tr.ephem.at(frame, t).r, sub(tr.ephem.at(b, u).r, tr.ephem.at(frame, u).r));
    };
    let P: V3;
    if (this.root === "sun") {
      // each planet enlarges its own neighbourhood of the true picture, one after the other,
      // the destination last. Where two neighbourhoods reach each other (Venus and Earth can be
      // close) a planet's push is let go of deep in another's neighbourhood, so the ground and
      // low orbits around every planet stay exactly in that planet's own map.
      const planets = (frame: BodyId | null): V3 => {
        const near = this.planets.map((b) => {
          const bp = where(b, frame);
          const Db = mul(bp, 1 / AU_KM);
          const delta = sub(x, bp);
          const d = norm(delta);
          const g = radial(this.maps.get(b)!, d);
          if (!frame) setZone(b, d, Db);
          return { Db, delta, g, deep: deep(Math.log(d / AU_KM / g)) };
        });
        let Q = mul(x, 1 / AU_KM);
        near.forEach((a, i) => {
          let keep = 1;
          near.forEach((o, j) => {
            if (j !== i) keep *= 1 - o.deep;
          });
          if (keep <= 0) return;
          const L = smax(Q, a.Db, a.delta, a.g, HAND_PLANET);
          Q = keep >= 1 ? L : add(Q, mul(sub(L, Q), keep));
        });
        return Q;
      };
      P = planets(null);
      // in a planet's own frame the other planets' neighbourhoods are held still relative to it
      if (this.planets.length > 1)
        for (const f of this.planets) {
          if (this.planets.every((b) => b === f || this.heldTime(zoneOf(b), t) === t)) continue;
          alt[zoneOf(f)] = planets(f);
        }
    } else {
      P = compressVec("earth", x, this.boost);
    }
    if (this.moon) {
      // Earth's place (true, and as drawn: zero for paths drawn around Earth)
      const ep: V3 = this.root === "sun" ? tr.ephem.at("earth", t).r : [0, 0, 0];
      const E = mul(ep, 1 / AU_KM);
      const dE = norm(sub(x, ep));
      // the Moon relative to Earth at time u, as drawn, and the craft's offset from it
      const moonAt = (u: number) => {
        const off = this.root === "sun" ? sub(tr.ephem.at("moon", u).r, tr.ephem.at("earth", u).r) : tr.ephem.at("moon", u).r;
        return { Dm: add(E, compressVec("earth", off, this.boost)), delta: sub(x, add(ep, off)) };
      };
      const km = this.moonZone;
      const now = moonAt(t);
      setZone("moon", norm(now.delta), now.Dm);
      // seen from outside the Moon's frame its neighbourhood is held still relative to Earth
      const u = this.heldTime(km, t);
      const held = u === t ? now : moonAt(u);
      const over = (Q: V3, w: typeof now) => this.moonOver(Q, w.Dm, w.delta, norm(w.delta), dE);
      if (u !== t) alt[km] = over(P, now);
      P = over(P, held);
      this.zones.forEach((_, k) => {
        if (k !== km && alt[k]) alt[k] = over(alt[k]!, held);
      });
    }
    return { t, base: P, alt, alpha, D };
  }

  /**
   * Seen from another body's frame, a body's neighbourhood is held still (relative to that
   * body) where it was when the craft left it, or where it will be when the craft arrives, so
   * the path out there is not dragged along by the two bodies' motion against each other. It
   * comes to rest smoothly; while the craft is in the body's zone it moves with the body.
   */
  private heldTime(k: number, t: number): number {
    if (!this.ready || k < 0) return t;
    const z = this.zones[k];
    if (!(z.T1 > z.T0) && z.T0 === 0) return t;
    const h = z.b === "moon" ? EASE_MOON : EASE_PLANET;
    if (t < z.T0) return z.T0 - h * ease(Math.min(1, (z.T0 - t) / h));
    if (t > z.T1) return z.T1 + h * ease(Math.min(1, (t - z.T1) / h));
    return t;
  }

  /**
   * The Moon's neighbourhood in Earth's picture P (Moon drawn at Dm, craft δ from the Moon, d
   * km from it and dE km from Earth). Its far band reaches back towards Earth; close to Earth
   * it is let go of, so the ground and low orbits there stay exactly in Earth's picture.
   */
  private moonOver(P: V3, Dm: V3, delta: V3, d: number, dE: number): V3 {
    const L = smax(P, Dm, delta, radial(this.maps.get("moon")!, d), HAND_MOON);
    const R = BODIES.earth.radiusKm;
    const keep = smoother(Math.log(dE / (3 * R)) / Math.log(8 / 3));
    return keep >= 1 ? L : add(P, mul(sub(L, P), keep));
  }

  private sampleAll(): Sample[] {
    const m = this.mission;
    const T = m.end;
    const seeds = new Set<number>([0, T]);
    for (const ph of m.phases) for (let j = 0; j <= 48; j++) seeds.add(ph.t0 + ((ph.t1 - ph.t0) * j) / 48);
    for (const l of m.traj!.legs) for (const t of [l.t1 - l.blend, l.t1, l.t1 + l.blend]) seeds.add(t);
    for (const e of m.events) seeds.add(e.t);
    const ts = [...seeds].filter((t) => t >= 0 && t <= T).sort((a, b) => a - b);
    // when the craft is in each zone, and a fixed frame per zone to judge shapes in
    for (const s of ts.map((t) => this.sample(t)))
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
    this.ready = true;
    const coarse = ts.map((t) => this.sample(t));
    const ref = this.zones.map((z) => this.sample(z.T0).D[this.zones.indexOf(z)] ?? [0, 0, 0]);
    // the shape in fixed zone frames, as seen from outside them all (or from zone `view`'s frame)
    const shape = (s: Sample, view = -1): V3 => {
      const c = this.weights(s.alpha);
      let p = view >= 0 && s.alt[view] ? s.alt[view]! : s.base;
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
    let budget = 40000;
    const COS = Math.cos((0.45 * Math.PI) / 180);
    // fine enough where the three points A, M, B do not yet lie on a gentle curve
    const coarseAt = (A: V3, M: V3, B: V3) => {
      const AM = sub(M, A);
      const MB = sub(B, M);
      const la = norm(AM);
      const lb = norm(MB);
      const scale = scaleAt(M);
      const cos = la > 0 && lb > 0 ? dot(AM, MB) / (la * lb) : 1;
      const dev = norm(sub(M, mul(add(A, B), 0.5)));
      return cos < COS || dev > 0.0004 * scale || la + lb > 0.03 * scale;
    };
    const refine = (a: Sample, b: Sample, depth: number) => {
      if (depth > 18 || b.t - a.t < 0.01 || budget <= 0) return;
      const mid = this.sample(0.5 * (a.t + b.t));
      // every picture must be smooth: from outside, and from each body's frame where it differs
      let split = coarseAt(shape(a), shape(mid), shape(b));
      for (let k = 0; !split && k < this.zones.length; k++)
        if (a.alt[k] || mid.alt[k] || b.alt[k]) split = coarseAt(shape(a, k), shape(mid, k), shape(b, k));
      if (split) {
        budget--;
        refine(a, mid, depth + 1);
        out.push(mid);
        refine(mid, b, depth + 1);
      }
    };
    for (let i = 0; i < coarse.length; i++) {
      out.push(coarse[i]);
      if (i < coarse.length - 1) refine(coarse[i], coarse[i + 1], 0);
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
   * Vertex positions at sim time `now`, relative to origin(now) + base, into out (3 per vertex).
   * `frames` gives the weight of each body's frame (from the timeline): with weight 1 the
   * whole path rides along with that body, so its orbits stay round and the approach comes
   * straight in; with 0 each vertex keeps the place it was flown in (near a body it follows
   * that body only while the craft is around it).
   */
  positions(now: number, out: Float32Array, frames: Partial<Record<BodyId, number>> = {}, base: V3 = [0, 0, 0]) {
    const Z = this.zones.length;
    const tau = this.zones.map((z) => Math.max(z.T0, Math.min(z.T1, now)));
    const Dt = this.zones.map((_, k) => this.zonePos(k, tau[k]));
    const W = this.zones.map((z) => frames[z.b] ?? 0);
    const Dn = this.zones.map((_, k) => (W[k] ? this.zonePos(k, now) : Dt[k]));
    const Fn = this.zones.map((_, k) => (W[k] ? this.framePos(k, now, Dn[k]) : Dn[k]));
    const F = this.F;
    // in a body's frame, the picture as seen from it (other bodies' neighbourhoods held still)
    const views = this.alt.map((a, k) => (a && W[k] ? { a, f: W[k] } : null)).filter((v) => v) as { a: Float64Array; f: number }[];
    for (let i = 0; i < this.n; i++) {
      let x = this.P[i * 3];
      let y = this.P[i * 3 + 1];
      let w = this.P[i * 3 + 2];
      for (const v of views) {
        x += v.f * v.a[i * 3];
        y += v.f * v.a[i * 3 + 1];
        w += v.f * v.a[i * 3 + 2];
      }
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
          // the frame: the zone's share follows the body as drawn, the rest its frame reference
          x += f * (c * (Dn[k][0] - Dt[k][0]) + (1 - c) * (Fn[k][0] - F[j]));
          y += f * (c * (Dn[k][1] - Dt[k][1]) + (1 - c) * (Fn[k][1] - F[j + 1]));
          w += f * (c * (Dn[k][2] - Dt[k][2]) + (1 - c) * (Fn[k][2] - F[j + 2]));
        }
      }
      // relative to `base` (near the camera), so the single-precision copy stays exact up close
      out[i * 3] = x - base[0];
      out[i * 3 + 1] = y - base[1];
      out[i * 3 + 2] = w - base[2];
    }
    // near the ground the path turns with the body (see Attach)
    for (const a of this.attach) {
      const wspin = SPIN[a.body] ?? 0;
      const pole = bodyBasis(a.body, new Date(this.mission.launch.getTime() + now * 1000)).z;
      for (let n = 0; n < a.idx.length; n++) {
        const i = a.idx[n];
        const ti = this.times[i];
        const turn = a.kind === "ascent" ? Math.min(now, a.t) - ti : Math.max(now, a.t) - Math.max(ti, a.t);
        const ang = a.rho[n] * wspin * turn;
        if (!ang) continue;
        const o: V3 = [a.off[n * 3], a.off[n * 3 + 1], a.off[n * 3 + 2]];
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const kx = pole[1] * o[2] - pole[2] * o[1];
        const ky = pole[2] * o[0] - pole[0] * o[2];
        const kz = pole[0] * o[1] - pole[1] * o[0];
        const kd = (pole[0] * o[0] + pole[1] * o[1] + pole[2] * o[2]) * (1 - c);
        out[i * 3] += o[0] * (c - 1) + kx * s + pole[0] * kd;
        out[i * 3 + 1] += o[1] * (c - 1) + ky * s + pole[1] * kd;
        out[i * 3 + 2] += o[2] * (c - 1) + kz * s + pole[2] * kd;
      }
    }
  }

  /** The craft at sim time t: absolute scene position. */
  vehicle(t: number, frames: Partial<Record<BodyId, number>> = {}): V3 {
    const tt = Math.max(0, Math.min(this.mission.end, t));
    const s = this.sample(tt);
    const c = this.weights(s.alpha);
    let p = s.base;
    s.alt.forEach((a, k) => {
      const f = frames[this.zones[k].b] ?? 0;
      if (a && f) p = add(p, mul(sub(a, s.base), f));
    });
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
