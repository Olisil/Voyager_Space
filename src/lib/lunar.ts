import { BODIES, type V3 } from "./bodies";
import { ENTRY } from "./descent";
import { add, angleAbout, bisect, Conic, conicFromPeri, cross, dot, hyperbola, hyperTime, mul, norm, perp, rotate, sub, timeFromPeri, unit, type Peri } from "./orbits";
import { addLanding, circV, DAY, dateAt, failed, launchGeom, lowR, orbitLanding, Plan, runAscent, scaleTo, type Mission } from "./plan";
import { moonGeo } from "./traj";
import type { Project } from "./types";
import { siteOf } from "./types";

/**
 * Earth ⇄ Moon with patched conics: a transfer ellipse from a perigee burn, handed over to a
 * hyperbola around the Moon at the edge of its sphere of influence (66,000 km). The transfer
 * aims at the B-plane point, so the hand-over is seamless.
 */

export const SOI_MOON = 66100;

/** A conic with perigee radius rp that is at radius rT a time `tof` after (or before) perigee. */
export function perigeeTransfer(rp: number, rT: number, tof: number, mu: number) {
  const ef = (th: number) => (rT - rp) / (rp - rT * Math.cos(th));
  const tf = (th: number) => {
    const e = ef(th);
    return timeFromPeri(e, rp * (1 + e), mu, th);
  };
  const lo = Math.acos(Math.min(1, rp / rT)) + 2e-3;
  const hi = Math.PI - 1e-6;
  let th: number;
  if (tof >= tf(hi)) th = hi;
  else if (tof <= tf(lo)) th = lo;
  else th = bisect((x) => tf(x) - tof, lo, hi) ?? hi;
  const e = ef(th);
  return { th, e, p: rp * (1 + e) };
}

export function earthMoonMission(p: Project, start: Date, tofDays: number): Mission {
  const muE = BODIES.earth.mu;
  const muM = BODIES.moon.mu;
  const site = siteOf(p);
  const tof = tofDays * DAY;
  const rLEO = lowR("earth");
  const rLLO = lowR("moon");
  const land = !!p.schedule.land;

  // launch at the time of day when the plane holding the Moon's arrival point runs closest to east
  let launch = start;
  let sign = 1;
  {
    let best = -2;
    for (let m = 0; m <= 24 * 60; m += 10) {
      const d = new Date(start.getTime() + m * 60000);
      const M = moonGeo(dateAt(d, 3 * 3600 + tof)).r;
      const g = launchGeom("earth", site, d, unit(M));
      const e = dot(g.dir, g.east);
      if (Math.abs(e) > best) {
        best = Math.abs(e);
        launch = d;
        sign = e >= 0 ? 1 : -1;
      }
    }
  }
  let tb = 3 * 3600;
  let aim: V3 = [0, 0, 0];
  let it: {
    A: ReturnType<typeof runAscent>;
    park: Conic;
    tr: Conic;
    ta: number;
    hyp: ReturnType<typeof hyperbola>;
  } | null = null;
  for (let iter = 0; iter < 6; iter++) {
    const ta = tb + tof;
    const M = moonGeo(dateAt(launch, ta));
    const g = launchGeom("earth", site, launch, mul(unit(M.r), sign));
    const A = runAscent(p, "earth", launch, g, rLEO);
    const park = new Conic(A.ins.r, A.ins.v, A.T, muE);
    const n = unit(cross(A.ins.r, A.ins.v));
    const target = add(M.r, aim);
    const tin = perp(target, n);
    const pt = perigeeTransfer(rLEO, norm(tin), tof, muE);
    const P = rotate(unit(tin), n, -pt.th);
    let coast = angleAbout(unit(A.ins.r), P, n) / ((2 * Math.PI) / park.period);
    if (coast < 900) coast += park.period;
    tb = A.T + coast;
    const peri: Peri = { P, Q: cross(n, P), e: pt.e, p: pt.p };
    const tr = conicFromPeri(peri, muE, tb);
    const taN = tb + tof;
    const Mn = moonGeo(dateAt(launch, taN));
    const vinf = sub(tr.at(taN).v, Mn.v);
    const hyp = hyperbola(vinf, rLLO, muM, "in", unit(Mn.r));
    aim = mul(hyp.B, hyp.b);
    it = { A, park, tr, ta: taN, hyp };
  }
  if (!it) return failed(start, "earth", "moon", "No transfer found for this date. Try another time.");
  const { A, park, tr, ta, hyp } = it;
  const prop = A.prop;
  const plan = new Plan();
  const moonAt = (t: number) => moonGeo(dateAt(launch, t)).r;

  // ascent and parking orbit
  plan.leg("earth", (t) => A.at(t), A.T, 45, (t) => {
    const s = A.at(t);
    return { speed: s.speed, alt: s.alt };
  });
  plan.addEvents(A.events);
  plan.phase("Ascent", 0, A.T, 7);
  // trans-lunar injection
  const vPark = norm(park.at(tb).v);
  const dvTli = norm(tr.at(tb).v) - vPark;
  const tli = prop.burn(dvTli);
  plan.conic("earth", park, tb, tli.duration / 2);
  plan.event(tb - tli.duration / 2, "TLI BURN");
  for (const e of tli.events) plan.event(tb - tli.duration / 2 + e.dt, e.label);
  plan.phase("Parking orbit", A.T, tb - tli.duration / 2, 2.5);
  plan.phase("Trans-lunar injection", tb - tli.duration / 2, tb + tli.duration / 2, 2);
  if (prop.jettison()) plan.event(tb + tli.duration / 2 + 900, "STAGE SEP");

  // coast, then hand over to the Moon's hyperbola where the transfer enters its sphere
  const tS = bisect((t) => norm(sub(tr.at(t).r, moonAt(t))) - SOI_MOON, tb + 0.3 * tof, ta) ?? ta - 0.2 * tof;
  const tauH = hyperTime(hyp.peri, muM, SOI_MOON);
  const tP = tS + tauH;
  const H = conicFromPeri(hyp.peri, muM, tP);
  plan.conic("earth", tr, tS, Math.min(0.35 * tauH, 8 * 3600));
  plan.event(tS, "MOON SOI ENTRY");
  plan.phase("Coast to the Moon", tb + tli.duration / 2, tS, p.timing.duration);

  // lunar orbit insertion
  const vC = circV("moon", rLLO);
  const vP = norm(H.at(tP).v);
  const loi = prop.burn(vP - vC);
  const llo = new Conic(mul(hyp.peri.P, rLLO), mul(hyp.peri.Q, vC), tP, muM);
  plan.conic("moon", H, tP, loi.duration / 2);
  plan.event(tP - loi.duration / 2, "LOI BURN");
  plan.phase("Lunar approach", tS, tP - loi.duration / 2, 3);
  plan.phase("Lunar orbit insertion", tP - loi.duration / 2, tP + loi.duration / 2, 1.5);
  plan.dv.push({ label: "Launch to low Earth orbit", dv: A.dv }, { label: "Trans-lunar injection", dv: dvTli }, { label: "Lunar orbit insertion", dv: vP - vC });

  let arrival = tP;
  if (land) {
    const tDoi = tP + loi.duration / 2 + 1.25 * llo.period;
    plan.phase("Lunar orbit", tP + loi.duration / 2, tDoi, 2.5);
    arrival = orbitLanding(plan, "moon", launch, llo, tDoi);
  } else {
    const end = tP + 1.4 * llo.period;
    plan.conic("moon", llo, end);
    plan.phase("Lunar orbit", tP + loi.duration / 2, end, 4);
  }
  return plan.done({ launch, from: "earth", to: "moon", root: "earth", bodies: ["earth", "moon"], arrival, landed: land });
}

export function moonEarthMission(p: Project, start: Date, tofDays: number): Mission {
  const muE = BODIES.earth.mu;
  const muM = BODIES.moon.mu;
  const site = siteOf(p);
  const tof = tofDays * DAY;
  const rLLO = lowR("moon");
  const land = !!p.schedule.land;
  const launch = start;
  const RE = BODIES.earth.radiusKm;
  const ei = ENTRY.earth!;
  const rEI = RE + ei.alt;
  let rpE = land ? RE + 45 : lowR("earth");
  let tm = 6 * 3600;
  let aim: V3 = [0, 0, 0];
  let it: { A: ReturnType<typeof runAscent>; llo: Conic; hyp: ReturnType<typeof hyperbola>; ret: Conic; tTei: number; tauH: number } | null = null;
  for (let iter = 0; iter < 7; iter++) {
    const M = moonGeo(dateAt(launch, tm));
    const nE = unit(cross(M.r, M.v));
    const tin = perp(add(M.r, aim), nE);
    const pt = perigeeTransfer(rpE, norm(tin), tof, muE);
    const Pp = rotate(unit(tin), nE, pt.th);
    const ret = conicFromPeri({ P: Pp, Q: cross(nE, Pp), e: pt.e, p: pt.p }, muE, tm + tof);
    const vinf = sub(ret.at(tm).v, M.v);
    const s = unit(vinf);
    const g = launchGeom("moon", site, launch, s);
    const hyp = hyperbola(vinf, rLLO, muM, "out", cross(s, g.n));
    const A = runAscent(p, "moon", launch, g, rLLO);
    const llo = new Conic(A.ins.r, A.ins.v, A.T, muM);
    const n = unit(cross(A.ins.r, A.ins.v));
    let coast = angleAbout(unit(A.ins.r), hyp.peri.P, n) / ((2 * Math.PI) / llo.period);
    if (coast < 900) coast += llo.period;
    const tTei = A.T + coast;
    const tauH = hyperTime(hyp.peri, muM, SOI_MOON);
    const moonAt = (t: number) => moonGeo(dateAt(launch, t)).r;
    const tauC = (bisect((t) => norm(sub(ret.at(t).r, moonAt(t))) - SOI_MOON, tm, tm + 0.6 * tof) ?? tm + tauH) - tm;
    tm = tTei + tauH - tauC;
    aim = mul(hyp.B, hyp.b);
    if (land) {
      // aim the perigee so the capsule meets the air at the entry angle
      const s0 = ret.at(tm);
      const eps = dot(s0.v, s0.v) / 2 - muE / norm(s0.r);
      const vEI = Math.sqrt(2 * (eps + muE / rEI));
      const h = rEI * vEI * Math.cos((ei.fpa * Math.PI) / 180);
      const pp = (h * h) / muE;
      const e = Math.sqrt(Math.max(0, 1 + (2 * eps * h * h) / (muE * muE)));
      rpE = pp / (1 + e);
    }
    it = { A, llo, hyp, ret, tTei, tauH };
  }
  if (!it) return failed(start, "moon", "earth", "No transfer found for this date. Try another time.");
  const { A, llo, hyp, ret, tTei, tauH } = it;
  const prop = A.prop;
  const plan = new Plan();
  plan.leg("moon", (t) => A.at(t), A.T, 20, (t) => {
    const s = A.at(t);
    return { speed: s.speed, alt: s.alt };
  });
  plan.addEvents(A.events);
  plan.phase("Lunar ascent", 0, A.T, 5);
  // trans-Earth injection
  const H = conicFromPeri(hyp.peri, muM, tTei);
  const vC = norm(llo.at(tTei).v);
  const dvTei = norm(H.at(tTei).v) - vC;
  const tei = prop.burn(dvTei);
  plan.conic("moon", llo, tTei, tei.duration / 2);
  plan.event(tTei - tei.duration / 2, "TEI BURN");
  plan.phase("Lunar orbit", A.T, tTei - tei.duration / 2, 3);
  plan.phase("Trans-Earth injection", tTei - tei.duration / 2, tTei + tei.duration / 2, 2);
  const tX = tTei + tauH;
  plan.conic("moon", H, tX, Math.min(0.35 * tauH, 8 * 3600));
  plan.event(tX, "MOON SOI EXIT");
  plan.phase("Leaving the Moon", tTei + tei.duration / 2, tX, 3);
  plan.dv.push({ label: "Launch to low lunar orbit", dv: A.dv }, { label: "Trans-Earth injection", dv: dvTei });

  const tPer = ret.t0;
  let arrival: number;
  if (land) {
    const tEI = bisect((t) => norm(ret.at(t).r) - rEI, tPer - 0.5 * tof, tPer) ?? tPer - 600;
    plan.conic("earth", ret, tEI, 15);
    plan.phase("Coast to Earth", tX, tEI, p.timing.duration);
    arrival = addLanding(plan, "earth", launch, tEI, ret.at(tEI), false);
  } else {
    const sp = ret.at(tPer);
    const vc = circV("earth", norm(sp.r));
    const cap = prop.burn(norm(sp.v) - vc);
    const leo = new Conic(sp.r, scaleTo(sp.v, vc), tPer, muE);
    plan.conic("earth", ret, tPer, cap.duration / 2);
    plan.event(tPer - cap.duration / 2, "CAPTURE BURN");
    const end = tPer + 1.3 * leo.period;
    plan.conic("earth", leo, end);
    plan.phase("Coast to Earth", tX, tPer - cap.duration / 2, p.timing.duration);
    plan.phase("Earth orbit insertion", tPer - cap.duration / 2, tPer + cap.duration / 2, 2);
    plan.phase("Earth orbit", tPer + cap.duration / 2, end, 3);
    plan.dv.push({ label: "Capture into Earth orbit", dv: norm(sp.v) - vc });
    arrival = tPer;
  }
  return plan.done({ launch, from: "moon", to: "earth", root: "earth", bodies: ["earth", "moon"], arrival, landed: land });
}
