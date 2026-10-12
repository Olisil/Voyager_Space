import { AU_KM, BODIES, helioState, type BodyId, type V3 } from "./bodies";
import { ENTRY, LANDABLE } from "./descent";
import type { Transfer } from "./mission";
import {
  add,
  angleAbout,
  asymptoteOffset,
  Conic,
  conicFromPeri,
  cross,
  crossing,
  hyperbola,
  hyperbolaThrough,
  hyperTime,
  lambert,
  mul,
  norm,
  periOf,
  SOI_KM,
  sub,
  unit,
  type State,
} from "./orbits";
import { addLanding, bestLaunchTime, DAY, dateAt, failed, launchGeom, lowR, orbitLanding, Plan, runAscent, type Mission } from "./plan";
import { moonGeo } from "./traj";
import type { Project } from "./types";
import { siteOf } from "./types";

/**
 * Between planets: a heliocentric Lambert arc between the two planets, handed over at each
 * sphere of influence to a hyperbola around the planet. The departure hyperbola starts from
 * the parking orbit (the launch time of day puts the parking plane through the escape
 * direction); the arrival hyperbola ends in a capture burn, or in an entry when landing.
 * Flights to or from the Moon add a leg around Earth, through the Moon's position.
 */

const helio = (b: BodyId, d: Date): State => {
  const s = helioState(b, d);
  return { r: mul(s.r, AU_KM), v: s.v };
};
const NAME = (b: BodyId) => BODIES[b].name;
const UP = (b: BodyId) => BODIES[b].name.toUpperCase();
const tele = (A: { at: (t: number) => { speed: number; alt: number } }) => (t: number) => {
  const s = A.at(t);
  return { speed: s.speed, alt: s.alt };
};

export function interplanetaryMission(p: Project, from: BodyId, to: BodyId, tr: Transfer): Mission {
  const muS = BODIES.sun.mu;
  const muE = BODIES.earth.mu;
  const muM = BODIES.moon.mu;
  const site = siteOf(p);
  const tof = tr.tofDays * DAY;
  const depSys: BodyId = from === "moon" ? "earth" : from;
  const arrSys: BodyId = to === "moon" ? "earth" : to;
  const land = !!p.schedule.land && LANDABLE.includes(to);
  const soiD = SOI_KM[depSys];
  const soiA = SOI_KM[arrSys];
  const soiE = SOI_KM.earth;
  const soiM = SOI_KM.moon;
  const rLLO = lowR("moon");

  let L = new Date(tr.depart.getTime() - 6 * 3600 * 1000);
  let tdL = 6 * 3600;
  let aimD: V3 = [0, 0, 0];
  let aimA: V3 = [0, 0, 0];
  let tmD = 3 * 3600;
  let aimMD: V3 = [0, 0, 0];
  let tmA = tdL + tof;
  let aimMA: V3 = [0, 0, 0];

  type Dep = { A: ReturnType<typeof runAscent>; orbit: Conic; out: Conic; tB: number; tX: number; HE?: Conic; tXE?: number };
  type Arr = { HA: Conic; tE: number; tP: number; rp: number; HE?: Conic; tSM?: number };
  let H: Conic | null = null;
  let dep: Dep | null = null;
  let arr: Arr | null = null;

  for (let iter = 0; iter < 8; iter++) {
    const D = helio(depSys, dateAt(L, tdL));
    const T = helio(arrSys, dateAt(L, tdL + tof));
    const sol = lambert(add(D.r, aimD), add(T.r, aimA), tof, muS);
    if (!sol) return failed(tr.depart, from, to, "No transfer found. Try a wider window.");
    H = new Conic(add(D.r, aimD), sol.v1, tdL, muS);
    const Hc = H;
    const vinfD = sub(sol.v1, D.v);
    const vinfA = sub(sol.v2, T.v);
    const sysAt = (b: BodyId, t: number) => helio(b, dateAt(L, t)).r;
    const moonR = (t: number) => moonGeo(dateAt(L, t)).r;

    // ---- departure
    let tdNew: number;
    if (from !== "moon") {
      if (iter === 0) L = bestLaunchTime(from, site, L, () => unit(vinfD), true);
      const mu = BODIES[from].mu;
      const rD = lowR(from);
      const s = unit(vinfD);
      const g = launchGeom(from, site, L, s);
      const A = runAscent(p, from, L, g, rD);
      const n = unit(cross(A.ins.r, A.ins.v));
      const hyp = hyperbola(vinfD, rD, mu, "out", cross(s, n));
      const orbit = new Conic(A.ins.r, A.ins.v, A.T, mu);
      let coast = angleAbout(unit(A.ins.r), hyp.peri.P, n) / ((2 * Math.PI) / orbit.period);
      if (coast < 900) coast += orbit.period;
      const tB = A.T + coast;
      const out = conicFromPeri(hyp.peri, mu, tB);
      const tX = tB + hyperTime(hyp.peri, mu, soiD);
      const tc = crossing((t) => norm(sub(Hc.at(t).r, sysAt(depSys, t))) - soiD, Hc.t0, 3600, 1, 3e8) ?? Hc.t0 + soiD / norm(vinfD);
      tdNew = tX - (tc - Hc.t0);
      aimD = mul(hyp.B, hyp.b);
      dep = { A, orbit, out, tB, tX };
    } else {
      const M = moonGeo(dateAt(L, tmD));
      const r0 = add(M.r, aimMD);
      const vE = hyperbolaThrough(r0, vinfD, muE, "out");
      if (!vE) return failed(tr.depart, from, to, "No transfer found. Try a wider window.");
      const HE = new Conic(r0, vE, tmD, muE);
      const vinfM = sub(vE, M.v);
      const s = unit(vinfM);
      const g = launchGeom("moon", site, L, s);
      const A = runAscent(p, "moon", L, g, rLLO);
      const n = unit(cross(A.ins.r, A.ins.v));
      const hyp = hyperbola(vinfM, rLLO, muM, "out", cross(s, n));
      const orbit = new Conic(A.ins.r, A.ins.v, A.T, muM);
      let coast = angleAbout(unit(A.ins.r), hyp.peri.P, n) / ((2 * Math.PI) / orbit.period);
      if (coast < 900) coast += orbit.period;
      const tB = A.T + coast;
      const out = conicFromPeri(hyp.peri, muM, tB);
      const tX = tB + hyperTime(hyp.peri, muM, soiM);
      const tcM = crossing((t) => norm(sub(HE.at(t).r, moonR(t))) - soiM, tmD, 600, 1, 30 * DAY) ?? tmD + 0.5 * DAY;
      const tmNew = tX - (tcM - tmD);
      const tXE0 = crossing((t) => norm(HE.at(t).r) - soiE, tmD, 3600, 1, 300 * DAY) ?? tmD + 4 * DAY;
      const tXE = tXE0 - tmD + tmNew;
      const tcE = crossing((t) => norm(sub(Hc.at(t).r, sysAt("earth", t))) - soiE, Hc.t0, 3600, 1, 3e8) ?? Hc.t0 + 3 * DAY;
      tdNew = tXE - (tcE - Hc.t0);
      aimMD = mul(hyp.B, hyp.b);
      aimD = asymptoteOffset(periOf(r0, vE, muE), "out");
      dep = { A, orbit, out, tB, tX, HE: new Conic(r0, vE, tmNew, muE), tXE };
      tmD = tmNew;
    }

    // ---- arrival
    const taL = Hc.t0 + tof;
    if (to !== "moon") {
      const mu = BODIES[to].mu;
      const R = BODIES[to].radiusKm;
      const ent = land ? ENTRY[to] : undefined;
      const V = norm(vinfA);
      let rp = lowR(to);
      if (ent) {
        const rEI = R + ent.alt;
        const vEI = Math.sqrt(V * V + (2 * mu) / rEI);
        const h = rEI * vEI * Math.cos((ent.fpa * Math.PI) / 180);
        rp = (-mu + Math.sqrt(mu * mu + V * V * h * h)) / (V * V);
      }
      const hyp = hyperbola(vinfA, rp, mu, "in", mul(unit(T.r), -1));
      const tauH = hyperTime(hyp.peri, mu, soiA);
      const tE = crossing((t) => norm(sub(Hc.at(t).r, sysAt(to, t))) - soiA, taL, 3600, -1, 3e8) ?? taL - tauH;
      const tP = tE + tauH;
      aimA = mul(hyp.B, hyp.b);
      arr = { HA: conicFromPeri(hyp.peri, mu, tP), tE, tP, rp };
    } else {
      const M = moonGeo(dateAt(L, tmA));
      const r1 = add(M.r, aimMA);
      const vE = hyperbolaThrough(r1, vinfA, muE, "in");
      if (!vE) return failed(tr.depart, from, to, "No transfer found. Try a wider window.");
      const HE = new Conic(r1, vE, tmA, muE);
      const tEnt = crossing((t) => norm(HE.at(t).r) - soiE, tmA, 3600, -1, 300 * DAY) ?? tmA - 3 * DAY;
      const tEH = crossing((t) => norm(sub(Hc.at(t).r, sysAt("earth", t))) - soiE, taL, 3600, -1, 3e8) ?? taL - 3 * DAY;
      const tmNew = tEH + (tmA - tEnt);
      aimA = asymptoteOffset(periOf(r1, vE, muE), "in");
      const vinfM = sub(vE, M.v);
      const hyp = hyperbola(vinfM, rLLO, muM, "in", unit(M.r));
      aimMA = mul(hyp.B, hyp.b);
      const tauH = hyperTime(hyp.peri, muM, soiM);
      const tSM0 = crossing((t) => norm(sub(HE.at(t).r, moonR(t))) - soiM, tmA, 600, -1, 30 * DAY) ?? tmA - tauH;
      const tSM = tSM0 - tmA + tmNew;
      const tP = tSM + tauH;
      arr = { HA: conicFromPeri(hyp.peri, muM, tP), tE: tEH, tP, rp: rLLO, HE: new Conic(r1, vE, tmNew, muE), tSM };
      tmA = tmNew;
    }
    tdL = tdNew;
  }
  if (!H || !dep || !arr) return failed(tr.depart, from, to, "No transfer found. Try a wider window.");
  return assemble(p, { from, to, L, H, dep, arr, land });
}

function assemble(
  p: Project,
  o: {
    from: BodyId;
    to: BodyId;
    L: Date;
    H: Conic;
    dep: { A: ReturnType<typeof runAscent>; orbit: Conic; out: Conic; tB: number; tX: number; HE?: Conic; tXE?: number };
    arr: { HA: Conic; tE: number; tP: number; rp: number; HE?: Conic; tSM?: number };
    land: boolean;
  },
): Mission {
  const { from, to, L, H, dep, arr, land } = o;
  const plan = new Plan();
  const A = dep.A;
  const prop = A.prop;
  const center = from;

  // ---- launch, parking orbit, departure burn
  plan.leg(center, (t) => A.at(t), A.T, from === "moon" ? 20 : 45, tele(A));
  plan.addEvents(A.events);
  plan.phase(from === "moon" ? "Lunar ascent" : "Ascent", 0, A.T, from === "earth" ? 7 : 5);
  plan.dv.push({ label: `Launch to low ${from === "moon" ? "lunar" : NAME(from)} orbit`, dv: A.dv });
  const dvDep = norm(dep.out.at(dep.tB).v) - norm(dep.orbit.at(dep.tB).v);
  const burn = prop.burn(dvDep);
  plan.conic(center, dep.orbit, dep.tB, burn.duration / 2);
  plan.event(dep.tB - burn.duration / 2, "DEPARTURE BURN");
  for (const e of burn.events) plan.event(dep.tB - burn.duration / 2 + e.dt, e.label);
  plan.phase(from === "moon" ? "Lunar orbit" : "Parking orbit", A.T, dep.tB - burn.duration / 2, 2.5);
  plan.phase("Departure burn", dep.tB - burn.duration / 2, dep.tB + burn.duration / 2, 2);
  plan.dv.push({ label: "Departure burn", dv: dvDep });
  if (prop.jettison()) plan.event(dep.tB + burn.duration / 2 + 900, "STAGE SEP");
  const tauD = dep.tX - dep.tB;
  plan.conic(center, dep.out, dep.tX, Math.min(0.35 * tauD, 3 * DAY));
  plan.event(dep.tX, `${UP(from)} SOI EXIT`);
  plan.phase(`Leaving ${from === "moon" ? "the Moon" : NAME(from)}`, dep.tB + burn.duration / 2, dep.tX, 3.5);
  let cruiseFrom = dep.tX;
  if (dep.HE && dep.tXE !== undefined) {
    plan.conic("earth", dep.HE, dep.tXE, Math.min(0.35 * (dep.tXE - dep.tX), 3 * DAY));
    plan.event(dep.tXE, "EARTH SOI EXIT");
    plan.phase("Leaving Earth", dep.tX, dep.tXE, 3);
    cruiseFrom = dep.tXE;
  }

  // ---- cruise
  const tauA = arr.tP - arr.tE;
  plan.conic("sun", H, arr.tE, Math.min(0.35 * tauA, 3 * DAY));
  const arrSys = to === "moon" ? "earth" : to;
  plan.event(arr.tE, `${UP(arrSys)} SOI ENTRY`);
  plan.phase(`Cruise to ${to === "moon" ? "the Moon" : NAME(to)}`, cruiseFrom, arr.tE, p.timing.duration);

  // ---- arrival
  let approachFrom = arr.tE;
  if (arr.HE && arr.tSM !== undefined) {
    plan.conic("earth", arr.HE, arr.tSM, Math.min(0.35 * (arr.tP - arr.tSM), 8 * 3600));
    plan.event(arr.tSM, "MOON SOI ENTRY");
    plan.phase("Past Earth to the Moon", arr.tE, arr.tSM, 3);
    approachFrom = arr.tSM;
  }
  const mu = BODIES[to].mu;
  const ent = land ? ENTRY[to] : undefined;
  let arrival: number;
  const approachName = to === "moon" ? "Lunar approach" : `${NAME(to)} approach`;
  if (ent) {
    const rEI = BODIES[to].radiusKm + ent.alt;
    const tEI = crossing((t) => norm(arr.HA.at(t).r) - rEI, arr.tP, 60, -1, 400 * DAY) ?? arr.tP - 600;
    plan.conic(to, arr.HA, tEI, 15);
    plan.phase(approachName, approachFrom, tEI, 3);
    arrival = addLanding(plan, to, L, tEI, arr.HA.at(tEI), false);
  } else {
    const sp = arr.HA.at(arr.tP);
    const vc = Math.sqrt(mu / arr.rp);
    const dvCap = norm(sp.v) - vc;
    const cap = prop.burn(dvCap);
    plan.conic(to, arr.HA, arr.tP, cap.duration / 2);
    plan.event(arr.tP - cap.duration / 2, to === "moon" ? "LOI BURN" : "CAPTURE BURN");
    plan.phase(approachName, approachFrom, arr.tP - cap.duration / 2, 3);
    plan.phase(to === "moon" ? "Lunar orbit insertion" : "Orbit insertion", arr.tP - cap.duration / 2, arr.tP + cap.duration / 2, 1.5);
    plan.dv.push({ label: `${to === "moon" ? "Lunar" : NAME(to)} orbit insertion`, dv: dvCap });
    const orbit = new Conic(sp.r, mul(unit(sp.v), vc), arr.tP, mu);
    const orbitName = to === "moon" ? "Lunar orbit" : `${NAME(to)} orbit`;
    if (land) {
      const tStart = arr.tP + cap.duration / 2 + 1.25 * orbit.period;
      plan.phase(orbitName, arr.tP + cap.duration / 2, tStart, 2.5);
      arrival = orbitLanding(plan, to, L, orbit, tStart);
    } else {
      const end = arr.tP + 1.3 * orbit.period;
      plan.conic(to, orbit, end);
      plan.phase(orbitName, arr.tP + cap.duration / 2, end, 4);
      arrival = arr.tP;
    }
  }
  const bodies: BodyId[] = [];
  for (const b of [from, to]) {
    if (b === "moon") bodies.push("earth", "moon");
    else bodies.push(b);
  }
  return plan.done({ launch: L, from, to, root: "sun", bodies: [...new Set(bodies)], arrival, landed: land });
}
