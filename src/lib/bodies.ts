import * as A from "astronomy-engine";

/**
 * Solar-system bodies, where they are and which way they face, from astronomy-engine
 * (VSOP87-based planets, the Moon and Jupiter's Galilean moons, IAU rotation models).
 *
 * Scene frame: 1 unit = 1 AU, heliocentric, ecliptic J2000, with Y towards ecliptic north
 * (three.js is Y-up): scene = (ecl.x, ecl.z, -ecl.y).
 *
 * Planets are drawn enlarged (radius ∝ √km) and anything orbiting a body — moons, parking
 * orbits, a spacecraft near a planet — is pulled in with the same √ compression, so the
 * Moon, a low Earth orbit and Earth itself all stay visible together.
 */
export type BodyId =
  | "sun"
  | "mercury"
  | "venus"
  | "earth"
  | "moon"
  | "mars"
  | "jupiter"
  | "io"
  | "europa"
  | "ganymede"
  | "callisto"
  | "saturn"
  | "uranus"
  | "neptune";

export interface BodyInfo {
  id: BodyId;
  name: string;
  radiusKm: number;
  /** gravitational parameter, km³/s² */
  mu: number;
  parent: BodyId | null;
  texture: string;
  /** colour for orbit lines, labels and fallbacks */
  color: string;
  ae: A.Body | null;
  /** low orbit altitude used for parking and capture, km */
  lowOrbitKm: number;
}

export const BODIES: Record<BodyId, BodyInfo> = {
  sun: { id: "sun", name: "Sun", radiusKm: 695700, mu: 1.32712440018e11, parent: null, texture: "sun.jpg", color: "#ffcc66", ae: A.Body.Sun, lowOrbitKm: 0 },
  mercury: { id: "mercury", name: "Mercury", radiusKm: 2439.7, mu: 22032, parent: "sun", texture: "mercury.jpg", color: "#a9a39b", ae: A.Body.Mercury, lowOrbitKm: 200 },
  venus: { id: "venus", name: "Venus", radiusKm: 6051.8, mu: 324859, parent: "sun", texture: "venus_atmosphere.jpg", color: "#e8c98a", ae: A.Body.Venus, lowOrbitKm: 300 },
  earth: { id: "earth", name: "Earth", radiusKm: 6371, mu: 398600.4418, parent: "sun", texture: "earth_day.jpg", color: "#6fa8ff", ae: A.Body.Earth, lowOrbitKm: 200 },
  moon: { id: "moon", name: "Moon", radiusKm: 1737.4, mu: 4902.8, parent: "earth", texture: "moon.jpg", color: "#c8c8c8", ae: A.Body.Moon, lowOrbitKm: 100 },
  mars: { id: "mars", name: "Mars", radiusKm: 3389.5, mu: 42828, parent: "sun", texture: "mars.jpg", color: "#e0714b", ae: A.Body.Mars, lowOrbitKm: 300 },
  jupiter: { id: "jupiter", name: "Jupiter", radiusKm: 69911, mu: 126686534, parent: "sun", texture: "jupiter.jpg", color: "#d9b38c", ae: A.Body.Jupiter, lowOrbitKm: 5000 },
  io: { id: "io", name: "Io", radiusKm: 1821.6, mu: 5959.9, parent: "jupiter", texture: "moon.jpg", color: "#e6d36b", ae: null, lowOrbitKm: 100 },
  europa: { id: "europa", name: "Europa", radiusKm: 1560.8, mu: 3202.7, parent: "jupiter", texture: "moon.jpg", color: "#d8cbb0", ae: null, lowOrbitKm: 100 },
  ganymede: { id: "ganymede", name: "Ganymede", radiusKm: 2634.1, mu: 9887.8, parent: "jupiter", texture: "moon.jpg", color: "#b7aa98", ae: null, lowOrbitKm: 100 },
  callisto: { id: "callisto", name: "Callisto", radiusKm: 2410.3, mu: 7179.3, parent: "jupiter", texture: "moon.jpg", color: "#8f8475", ae: null, lowOrbitKm: 100 },
  saturn: { id: "saturn", name: "Saturn", radiusKm: 58232, mu: 37931187, parent: "sun", texture: "saturn.jpg", color: "#e3cf9b", ae: A.Body.Saturn, lowOrbitKm: 5000 },
  uranus: { id: "uranus", name: "Uranus", radiusKm: 25362, mu: 5793939, parent: "sun", texture: "uranus.jpg", color: "#9fe3e8", ae: A.Body.Uranus, lowOrbitKm: 3000 },
  neptune: { id: "neptune", name: "Neptune", radiusKm: 24622, mu: 6836529, parent: "sun", texture: "neptune.jpg", color: "#5b7cff", ae: A.Body.Neptune, lowOrbitKm: 3000 },
};
export const BODY_IDS = Object.keys(BODIES) as BodyId[];
export const PLANETS: BodyId[] = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"];

export const AU_KM = 149597870.7;
export type V3 = [number, number, number];

const eqjToEcl = A.Rotation_EQJ_ECL();
/** astronomy-engine EQJ vector (AU) → scene frame */
export function toScene(v: { x: number; y: number; z: number }): V3 {
  const e = A.RotateVector(eqjToEcl, new A.Vector(v.x, v.y, v.z, new A.AstroTime(0)));
  return [e.x, e.z, -e.y];
}
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

// ---------- display scale ----------

/** Planet size: display radius (AU) = SIZE · √(radius km) · boost. Earth ≈ 0.012 AU at boost 1. */
const SIZE = 1.5e-4;
export function displayRadius(id: BodyId, boost = 1): number {
  const k = id === "sun" ? 1 : boost;
  return SIZE * Math.sqrt(BODIES[id].radiusKm) * k;
}

/**
 * Distance from a body's centre (true km) → display distance (AU), for moons, orbits and
 * spacecraft near that body. Monotonic, equals the display radius at the surface.
 */
export function compress(id: BodyId, distKm: number, boost = 1): number {
  const R = BODIES[id].radiusKm;
  const Rd = displayRadius(id, boost);
  return Rd * (1 + 1.4 * Math.sqrt(Math.max(0, distKm - R) / R));
}
/** a body-centred vector in km → display offset (AU) */
export function compressVec(id: BodyId, vKm: V3, boost = 1): V3 {
  const d = len(vKm);
  if (d < 1e-9) return [0, 0, 0];
  return scale(vKm, compress(id, d, boost) / d);
}

// ---------- positions ----------

const time = (d: Date) => A.MakeTime(d);

/** True heliocentric position (scene frame, AU). */
export function trueHelio(id: BodyId, date: Date): V3 {
  const info = BODIES[id];
  if (id === "sun") return [0, 0, 0];
  const t = time(date);
  if (info.ae !== null && info.ae !== A.Body.Moon) return toScene(A.HelioVector(info.ae, t));
  if (id === "moon") return add(toScene(A.HelioVector(A.Body.Earth, t)), toScene(A.GeoMoon(t)));
  const jm = A.JupiterMoons(t);
  const m = { io: jm.io, europa: jm.europa, ganymede: jm.ganymede, callisto: jm.callisto }[id as "io"]!;
  return add(toScene(A.HelioVector(A.Body.Jupiter, t)), toScene(m));
}

/** Body-centred position of a moon relative to its parent (scene frame, km). */
export function moonOffsetKm(id: BodyId, date: Date): V3 {
  const t = time(date);
  if (id === "moon") return scale(toScene(A.GeoMoon(t)), AU_KM);
  const jm = A.JupiterMoons(t);
  const m = { io: jm.io, europa: jm.europa, ganymede: jm.ganymede, callisto: jm.callisto }[id as "io"];
  return m ? scale(toScene(m), AU_KM) : [0, 0, 0];
}

/** Where a body is drawn: planets at their true place, moons compressed around their planet. */
export function displayPos(id: BodyId, date: Date, boost = 1): V3 {
  const p = BODIES[id].parent;
  if (!p || p === "sun") return trueHelio(id, date);
  return add(trueHelio(p, date), compressVec(p, moonOffsetKm(id, date), boost));
}

/** Heliocentric state (scene frame): position AU, velocity km/s. */
export function helioState(id: BodyId, date: Date): { r: V3; v: V3 } {
  const t = time(date);
  if (id === "moon") {
    const e = A.HelioState(A.Body.Earth, t);
    const m = A.GeoMoonState(t);
    const r = toScene({ x: e.x + m.x, y: e.y + m.y, z: e.z + m.z });
    const v = toScene({ x: e.vx + m.vx, y: e.vy + m.vy, z: e.vz + m.vz });
    return { r, v: scale(v, AU_KM / 86400) };
  }
  const s = A.HelioState(BODIES[id].ae ?? A.Body.Earth, t);
  return { r: toScene({ x: s.x, y: s.y, z: s.z }), v: scale(toScene({ x: s.vx, y: s.vy, z: s.vz }), AU_KM / 86400) };
}

// ---------- orientation ----------

export interface Basis {
  /** body-fixed axes in the scene frame: X = prime meridian at the equator, Z = north pole */
  x: V3;
  y: V3;
  z: V3;
}

/** IAU orientation of a body (pole and spin) at a date, in the scene frame. */
export function bodyBasis(id: BodyId, date: Date): Basis {
  const info = BODIES[id];
  const ae = info.ae ?? (info.parent === "jupiter" ? A.Body.Jupiter : A.Body.Earth);
  const axis = A.RotationAxis(ae === A.Body.Moon ? A.Body.Moon : ae, time(date));
  const ra = (axis.ra * 15 * Math.PI) / 180;
  // node of the body's equator on the J2000 equator, then turned by the spin angle W
  const zq: V3 = [axis.north.x, axis.north.y, axis.north.z];
  const q: V3 = [-Math.sin(ra), Math.cos(ra), 0];
  const zxq: V3 = [zq[1] * q[2] - zq[2] * q[1], zq[2] * q[0] - zq[0] * q[2], zq[0] * q[1] - zq[1] * q[0]];
  // Galilean moons are tidally locked: face Jupiter instead of using Jupiter's spin
  const w = (axis.spin * Math.PI) / 180;
  const xq: V3 = add(scale(q, Math.cos(w)), scale(zxq, Math.sin(w)));
  const yq: V3 = [zq[1] * xq[2] - zq[2] * xq[1], zq[2] * xq[0] - zq[0] * xq[2], zq[0] * xq[1] - zq[1] * xq[0]];
  const v = (a: V3) => toScene({ x: a[0], y: a[1], z: a[2] });
  return { x: v(xq), y: v(yq), z: v(zq) };
}

/** A point on a body's surface (lat, lon in degrees, east positive) as a body-centred scene unit vector. */
export function surfaceDir(b: Basis, latDeg: number, lonDeg: number): V3 {
  const la = (latDeg * Math.PI) / 180;
  const lo = (lonDeg * Math.PI) / 180;
  const c = Math.cos(la);
  return add(add(scale(b.x, c * Math.cos(lo)), scale(b.y, c * Math.sin(lo))), scale(b.z, Math.sin(la)));
}

/** Orbital period, days (for drawing orbit rings). */
export function periodDays(id: BodyId): number {
  const p: Partial<Record<BodyId, number>> = {
    mercury: 87.97, venus: 224.7, earth: 365.256, mars: 686.98, jupiter: 4332.6, saturn: 10759, uranus: 30687, neptune: 60190,
    moon: 27.3217, io: 1.769, europa: 3.551, ganymede: 7.155, callisto: 16.689,
  };
  return p[id] ?? 365;
}
