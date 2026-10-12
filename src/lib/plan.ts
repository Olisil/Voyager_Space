import { simulateAscent, type Ascent, type MEvent } from "./ascent";
import { BODIES, bodyBasis, surfaceDir, type BodyId, type V3 } from "./bodies";
import { atmosphericEntry, DESCENT_PERI, poweredDescent, onSurface, type Descent } from "./descent";
import { Conic, cross, dot, mul, norm, perp, unit, type State } from "./orbits";
import { Ephem, Trajectory, type Leg, type Root } from "./traj";
import type { Project, Site } from "./types";
import { siteOf } from "./types";

export type { MEvent } from "./ascent";

/** Shared pieces for building missions: launch geometry, legs, phases and events. */

export interface Phase {
  name: string;
  /** seconds after launch */
  t0: number;
  t1: number;
  /** share of the video, seconds */
  video: number;
  /**
   * body whose frame the path is drawn in during this phase (the path rides along with it,
   * so orbits stay round and approaches come straight in); null: the mission's root frame
   */
  frame?: BodyId | null;
}

export interface DvPart {
  label: string;
  dv: number;
}

export interface Mission {
  ok: boolean;
  message?: string;
  launch: Date;
  /** arrival at the destination: orbit insertion there, or touchdown when landing */
  arrival: Date;
  from: BodyId;
  to: BodyId;
  /** frame the flight is drawn in: around Earth, or around the Sun */
  root: Root;
  traj: Trajectory | null;
  /** bodies the flight works with (for the display maps), outer ones first */
  bodies: BodyId[];
  phases: Phase[];
  events: MEvent[];
  dv: DvPart[];
  /** seconds after launch when the flight ends */
  end: number;
  landed: boolean;
}

export const DAY = 86400;
export const lowR = (b: BodyId) => BODIES[b].radiusKm + BODIES[b].lowOrbitKm;
export const dateAt = (launch: Date, t: number) => new Date(launch.getTime() + t * 1000);
export const circV = (b: BodyId, r: number) => Math.sqrt(BODIES[b].mu / r);

export function failed(launch: Date, from: BodyId, to: BodyId, message: string): Mission {
  return { ok: false, message, launch, arrival: launch, from, to, root: "earth", traj: null, bodies: [], phases: [], events: [], dv: [], end: 0, landed: false };
}

/** Δv to reach low orbit from the ground, losses included (km/s). */
export function ascentDv(body: BodyId, site: Site, dir: V3, east: V3) {
  if (body === "earth") return 9.4 - 0.465 * Math.cos((site.lat * Math.PI) / 180) * dot(dir, east);
  return ({ moon: 1.9, mars: 4.1 } as Partial<Record<BodyId, number>>)[body] ?? 4;
}

export interface LaunchGeom {
  s: V3;
  dir: V3;
  n: V3;
  east: V3;
}

/**
 * Launch from a site into the plane that contains `towards` (or due east, or at an
 * inclination). Returns the site direction, the horizontal launch direction and the plane.
 */
export function launchGeom(body: BodyId, site: Site, date: Date, towards: V3 | null, inclinationDeg?: number): LaunchGeom {
  const b = bodyBasis(body, date);
  const s = surfaceDir(b, site.lat, site.lon);
  let east = unit(cross(b.z, s));
  if (norm(east) < 1e-6) east = b.x;
  const north = unit(cross(s, east));
  let dir = east;
  if (inclinationDeg !== undefined) {
    const cosLat = Math.cos((site.lat * Math.PI) / 180);
    const sinAz = Math.cos((inclinationDeg * Math.PI) / 180) / Math.max(1e-6, cosLat);
    if (Math.abs(sinAz) <= 1) {
      const az = Math.PI - Math.asin(sinAz); // southward, as polar launches usually fly
      dir = unit([north[0] * Math.cos(az) + east[0] * Math.sin(az), north[1] * Math.cos(az) + east[1] * Math.sin(az), north[2] * Math.cos(az) + east[2] * Math.sin(az)]);
    }
  } else if (towards) {
    const t = unit(perp(towards, s));
    if (norm(t) > 1e-6) dir = t;
  }
  return { s, dir, n: unit(cross(s, dir)), east };
}

/**
 * Real launches pick the time of day when the body's turn carries the pad under the plane
 * they need, so the rocket can fly close to due east. Search a day for that moment.
 */
export function bestLaunchTime(body: BodyId, site: Site, around: Date, towardsAt: (d: Date) => V3, centred = false): Date {
  if (body !== "earth" && body !== "mars") return around;
  let best = around;
  let bestEast = -2;
  for (let m = 0; m <= 24 * 60; m += 10) {
    const d = new Date(around.getTime() + (m - (centred ? 12 * 60 : 0)) * 60000);
    const g = launchGeom(body, site, d, towardsAt(d));
    const e = dot(g.dir, g.east);
    if (e > bestEast + 1e-9) {
      bestEast = e;
      best = d;
    }
  }
  return best;
}

export function runAscent(p: Project, body: BodyId, date: Date, g: LaunchGeom, rIns: number): Ascent & { dv: number } {
  const site = siteOf(p);
  const dv = ascentDv(body, site, g.dir, g.east);
  const a = simulateAscent({ body, site: g.s, dir: g.dir, rIns, need: dv, vehicle: p.vehicle, preset: p.vehicle.preset, date });
  return { ...a, dv };
}

/** Collects legs, phases and events while a mission is put together. */
export class Plan {
  legs: Leg[] = [];
  phases: Phase[] = [];
  events: MEvent[] = [];
  dv: DvPart[] = [];
  /** add a leg running until t1; `blend` is the half-width of the hand-over into the next leg */
  leg(center: BodyId, at: (t: number) => State, t1: number, blend = 0, tele?: Leg["tele"]) {
    this.legs.push({ center, at, t1, blend, tele });
  }
  conic(center: BodyId, c: Conic, t1: number, blend = 0) {
    this.leg(center, (t) => c.at(t), t1, blend);
  }
  phase(name: string, t0: number, t1: number, video: number) {
    if (t1 > t0) this.phases.push({ name, t0, t1, video });
  }
  event(t: number, label: string) {
    this.events.push({ t, label });
  }
  addEvents(list: { t: number; label: string }[]) {
    for (const e of list) this.events.push(e);
  }
  done(o: { launch: Date; from: BodyId; to: BodyId; root: Root; bodies: BodyId[]; arrival: number; landed: boolean }): Mission {
    const end = this.legs[this.legs.length - 1].t1;
    const ephem = new Ephem(o.launch, o.root, [-DAY, end + DAY]);
    const traj = new Trajectory(o.root, ephem, this.legs);
    this.events.sort((a, b) => a.t - b.t);
    for (const ph of this.phases) {
      const c = traj.centerAt(0.5 * (ph.t0 + ph.t1));
      ph.frame = c === "sun" || (o.root === "earth" && c === "earth") ? null : c;
    }
    return {
      ok: true,
      launch: o.launch,
      arrival: dateAt(o.launch, o.arrival),
      from: o.from,
      to: o.to,
      root: o.root,
      traj,
      bodies: o.bodies,
      phases: this.phases,
      events: this.events.filter((e) => e.t <= end + 1),
      dv: this.dv,
      end,
      landed: o.landed,
    };
  }
}

/**
 * Landing at the end of a plan. `from` is the state (relative to the body) where the
 * descent starts: the periapsis of the descent orbit, or the entry interface.
 * Adds the legs, events and phases, and the time spent on the ground afterwards.
 */
export function addLanding(plan: Plan, body: BodyId, launch: Date, t0: number, from: State, airless: boolean): number {
  const date = dateAt(launch, t0);
  const d: Descent = airless ? poweredDescent(body, from.r, from.v, date) : atmosphericEntry(body, from.r, from.v, date);
  plan.leg(body, (t) => d.at(t - t0), t0 + d.T, Math.min(20, 0.02 * d.T), (t) => d.tele(t - t0));
  for (const e of d.events) plan.event(t0 + e.dt, e.label);
  const td = t0 + d.T;
  const rest = onSurface(body, d.at(d.T).r, launch, td);
  const hold = Math.max(600, 0.4 * d.T);
  plan.leg(body, rest, td + hold, 0, () => ({ speed: 0, alt: 0 }));
  plan.phase(airless ? "Powered descent" : "Entry and descent", t0, td, airless ? 5 : 6);
  plan.phase(body === "earth" ? "Splashdown" : "On the surface", td, td + hold, 2);
  return td;
}

/**
 * Landing on an airless body from a circular low orbit: a small burn lowers the periapsis
 * to 15 km half an orbit ahead, and the powered descent starts there.
 */
export function orbitLanding(plan: Plan, body: BodyId, launch: Date, orbit: Conic, tStart: number): number {
  const mu = BODIES[body].mu;
  const s = orbit.at(tStart);
  const rA = norm(s.r);
  const rP = BODIES[body].radiusKm + DESCENT_PERI;
  const a = (rA + rP) / 2;
  const vA = Math.sqrt(mu * (2 / rA - 1 / a));
  const doi = new Conic(s.r, mul(unit(s.v), vA), tStart, mu);
  const tPdi = tStart + doi.period / 2;
  plan.conic(body, orbit, tStart, 15);
  plan.event(tStart - 15, "DESCENT ORBIT");
  plan.conic(body, doi, tPdi, 8);
  plan.phase("Descent orbit", tStart, tPdi, 2.5);
  const td = addLanding(plan, body, launch, tPdi, doi.at(tPdi), true);
  plan.dv.push({ label: "Descent to the surface", dv: norm(s.v) - vA + norm(doi.at(tPdi).v) + 0.3 });
  return td;
}

/** A Conic from a state, for brevity. */
export const conicOf = (s: State, t0: number, body: BodyId) => new Conic(s.r, s.v, t0, BODIES[body].mu);
/** Unit horizontal direction of motion of a state. */
export const along = (s: State): V3 => unit(perp(s.v, unit(s.r)));
export const scaleTo = (v: V3, k: number): V3 => mul(unit(v), k);
