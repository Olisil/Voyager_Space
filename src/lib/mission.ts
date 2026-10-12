import { AU_KM, BODIES, bodyBasis, helioState, type BodyId } from "./bodies";
import { interplanetaryMission } from "./interplanetary";
import { earthMoonMission, moonEarthMission } from "./lunar";
import { angleAbout, Conic, cross, escapeDv, hohmannTime, lambert, mul, norm, sub, unit } from "./orbits";
import { failed, launchGeom, lowR, Plan, runAscent, scaleTo, type Mission } from "./plan";
import type { EarthOrbit, Project, Scenario } from "./types";
import { siteOf } from "./types";

export type { DvPart, Mission, Phase, MEvent } from "./plan";

const DAY = 86400;

// ---------------------------------------------------------------- Earth orbits

function earthOrbitMission(p: Project, dest: EarthOrbit, launch: Date): Mission {
  const muE = BODIES.earth.mu;
  const g = launchGeom("earth", siteOf(p), launch, null, dest === "sso" ? 97.5 : undefined);
  const rp = lowR("earth");
  const A = runAscent(p, "earth", launch, g, rp);
  const plan = new Plan();
  plan.leg("earth", (t) => A.at(t), A.T, 45, (t) => {
    const s = A.at(t);
    return { speed: s.speed, alt: s.alt };
  });
  plan.addEvents(A.events);
  plan.phase("Ascent", 0, A.T, 7);
  plan.dv.push({ label: "Launch to low Earth orbit", dv: A.dv });
  const park = new Conic(A.ins.r, A.ins.v, A.T, muE);
  const P = park.period;
  const prop = A.prop;
  const base = { launch, from: "earth" as BodyId, to: "earth" as BodyId, root: "earth" as const, bodies: ["earth"] as BodyId[], landed: false };

  if (dest === "leo") {
    const end = A.T + 1.5 * P;
    plan.conic("earth", park, end);
    plan.phase("Low Earth orbit", A.T, end, p.timing.duration);
    return plan.done({ ...base, arrival: A.T });
  }

  if (dest === "sso") {
    const r2 = BODIES.earth.radiusKm + 600;
    const tb1 = A.T + 0.5 * P;
    const s1 = park.at(tb1);
    const a = (norm(s1.r) + r2) / 2;
    const vp = Math.sqrt(muE * (2 / norm(s1.r) - 1 / a));
    const dv1 = vp - norm(s1.v);
    const b1 = prop.burn(dv1);
    const tr = new Conic(s1.r, scaleTo(s1.v, vp), tb1, muE);
    const tb2 = tb1 + tr.period / 2;
    const s2 = tr.at(tb2);
    const vc = Math.sqrt(muE / r2);
    const dv2 = vc - norm(s2.v);
    const b2 = prop.burn(dv2);
    const fin = new Conic(s2.r, scaleTo(s2.v, vc), tb2, muE);
    const end = tb2 + 1.2 * fin.period;
    plan.conic("earth", park, tb1, b1.duration / 2);
    plan.conic("earth", tr, tb2, b2.duration / 2);
    plan.conic("earth", fin, end);
    plan.event(tb1 - b1.duration / 2, "TRANSFER BURN");
    plan.event(tb2 - b2.duration / 2, "CIRCULARIZATION");
    plan.phase("Parking orbit", A.T, tb1 - b1.duration / 2, 2.5);
    plan.phase("Raising the orbit", tb1 - b1.duration / 2, tb2 + b2.duration / 2, 4);
    plan.phase("Sun-synchronous orbit", tb2 + b2.duration / 2, end, p.timing.duration);
    plan.dv.push({ label: "Raise to 600 km", dv: dv1 + dv2 });
    return plan.done({ ...base, arrival: tb2 });
  }

  // geostationary transfer: burn where the parking orbit crosses the equator
  const pole = bodyBasis("earth", launch).z;
  const n = unit(cross(A.ins.r, A.ins.v));
  let node = unit(cross(pole, n));
  if (norm(node) < 1e-6) node = unit(A.ins.r);
  const w = (2 * Math.PI) / P;
  const after = (d: typeof node) => {
    let x = angleAbout(unit(A.ins.r), d, n) / w;
    if (x < 600) x += P;
    return x;
  };
  const tb = A.T + Math.min(after(node), after(mul(node, -1)));
  const s = park.at(tb);
  const ra = BODIES.earth.radiusKm + 35786;
  const a = (norm(s.r) + ra) / 2;
  const vp = Math.sqrt(muE * (2 / norm(s.r) - 1 / a));
  const dv1 = vp - norm(s.v);
  const b1 = prop.burn(dv1);
  const tr = new Conic(s.r, scaleTo(s.v, vp), tb, muE);
  plan.conic("earth", park, tb, b1.duration / 2);
  plan.event(tb - b1.duration / 2, "GTO BURN");
  plan.phase("Parking orbit", A.T, tb - b1.duration / 2, 2.5);
  plan.phase("Transfer burn", tb - b1.duration / 2, tb + b1.duration / 2, 2);
  plan.dv.push({ label: "Burn to geostationary transfer", dv: dv1 });
  if (dest === "gto") {
    const end = tb + tr.period;
    plan.conic("earth", tr, end);
    plan.event(tb + tr.period / 2, "APOGEE");
    plan.phase("Geostationary transfer orbit", tb + b1.duration / 2, end, p.timing.duration);
    return plan.done({ ...base, arrival: tb });
  }
  const ta = tb + tr.period / 2;
  const sa = tr.at(ta);
  const vGeo = Math.sqrt(muE / ra);
  const vNew = mul(unit(cross(pole, unit(sa.r))), vGeo);
  const dv2 = norm(sub(vNew, sa.v));
  const b2 = prop.burn(dv2);
  const geo = new Conic(sa.r, vNew, ta, muE);
  const end = ta + 0.35 * 86164;
  plan.conic("earth", tr, ta, b2.duration / 2);
  plan.conic("earth", geo, end);
  plan.event(ta - b2.duration / 2, "APOGEE BURN");
  plan.phase("Transfer orbit", tb + b1.duration / 2, ta - b2.duration / 2, p.timing.duration * 0.7);
  plan.phase("Apogee burn", ta - b2.duration / 2, ta + b2.duration / 2, 2);
  plan.phase("Geostationary orbit", ta + b2.duration / 2, end, Math.max(4, p.timing.duration * 0.3));
  plan.dv.push({ label: "Circularise over the equator", dv: dv2 });
  return plan.done({ ...base, arrival: ta });
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

// ---------------------------------------------------------------- entry

export const MOON_TOF: Record<Scenario, number> = { fastest: 2.4, asap: 3, balanced: 3, cheapest: 4.2 };

export function isLocal(from: BodyId, to: BodyId) {
  return (from === "earth" && to === "moon") || (from === "moon" && to === "earth");
}

export function buildMission(p: Project, transfers: Transfer[] | null): Mission {
  const from = p.start.body;
  const dest = p.schedule.destination;
  const start = new Date(p.schedule.date);
  try {
    if (from === "earth" && (dest === "leo" || dest === "sso" || dest === "gto" || dest === "geo")) return earthOrbitMission(p, dest, start);
    const to = dest as BodyId;
    if (to === from) return failed(start, from, to, "Pick a destination other than the starting point.");
    if (from === "earth" && to === "moon") return earthMoonMission(p, start, MOON_TOF[p.schedule.scenario]);
    if (from === "moon" && to === "earth") return moonEarthMission(p, start, MOON_TOF[p.schedule.scenario]);
    const tr = transfers ? pickScenario(transfers, p.schedule.scenario) : null;
    if (!tr) return failed(start, from, to, "No transfer found in this window. Try a longer window.");
    return interplanetaryMission(p, from, to, tr);
  } catch (e) {
    console.error(e);
    return failed(start, from, dest as BodyId, "This flight couldn't be worked out. Try another date or destination.");
  }
}

export function totalDv(m: Mission) {
  return m.dv.reduce((a, d) => a + d.dv, 0);
}

/** For the timeline label: the phase at t seconds after launch. */
export function phaseAt(m: Mission, t: number) {
  return m.phases.find((ph) => t <= ph.t1) ?? m.phases[m.phases.length - 1];
}

