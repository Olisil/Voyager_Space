import { BODIES, bodyBasis, type BodyId, type V3 } from "./bodies";
import { add, Conic, cross, dot, mul, type State } from "./orbits";
import type { Vehicle } from "./vehicles";

/**
 * Powered flight from the vehicle's stages: the rocket equation sets when each stage burns
 * out (so staging, max-Q and orbit insertion happen at believable times), and a gravity-turn
 * profile turns that into altitude, speed and a smooth path into the parking orbit.
 */

const G0 = 9.80665;

export interface MEvent {
  /** seconds after launch */
  t: number;
  label: string;
}

/** Spin rates (rad/s) of bodies a rocket can launch from or land on (Venus turns backwards). */
export const SPIN: Partial<Record<BodyId, number>> = { earth: 7.2921159e-5, moon: 2.6617e-6, mars: 7.0882e-5, mercury: 1.2400e-6, venus: -2.9924e-7 };
/** Sea-level density (kg/m³) and scale height (km), for max-Q. */
const AIR: Partial<Record<BodyId, [number, number]>> = { earth: [1.225, 8.5], mars: [0.02, 11.1], venus: [65, 15.9] };

/** Speed of the ground under a point, as a vector (km/s). */
export function groundVelocity(body: BodyId, r: V3, date: Date): V3 {
  const w = SPIN[body] ?? 0;
  if (!w) return [0, 0, 0];
  return cross(mul(bodyBasis(body, date).z, w), r);
}

interface StageMass {
  name: string;
  dry: number;
  prop: number;
  isp: number;
  thrust: number;
}

/** What is left of the vehicle after launch, for later burns. */
export class Propulsion {
  stages: StageMass[];
  payload: number;
  i: number;
  readonly parallel: boolean;
  constructor(v: Vehicle) {
    this.stages = v.stages
      .filter((s) => s.isp > 0 && s.thrustKN > 0)
      .map((s) => ({ name: s.name, dry: Math.max(0.01, s.massT - s.propT), prop: Math.max(0, Math.min(s.propT, s.massT)), isp: s.isp, thrust: s.thrustKN }));
    this.payload = Math.max(0, v.payloadT);
    this.i = 0;
    this.parallel = this.stages.length > 2 && /booster/i.test(this.stages[0].name);
  }
  /** stage number as people count them (boosters and core are one stage) */
  label(i: number) {
    return i + 1 - (this.parallel && i > 0 ? 1 : 0);
  }
  mass() {
    let m = this.payload;
    for (let j = this.i; j < this.stages.length; j++) m += this.stages[j].dry + this.stages[j].prop;
    return m;
  }
  /** Burn dv (km/s); staging happens on the way when a stage runs dry. Seconds and events from the start. */
  burn(dv: number): { duration: number; events: { dt: number; label: string }[] } {
    let left = dv;
    let t = 0;
    const events: { dt: number; label: string }[] = [];
    for (let guard = 0; left > 1e-6 && guard < 12; guard++) {
      const s = this.stages[this.i];
      if (!s || s.prop <= 1e-6) {
        if (s && this.i < this.stages.length - 1) {
          this.i++;
          continue;
        }
        // nothing left to burn: count it as the spacecraft's own engine, about 3 m/s²
        t += (left * 1000) / 3;
        left = 0;
        break;
      }
      const m0 = this.mass();
      const ve = (s.isp * G0) / 1000;
      const mdot = s.thrust / (s.isp * G0);
      const need = m0 * (1 - Math.exp(-left / ve));
      if (need <= s.prop) {
        t += need / mdot;
        s.prop -= need;
        left = 0;
      } else {
        t += s.prop / mdot;
        left -= ve * Math.log(m0 / (m0 - s.prop));
        s.prop = 0;
        if (this.i < this.stages.length - 1) {
          events.push({ dt: t + 2, label: "STAGE SEP" });
          this.i++;
          t += 6;
          events.push({ dt: t, label: `STAGE ${this.label(this.i)} IGNITION` });
        }
      }
    }
    return { duration: Math.max(20, t), events };
  }
  /** Drop the active stage when another one is stacked above it. */
  jettison(): boolean {
    if (this.i >= this.stages.length - 1) return false;
    this.i++;
    return true;
  }
}

export interface Ascent {
  /** orbit insertion, seconds after launch */
  T: number;
  /** inertial state (km, km/s, body-centred), ground-relative speed and altitude */
  at: (t: number) => State & { speed: number; alt: number };
  events: MEvent[];
  prop: Propulsion;
  ins: State;
}

/**
 * Launch from the unit site vector `site` along `dir` (unit, horizontal) into a circular
 * orbit of radius rIns. `need` is the ideal Δv the stages must deliver (losses included).
 */
export function simulateAscent(o: { body: BodyId; site: V3; dir: V3; rIns: number; need: number; vehicle: Vehicle; preset: string; date: Date }): Ascent {
  const info = BODIES[o.body];
  const R = info.radiusKm;
  const prop = new Propulsion(o.vehicle);
  const st = prop.stages;
  const events: MEvent[] = [{ t: 0, label: "LIFTOFF" }];
  const vRot = dot(groundVelocity(o.body, mul(o.site, R), o.date), o.dir);
  const vCirc = Math.sqrt(info.mu / o.rIns);
  const vIns = vCirc - vRot;

  // ---- staging: ideal Δv over time, piece by piece
  const total = (() => {
    const p = new Propulsion(o.vehicle);
    let dv = 0;
    const stack = (i: number) => p.payload + p.stages.slice(i).reduce((a, s) => a + s.dry + s.prop, 0);
    p.stages.forEach((s, i) => {
      if (p.parallel && i === 0) return;
      const m0 = stack(i);
      dv += ((s.isp * G0) / 1000) * Math.log(m0 / (m0 - s.prop));
    });
    if (p.parallel && p.stages.length > 1) {
      // boosters burn alongside the core: count their extra push roughly
      const b = p.stages[0];
      const m0 = stack(0);
      dv += ((b.isp * G0) / 1000) * Math.log(m0 / (m0 - b.prop)) * 0.8;
    }
    return dv;
  })();
  const need = Math.min(o.need, total > 0 ? total * 0.995 : o.need);
  interface Burn {
    t0: number;
    t1: number;
    dv0: number;
    m0: number;
    mdot: number;
    ve: number;
  }
  const burns: Burn[] = [];
  let t = 0;
  let dv = 0;
  let i = 0;
  let T = 0;
  for (let guard = 0; guard < 20 && st.length; guard++) {
    const both = prop.parallel && i === 0;
    const s = st[i];
    const core = both ? st[1] : null;
    const mdotS = s.thrust / (s.isp * G0);
    const mdotC = core ? core.thrust / (core.isp * G0) : 0;
    const mdot = mdotS + mdotC;
    const ve = ((s.thrust + (core?.thrust ?? 0)) / mdot) / 1000;
    prop.i = i;
    const m0 = prop.mass();
    const dur = s.prop / mdotS;
    const reach = (m0 * (1 - Math.exp(-(need - dv) / ve))) / mdot;
    if (reach <= dur) {
      burns.push({ t0: t, t1: t + reach, dv0: dv, m0, mdot, ve });
      s.prop -= mdotS * reach;
      if (core) core.prop -= mdotC * reach;
      t += reach;
      dv = need;
      T = t;
      break;
    }
    burns.push({ t0: t, t1: t + dur, dv0: dv, m0, mdot, ve });
    dv += ve * Math.log(m0 / (m0 - mdot * dur));
    s.prop = 0;
    if (core) core.prop -= mdotC * dur;
    t += dur;
    if (i >= st.length - 1) {
      T = t;
      break;
    }
    if (both) {
      events.push({ t, label: "BOOSTER SEP" });
      i = 1;
      continue;
    }
    const k = prop.label(i);
    events.push({ t, label: k === 1 ? "MECO" : `STAGE ${k} CUTOFF` });
    events.push({ t: t + 3, label: "STAGE SEP" });
    i++;
    t += 8;
    events.push({ t, label: `STAGE ${prop.label(i)} IGNITION` });
  }
  prop.i = Math.min(i, Math.max(0, st.length - 1));
  if (!st.length) T = 480;
  // A lander lifting off a small world doesn't burn flat out like a heavy rocket off Earth:
  // it pushes at a few times the local gravity, so the climb into orbit takes minutes and
  // runs a long way downrange, as Apollo's ascent stage did. Stretch the burn to that pace.
  const PUSH: Partial<Record<BodyId, number>> = { moon: 4, mercury: 4, mars: 10 };
  const push = PUSH[o.body];
  const kT = push ? Math.max(1, (need * 1000) / push / Math.max(1, T)) : 1;
  if (kT > 1) {
    T *= kT;
    for (const e of events) e.t *= kT;
  }
  if (o.vehicle.refuel && prop.stages.length) {
    const last = prop.stages[prop.stages.length - 1];
    const orig = o.vehicle.stages[o.vehicle.stages.length - 1];
    if (orig) last.prop = Math.min(orig.propT, orig.massT);
  }
  // fraction of the job done at time t (1 at insertion, even when the stages fell short)
  const ideal = (tt: number) => {
    let v = 0;
    for (const b of burns) {
      if (tt < b.t0) break;
      const u = Math.min(tt, b.t1) - b.t0;
      v = b.dv0 + b.ve * Math.log(b.m0 / (b.m0 - b.mdot * u));
    }
    return v;
  };
  const dvEnd = burns.length ? ideal(T / kT) : 1;
  const frac = (tt: number) => (burns.length && dvEnd > 0 ? Math.min(1, ideal(tt / kT) / dvEnd) : Math.min(1, tt / T));

  // ---- gravity turn: speed grows with the work done; the climb is steep at first, then
  // pitches over to level flight (smoothstep in the fraction done, ending at `fe`)
  const hIns = o.rIns - R;
  const dt = 0.25;
  const n = Math.max(2, Math.ceil(T / dt));
  const F = new Float64Array(n + 1);
  for (let j = 0; j <= n; j++) F[j] = frac((j / n) * T);
  const pitch = (f: number, fe: number) => {
    const x = Math.min(1, f / fe);
    return (Math.PI / 2) * (1 - x * x * (3 - 2 * x));
  };
  const run = (fe: number, keep: boolean) => {
    let h = 0;
    let th = 0;
    const H = keep ? new Float64Array(n + 1) : null;
    const TH = keep ? new Float64Array(n + 1) : null;
    const V = keep ? new Float64Array(n + 1) : null;
    const GA = keep ? new Float64Array(n + 1) : null;
    const step = T / n;
    for (let j = 0; j <= n; j++) {
      const f = F[j];
      const v = vIns * Math.pow(f, 1.5);
      const ga = pitch(f, fe);
      if (keep) {
        H![j] = h;
        TH![j] = th;
        V![j] = v;
        GA![j] = ga;
      }
      if (j < n) {
        h += v * Math.sin(ga) * step;
        th += ((v * Math.cos(ga) + vRot) / (R + h)) * step;
      }
    }
    return { h, H, TH, V, GA };
  };
  let lo = 0.05;
  let hi = 1;
  for (let k = 0; k < 40; k++) {
    const m = 0.5 * (lo + hi);
    if (run(m, false).h < hIns) lo = m;
    else hi = m;
  }
  let prof = run(0.5 * (lo + hi), true);
  let scaleH = prof.h > 0 ? hIns / prof.h : 1;
  if (o.body !== "earth") {
    // Off small airless worlds (and thin-aired Mars) the climb is shallow from the start: a
    // short rise, then a long arc that levels off into orbit. Lay the path out as that arc,
    // h = hIns·(1 − (1 − x)²) over the ground covered x, travelled at the rocket's pace.
    const step = T / n;
    const Lc = new Float64Array(n + 1);
    for (let j = 1; j <= n; j++) Lc[j] = Lc[j - 1] + vIns * Math.pow(0.5 * (F[j - 1] + F[j]), 1.5) * step;
    const L = Math.max(1e-6, Lc[n]);
    const DR = 0.82 * L;
    const H2 = new Float64Array(n + 1);
    const TH2 = new Float64Array(n + 1);
    const V2 = new Float64Array(n + 1);
    const GA2 = new Float64Array(n + 1);
    let rot = 0;
    for (let j = 0; j <= n; j++) {
      const x = Lc[j] / L;
      H2[j] = hIns * (1 - (1 - x) ** 2);
      if (j > 0) rot += (vRot / (R + 0.5 * (H2[j] + H2[j - 1]))) * step;
      TH2[j] = (DR * x) / R + rot;
      V2[j] = vIns * Math.pow(F[j], 1.5);
      GA2[j] = Math.atan2(2 * hIns * (1 - x), DR);
    }
    prof = { h: hIns, H: H2, TH: TH2, V: V2, GA: GA2 };
    scaleH = 1;
  }
  const H = prof.H!.map((x) => x * scaleH);
  const TH = prof.TH!;
  const V = prof.V!;
  const GA = prof.GA!;

  // ---- events that depend on the profile
  const air = AIR[o.body];
  if (air) {
    let best = -1;
    let bestQ = 0;
    for (let j = 0; j <= n; j++) {
      const q = 0.5 * air[0] * Math.exp(-H[j] / air[1]) * (V[j] * 1000) ** 2;
      if (q > bestQ) {
        bestQ = q;
        best = j;
      }
    }
    if (best > 0 && bestQ > 500) events.push({ t: (best / n) * T, label: "MAX-Q" });
  }
  if (o.body === "earth" && o.preset !== "starship") {
    const at = o.preset === "saturn-v" || o.preset === "sls" ? 90 : 110;
    const j = H.findIndex((h) => h >= at);
    if (j > 0 && j < n) events.push({ t: (j / n) * T, label: o.preset === "saturn-v" || o.preset === "sls" ? "LES JETTISON" : "FAIRING SEP" });
  }
  events.push({ t: T, label: "ORBIT INSERTION" });
  events.sort((a, b) => a.t - b.t);

  const profile = (tt: number) => {
    const x = Math.max(0, Math.min(n, (tt / T) * n));
    const j = Math.min(n - 1, Math.floor(x));
    const u = x - j;
    const h = H[j] + (H[j + 1] - H[j]) * u;
    const th = TH[j] + (TH[j + 1] - TH[j]) * u;
    const v = V[j] + (V[j + 1] - V[j]) * u;
    const ga = GA[j] + (GA[j + 1] - GA[j]) * u;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const rh: V3 = add(mul(o.site, c), mul(o.dir, s));
    const th2: V3 = add(mul(o.site, -s), mul(o.dir, c));
    const r = mul(rh, R + h);
    // when the climb had to be stretched to reach the orbit's height, so is the climb rate
    const up = v * Math.sin(ga) * scaleH;
    const along = v * Math.cos(ga);
    const vel = add(mul(rh, up), mul(th2, along + vRot));
    return { r, v: vel, speed: Math.hypot(up, along), alt: h };
  };
  const end = profile(T);
  // past insertion the leg carries on along the orbit it was put into, so blends stay smooth
  const orbit = new Conic(end.r, end.v, T, info.mu);
  const at = (tt: number) => {
    if (tt <= T) return profile(tt);
    const s = orbit.at(tt);
    return { r: s.r, v: s.v, speed: vIns, alt: hIns };
  };
  return { T, at, events, prop, ins: { r: end.r, v: end.v } };
}
