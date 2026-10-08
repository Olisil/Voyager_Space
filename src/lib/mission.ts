import {
  AU_KM,
  BODIES,
  bodyBasis,
  compressVec,
  displayPos,
  helioState,
  moonOffsetKm,
  surfaceDir,
  type BodyId,
  type V3,
} from "./bodies";
import { add, cross, dot, escapeDv, hohmannTime, lambert, mul, norm, propagate, rotate, sub, unit } from "./orbits";
import type { Destination, Project, Scenario, Site } from "./types";
import { siteOf } from "./types";

/**
 * A mission is a chain of segments, each drawn in its own frame: near a body the path is
 * body-centred and compressed with the planet (so a 200 km orbit shows around an enlarged
 * Earth), between planets it is heliocentric and true to scale. Short blends join the frames.
 */
export interface Segment {
  name: string;
  /** seconds after launch */
  t0: number;
  t1: number;
  /** body the offsets are relative to, or null for absolute (heliocentric) positions */
  frame: BodyId | null;
  at: (t: number, boost: number) => V3;
}

export interface Phase {
  name: string;
  t0: number;
  t1: number;
  /** default share of the video, seconds */
  video: number;
  ease: boolean;
}

export interface DvPart {
  label: string;
  dv: number;
}

export interface Mission {
  ok: boolean;
  message?: string;
  launch: Date;
  arrival: Date;
  from: BodyId;
  to: BodyId;
  segments: Segment[];
  phases: Phase[];
  dv: DvPart[];
  /** body to keep in view while following, per phase index */
  focusOf: (t: number) => BodyId;
}

const DAY = 86400;
const ASCENT_S: Partial<Record<BodyId, number>> = { earth: 540, moon: 420, mars: 480 };
const ASCENT_DV: Partial<Record<BodyId, number>> = { moon: 1.9, mars: 4.1 };
const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};
const lerp = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const dateAt = (launch: Date, t: number) => new Date(launch.getTime() + t * 1000);
const lowR = (b: BodyId) => BODIES[b].radiusKm + BODIES[b].lowOrbitKm;

/** A circular orbit: position (km, body-centred) at time t. */
function circle(r: number, d0: V3, n: V3, mu: number, t0: number) {
  const e2 = cross(n, d0);
  const w = Math.sqrt(mu / (r * r * r));
  return (t: number): V3 => {
    const a = w * (t - t0);
    return mul(add(mul(d0, Math.cos(a)), mul(e2, Math.sin(a))), r);
  };
}

/** Signed angle from a to b about n, in [0, 2π). */
function angleAbout(a: V3, b: V3, n: V3) {
  const ang = Math.atan2(dot(cross(a, b), n), dot(a, b));
  return ang < 0 ? ang + 2 * Math.PI : ang;
}

interface Launch {
  site: V3;
  n: V3;
  insert: V3;
  ascent: (t: number) => V3;
  T: number;
  dv: number;
  east: V3;
}

/**
 * Ascent from a site into a circular low orbit whose plane contains the site and `towards`
 * (or flies due east when `towards` is null). Steep at first, then bending over.
 */
function launchFrom(body: BodyId, site: Site, date: Date, towards: V3 | null, inclinationDeg?: number): Launch {
  const b = bodyBasis(body, date);
  const s = surfaceDir(b, site.lat, site.lon);
  const pole = b.z;
  let east = unit(cross(pole, s));
  if (norm(east) < 1e-6) east = b.x;
  const north = unit(cross(s, east));
  let dir = east;
  if (inclinationDeg !== undefined) {
    const cosLat = Math.cos((site.lat * Math.PI) / 180);
    const sinAz = Math.cos((inclinationDeg * Math.PI) / 180) / Math.max(1e-6, cosLat);
    if (Math.abs(sinAz) <= 1) {
      const az = Math.PI - Math.asin(sinAz); // southward for high-inclination orbits
      dir = unit(add(mul(north, Math.cos(az)), mul(east, Math.sin(az))));
    }
  } else if (towards) {
    const t = unit(sub(towards, mul(s, dot(towards, s))));
    if (norm(t) > 1e-6) dir = t;
  }
  const n = unit(cross(s, dir));
  const R = BODIES[body].radiusKm;
  const rp = lowR(body);
  const T = ASCENT_S[body] ?? 480;
  const theta = (20 * Math.PI) / 180;
  const ascent = (t: number): V3 => {
    const u = Math.min(1, Math.max(0, t / T));
    const r = R + (rp - R) * Math.pow(Math.sin((u * Math.PI) / 2), 0.7);
    return mul(rotate(s, n, theta * Math.pow(u, 1.6)), r);
  };
  const insert = unit(rotate(s, n, theta));
  const lat = (site.lat * Math.PI) / 180;
  const dv = body === "earth" ? 9.4 - 0.465 * Math.cos(lat) * dot(dir, east) : (ASCENT_DV[body] ?? 4);
  return { site: s, n, insert, ascent, T, dv, east };
}

/**
 * Real launches pick the time of day when Earth's turn carries the pad under the plane they
 * need, so the rocket can fly close to due east. Search a day for that moment.
 */
function bestLaunchTime(body: BodyId, site: Site, around: Date, towardsAt: (d: Date) => V3, spanH = 24): Date {
  if (body !== "earth") return around;
  let best = around;
  let bestEast = -2;
  for (let m = 0; m <= spanH * 60; m += 15) {
    const d = new Date(around.getTime() + (m - (spanH === 24 ? 0 : (spanH * 60) / 2)) * 60000);
    const L = launchFrom(body, site, d, towardsAt(d));
    const dir = cross(L.n, L.site);
    const east = dot(unit(dir), L.east);
    if (east > bestEast) {
      bestEast = east;
      best = d;
    }
  }
  return best;
}

function seg(name: string, t0: number, t1: number, frame: BodyId | null, at: Segment["at"]): Segment {
  return { name, t0, t1, frame, at };
}

// ---------------------------------------------------------------- Earth orbits

function earthOrbitMission(p: Project, dest: Destination, launch: Date): Mission {
  const site = siteOf(p);
  const mu = BODIES.earth.mu;
  const L = launchFrom("earth", site, launch, null, dest === "sso" ? 97.5 : undefined);
  const rp = lowR("earth");
  const period = 2 * Math.PI * Math.sqrt((rp * rp * rp) / mu);
  const segs: Segment[] = [seg("Ascent", 0, L.T, "earth", (t, k) => compressVec("earth", L.ascent(t), k))];
  const phases: Phase[] = [{ name: "Ascent", t0: 0, t1: L.T, video: 4, ease: false }];
  const dv: DvPart[] = [{ label: "Launch to low orbit", dv: L.dv }];
  const park = circle(rp, L.insert, L.n, mu, L.T);
  if (dest === "leo" || dest === "sso") {
    const r = dest === "sso" ? BODIES.earth.radiusKm + 600 : rp;
    const orbit = circle(r, L.insert, L.n, mu, L.T);
    const end = L.T + 1.5 * period;
    segs.push(seg("Orbit", L.T, end, "earth", (t, k) => compressVec("earth", orbit(t), k)));
    phases.push({ name: "Orbit", t0: L.T, t1: end, video: p.timing.duration, ease: false });
    if (dest === "sso") dv.push({ label: "Raise to 600 km", dv: 0.2 });
    return done(launch, "earth", "earth", segs, phases, dv);
  }
  // coast to the ascending node, then a transfer ellipse up to geostationary height
  const pole = bodyBasis("earth", launch).z;
  let node = unit(cross(pole, L.n));
  if (norm(node) < 1e-6) node = L.insert;
  const coast = angleAbout(L.insert, node, L.n) / (2 * Math.PI / period);
  const tb = L.T + coast;
  segs.push(seg("Parking orbit", L.T, tb, "earth", (t, k) => compressVec("earth", park(t), k)));
  phases.push({ name: "Parking orbit", t0: L.T, t1: tb, video: 2.5, ease: false });
  const ra = BODIES.earth.radiusKm + 35786;
  const a = (rp + ra) / 2;
  const vp = Math.sqrt(mu * (2 / rp - 1 / a));
  const r0 = park(tb);
  const v0 = mul(unit(cross(L.n, unit(r0))), vp);
  const half = Math.PI * Math.sqrt((a * a * a) / mu);
  dv.push({ label: "Burn to geostationary transfer", dv: vp - Math.sqrt(mu / rp) });
  if (dest === "gto") {
    const end = tb + 2 * half;
    segs.push(seg("Transfer orbit", tb, end, "earth", (t, k) => compressVec("earth", propagate(r0, v0, t - tb, mu).r, k)));
    phases.push({ name: "Transfer orbit", t0: tb, t1: end, video: p.timing.duration, ease: true });
    return done(launch, "earth", "earth", segs, phases, dv);
  }
  const ta = tb + half;
  segs.push(seg("Transfer orbit", tb, ta, "earth", (t, k) => compressVec("earth", propagate(r0, v0, t - tb, mu).r, k)));
  phases.push({ name: "Transfer orbit", t0: tb, t1: ta, video: p.timing.duration * 0.7, ease: true });
  const apo = propagate(r0, v0, half, mu);
  const vApo = norm(apo.v);
  const vGeo = Math.sqrt(mu / ra);
  const inc = Math.acos(Math.max(-1, Math.min(1, dot(L.n, pole))));
  dv.push({ label: "Circularise over the equator", dv: Math.sqrt(vApo * vApo + vGeo * vGeo - 2 * vApo * vGeo * Math.cos(inc)) });
  const geo = circle(ra, unit(apo.r), pole, mu, ta);
  const end = ta + 0.35 * 86164;
  segs.push(seg("Geostationary orbit", ta, end, "earth", (t, k) => compressVec("earth", geo(t), k)));
  phases.push({ name: "Geostationary orbit", t0: ta, t1: end, video: p.timing.duration * 0.3, ease: false });
  return done(launch, "earth", "earth", segs, phases, dv);
}

// ---------------------------------------------------------------- Earth ⇄ Moon

const moonVel = (d: Date): V3 => mul(sub(moonOffsetKm("moon", new Date(d.getTime() + 60000)), moonOffsetKm("moon", new Date(d.getTime() - 60000))), 1 / 120);

function earthMoonMission(p: Project, from: BodyId, launchAt: Date, tofDays: number): Mission {
  let launch = launchAt;
  const muE = BODIES.earth.mu;
  const muM = BODIES.moon.mu;
  const site = siteOf(p);
  const tof = tofDays * DAY;
  const rLEO = lowR("earth");
  const rLLO = lowR("moon");
  const segs: Segment[] = [];
  const phases: Phase[] = [];
  const dv: DvPart[] = [];
  if (from === "earth") {
    launch = bestLaunchTime("earth", site, launch, (d) => mul(unit(moonOffsetKm("moon", new Date(d.getTime() + tof * 1000))), -1));
    // iterate: where the Moon will be fixes the parking plane, which fixes the coast time
    let coast = 0.4 * 5300;
    let L = launchFrom("earth", site, launch, null);
    let r1: V3 = [rLEO, 0, 0];
    let mA: V3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const ta = dateAt(launch, L.T + coast + tof);
      mA = moonOffsetKm("moon", ta);
      L = launchFrom("earth", site, launch, mul(unit(mA), -1));
      const r1dir = unit(rotate(mul(unit(mA), -1), L.n, (-5 * Math.PI) / 180));
      r1 = mul(r1dir, rLEO);
      coast = angleAbout(L.insert, r1dir, L.n) / Math.sqrt(muE / (rLEO * rLEO * rLEO));
    }
    const tb = L.T + coast;
    const ta = tb + tof;
    const r2 = sub(mA, mul(unit(mA), rLLO));
    const sol = lambert(r1, r2, tof, muE, L.n);
    if (!sol) return failed(launch, "earth", "moon", "No transfer found for this date. Try another time.");
    const park = circle(rLEO, L.insert, L.n, muE, L.T);
    segs.push(seg("Ascent", 0, L.T, "earth", (t, k) => compressVec("earth", L.ascent(t), k)));
    segs.push(seg("Parking orbit", L.T, tb, "earth", (t, k) => compressVec("earth", park(t), k)));
    const transfer = (t: number) => propagate(r1, sol.v1, t - tb, muE).r;
    const blend = 0.1 * tof;
    segs.push(
      seg("To the Moon", tb, ta, "earth", (t, k) => {
        const r = transfer(t);
        const a = compressVec("earth", r, k);
        if (t < ta - blend) return a;
        const mNow = moonOffsetKm("moon", dateAt(launch, t));
        const b = add(compressVec("earth", mNow, k), compressVec("moon", sub(r, mNow), k));
        return lerp(a, b, smooth((t - (ta - blend)) / blend));
      }),
    );
    const vrel = sub(sol.v2, moonVel(dateAt(launch, ta)));
    const d0 = unit(sub(r2, mA));
    let nL = unit(cross(d0, vrel));
    if (norm(nL) < 1e-6) nL = L.n;
    const llo = circle(rLLO, d0, nL, muM, ta);
    const end = ta + 1.3 * 2 * Math.PI * Math.sqrt((rLLO * rLLO * rLLO) / muM);
    segs.push(seg("Lunar orbit", ta, end, "moon", (t, k) => compressVec("moon", llo(t), k)));
    phases.push(
      { name: "Ascent", t0: 0, t1: L.T, video: 4, ease: false },
      { name: "Parking orbit", t0: L.T, t1: tb, video: 2.5, ease: false },
      { name: "To the Moon", t0: tb, t1: ta, video: p.timing.duration, ease: true },
      { name: "Lunar orbit", t0: ta, t1: end, video: 3, ease: false },
    );
    dv.push(
      { label: "Launch to low Earth orbit", dv: L.dv },
      { label: "Trans-lunar injection", dv: norm(sol.v1) - Math.sqrt(muE / rLEO) },
      { label: "Lunar orbit insertion", dv: escapeDv(norm(vrel), muM, rLLO) },
    );
    return { ...done(launch, "earth", "moon", segs, phases, dv), focusOf: (t) => (t < tb + tof * 0.55 ? "earth" : "moon") };
  }
  // Moon → Earth: lift off into low lunar orbit, leave towards Earth, end in low Earth orbit
  const L = launchFrom("moon", site, launch, null);
  const park = circle(rLLO, L.insert, L.n, muM, L.T);
  const coast = 0.5 * 2 * Math.PI * Math.sqrt((rLLO * rLLO * rLLO) / muM);
  const tb = L.T + coast;
  const ta = tb + tof;
  const mD = moonOffsetKm("moon", dateAt(launch, tb));
  const r1 = add(mD, park(tb));
  const r2 = mul(unit(rotate(mul(unit(mD), -1), unit(cross(mD, moonVel(dateAt(launch, tb)))), 0.2)), rLEO);
  const nE = unit(cross(mD, moonVel(dateAt(launch, tb))));
  const sol = lambert(r1, r2, tof, muE, nE);
  if (!sol) return failed(launch, "moon", "earth", "No transfer found for this date. Try another time.");
  segs.push(seg("Ascent", 0, L.T, "moon", (t, k) => compressVec("moon", L.ascent(t), k)));
  segs.push(seg("Lunar orbit", L.T, tb, "moon", (t, k) => compressVec("moon", park(t), k)));
  const blend = 0.1 * tof;
  segs.push(
    seg("To Earth", tb, ta, "earth", (t, k) => {
      const r = propagate(r1, sol.v1, t - tb, muE).r;
      const a = compressVec("earth", r, k);
      if (t > tb + blend) return a;
      const mNow = moonOffsetKm("moon", dateAt(launch, t));
      const b = add(compressVec("earth", mNow, k), compressVec("moon", sub(r, mNow), k));
      return lerp(b, a, smooth((t - tb) / blend));
    }),
  );
  const leo = circle(rLEO, unit(r2), unit(cross(r2, sol.v2)), muE, ta);
  const end = ta + 1.3 * 5300;
  segs.push(seg("Earth orbit", ta, end, "earth", (t, k) => compressVec("earth", leo(t), k)));
  phases.push(
    { name: "Ascent", t0: 0, t1: L.T, video: 4, ease: false },
    { name: "Lunar orbit", t0: L.T, t1: tb, video: 2.5, ease: false },
    { name: "To Earth", t0: tb, t1: ta, video: p.timing.duration, ease: true },
    { name: "Earth orbit", t0: ta, t1: end, video: 3, ease: false },
  );
  dv.push(
    { label: "Launch to low lunar orbit", dv: L.dv },
    { label: "Trans-Earth injection", dv: escapeDv(norm(sub(sol.v1, moonVel(dateAt(launch, tb)))), muM, rLLO) },
    { label: "Capture into Earth orbit (or re-entry instead)", dv: norm(sol.v2) - Math.sqrt(muE / rLEO) },
  );
  return { ...done(launch, "moon", "earth", segs, phases, dv), focusOf: (t) => (t < tb + tof * 0.5 ? "moon" : "earth") };
}

// ---------------------------------------------------------------- between planets

export interface Transfer {
  depart: Date;
  tofDays: number;
  vinfDep: number;
  vinfArr: number;
  dvDep: number;
  dvArr: number;
}

/** Search departure dates × flight times for Lambert transfers between two bodies orbiting the Sun. */
export function searchTransfers(from: BodyId, to: BodyId, start: Date, windowDays: number): Transfer[] {
  const muS = BODIES.sun.mu;
  const r1 = norm(helioState(from, start).r) * AU_KM;
  const r2 = norm(helioState(to, start).r) * AU_KM;
  const tH = hohmannTime(r1, r2, muS) / DAY;
  const out: Transfer[] = [];
  const nDep = 56;
  const nTof = 40;
  for (let i = 0; i < nDep; i++) {
    const dep = new Date(start.getTime() + (i / (nDep - 1)) * windowDays * DAY * 1000);
    const D = helioState(from, dep);
    for (let j = 0; j < nTof; j++) {
      const tof = tH * (0.5 + (1.1 * j) / (nTof - 1));
      const arr = new Date(dep.getTime() + tof * DAY * 1000);
      const T = helioState(to, arr);
      const sol = lambert(mul(D.r, AU_KM), mul(T.r, AU_KM), tof * DAY, muS);
      if (!sol) continue;
      const vinfDep = norm(sub(sol.v1, D.v));
      const vinfArr = norm(sub(sol.v2, T.v));
      out.push({
        depart: dep,
        tofDays: tof,
        vinfDep,
        vinfArr,
        dvDep: escapeDv(vinfDep, BODIES[from].mu, lowR(from)),
        dvArr: escapeDv(vinfArr, BODIES[to].mu, lowR(to)),
      });
    }
  }
  return out;
}

/** The four scenarios from a set of transfers. */
export function pickScenario(all: Transfer[], s: Scenario): Transfer | null {
  if (!all.length) return null;
  const cost = (x: Transfer) => x.dvDep + x.dvArr;
  const cheapest = all.reduce((a, b) => (cost(b) < cost(a) ? b : a));
  const minCost = cost(cheapest);
  if (s === "cheapest") return cheapest;
  if (s === "asap") {
    const ok = all.filter((x) => cost(x) <= minCost * 1.3);
    return ok.reduce((a, b) => (b.depart < a.depart || (+b.depart === +a.depart && cost(b) < cost(a)) ? b : a));
  }
  if (s === "fastest") {
    const ok = all.filter((x) => cost(x) <= minCost * 1.6);
    return ok.reduce((a, b) => (b.tofDays < a.tofDays ? b : a));
  }
  const minTof = Math.min(...all.filter((x) => cost(x) <= minCost * 1.6).map((x) => x.tofDays));
  const score = (x: Transfer) => cost(x) / minCost + x.tofDays / minTof;
  return all.filter((x) => cost(x) <= minCost * 1.6).reduce((a, b) => (score(b) < score(a) ? b : a));
}

function interplanetaryMission(p: Project, from: BodyId, to: BodyId, tr: Transfer): Mission {
  const muS = BODIES.sun.mu;
  const site = siteOf(p);
  const muD = BODIES[from].mu;
  const muT = BODIES[to].mu;
  const rD = lowR(from);
  const rT = lowR(to);
  const tof = tr.tofDays * DAY;
  const solve = (td: Date) => {
    const D = helioState(from, td);
    const T = helioState(to, new Date(td.getTime() + tof * 1000));
    const sol = lambert(mul(D.r, AU_KM), mul(T.r, AU_KM), tof, muS);
    return sol ? { D, T, sol, vinfD: sub(sol.v1, D.v) } : null;
  };
  const first = solve(tr.depart);
  if (!first) return failed(tr.depart, from, to, "No transfer found. Try a wider window.");
  const td = bestLaunchTime(from, site, tr.depart, () => first.vinfD, 24);
  const best = solve(td) ?? first;
  const { D, T, sol, vinfD } = best;
  const vinfA = sub(sol.v2, T.v);
  // launch so the parking orbit reaches the departure point (≈100° before the escape direction)
  const guessCoast = 0.5 * 2 * Math.PI * Math.sqrt((rD * rD * rD) / muD);
  const launch = new Date(td.getTime() - (ASCENT_S[from] ?? 480) * 1000 - guessCoast * 1000);
  const L = launchFrom(from, site, launch, vinfD);
  const burnDir = unit(rotate(unit(vinfD), L.n, (-100 * Math.PI) / 180));
  const w = Math.sqrt(muD / (rD * rD * rD));
  const coast = angleAbout(L.insert, burnDir, L.n) / w;
  const tb = L.T + coast;
  const launchAdj = new Date(td.getTime() - tb * 1000);
  const park = circle(rD, L.insert, L.n, muD, L.T);
  const segs: Segment[] = [
    seg("Ascent", 0, L.T, from, (t, k) => compressVec(from, L.ascent(t), k)),
    seg("Parking orbit", L.T, tb, from, (t, k) => compressVec(from, park(t), k)),
  ];
  // escape hyperbola, then the heliocentric cruise, blended
  const vp = Math.sqrt(norm(vinfD) ** 2 + (2 * muD) / rD);
  const rB = mul(burnDir, rD);
  const vB = mul(unit(cross(L.n, burnDir)), vp);
  const helio = (t: number): V3 => mul(propagate(mul(D.r, AU_KM), sol.v1, t - tb, muS).r, 1 / AU_KM);
  const blendD = Math.min(0.15 * tof, 10 * DAY);
  const blendA = Math.min(0.15 * tof, 10 * DAY);
  const ta1 = tb + tof;
  const pOff = mul(unit(cross(vinfA, Math.abs(unit(vinfA)[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), rT);
  segs.push(
    seg("Cruise", tb, ta1, null, (t, k) => {
      const h = helio(t);
      const date = dateAt(launchAdj, t);
      if (t < tb + blendD) {
        const near = add(displayPos(from, date, k), compressVec(from, propagate(rB, vB, t - tb, muD).r, k));
        return lerp(near, h, smooth((t - tb) / blendD));
      }
      if (t > ta1 - blendA) {
        const u = smooth((t - (ta1 - blendA)) / blendA);
        const rel = add(mul(sub(h, helioState(to, date).r), AU_KM), mul(pOff, u));
        const near = add(displayPos(to, date, k), compressVec(to, rel, k));
        return lerp(h, near, u);
      }
      return h;
    }),
  );
  let nA = unit(cross(pOff, vinfA));
  if (norm(nA) < 1e-6) nA = [0, 1, 0];
  const cap = circle(rT, unit(pOff), nA, muT, ta1);
  const capT = 1.2 * 2 * Math.PI * Math.sqrt((rT * rT * rT) / muT);
  segs.push(seg(`${BODIES[to].name} orbit`, ta1, ta1 + capT, to, (t, k) => compressVec(to, cap(t), k)));
  const phases: Phase[] = [
    { name: "Ascent", t0: 0, t1: L.T, video: 4, ease: false },
    { name: "Parking orbit", t0: L.T, t1: tb, video: 2.5, ease: false },
    { name: "Cruise", t0: tb, t1: ta1, video: p.timing.duration, ease: true },
    { name: `${BODIES[to].name} orbit`, t0: ta1, t1: ta1 + capT, video: 3, ease: false },
  ];
  const dv: DvPart[] = [
    { label: `Launch to low ${BODIES[from].name} orbit`, dv: L.dv },
    { label: `Departure burn`, dv: tr.dvDep },
    { label: `${BODIES[to].name} orbit insertion`, dv: tr.dvArr },
  ];
  const m = done(launchAdj, from, to, segs, phases, dv);
  return { ...m, arrival: dateAt(launchAdj, ta1), focusOf: (t) => (t < tb + tof * 0.35 ? from : to) };
}

// ---------------------------------------------------------------- entry

function done(launch: Date, from: BodyId, to: BodyId, segments: Segment[], phases: Phase[], dv: DvPart[]): Mission {
  const end = phases[phases.length - 1].t1;
  return { ok: true, launch, arrival: dateAt(launch, end), from, to, segments, phases, dv, focusOf: () => from };
}
function failed(launch: Date, from: BodyId, to: BodyId, message: string): Mission {
  return { ok: false, message, launch, arrival: launch, from, to, segments: [], phases: [], dv: [], focusOf: () => from };
}

export const MOON_TOF: Record<Scenario, number> = { fastest: 2.4, asap: 3, balanced: 3, cheapest: 4.2 };

export function isLocal(from: BodyId, to: BodyId) {
  return (from === "earth" && to === "moon") || (from === "moon" && to === "earth");
}

export function buildMission(p: Project, transfers: Transfer[] | null): Mission {
  const from = p.start.body;
  const dest = p.schedule.destination;
  const start = new Date(p.schedule.date);
  if (from === "earth" && (dest === "leo" || dest === "sso" || dest === "gto" || dest === "geo")) return earthOrbitMission(p, dest, start);
  const to = dest as BodyId;
  if (to === from) return failed(start, from, to, "Pick a destination other than the starting point.");
  if (isLocal(from, to)) {
    // as soon as possible = the start of the window; otherwise nudge the date so the scenario differs
    return earthMoonMission(p, from, start, MOON_TOF[p.schedule.scenario]);
  }
  const tr = transfers ? pickScenario(transfers, p.schedule.scenario) : null;
  if (!tr) return failed(start, from, to, "No transfer found in this window. Try a longer window.");
  return interplanetaryMission(p, from, to, tr);
}

/** Where the spacecraft is drawn at t seconds after launch. */
export function vehiclePos(m: Mission, t: number, boost: number): V3 | null {
  if (!m.ok || !m.segments.length) return null;
  const s = m.segments.find((x) => t <= x.t1) ?? m.segments[m.segments.length - 1];
  const tc = Math.max(s.t0, Math.min(s.t1, t));
  const local = s.at(tc, boost);
  return s.frame ? add(displayPos(s.frame, dateAt(m.launch, tc), boost), local) : local;
}

export function totalDv(m: Mission) {
  return m.dv.reduce((a, d) => a + d.dv, 0);
}
