import { bodyBasis, displayPos, displayRadius, surfaceDir, type BodyId, type V3 } from "./bodies";
import { flightPath } from "./display";
import type { Mission } from "./mission";
import { add, cross, dot, mul, norm, sub, unit } from "./orbits";
import { dateAt, frameWeights, simAt, videoAt, type Timeline } from "./timeline";
import { siteOf, type Keypoint, type LookTarget, type Project } from "./types";

export interface CameraCtx {
  project: Project;
  mission: Mission | null;
  tl: Timeline;
  /** the user's current view: camera position minus target, what it looks at, and when (video s) */
  view: { offset: V3; focus: LookTarget; t?: number };
}

export interface CameraPose {
  pos: V3;
  target: V3;
}

const boostOf = (p: Project) => p.look.planetSize;

/** The craft's place in the picture at video time t. */
export function vehicleAt(ctx: Pick<CameraCtx, "project" | "mission" | "tl">, t: number): V3 | null {
  const fp = ctx.project.mode === "vehicle" ? flightPath(ctx.mission, boostOf(ctx.project)) : null;
  return fp ? fp.vehicle(simAt(ctx.tl, t), frameWeights(ctx.tl, t)) : null;
}

/** A point on a body's surface (lift: radii from the centre), as drawn at a date. */
export function surfacePos(b: BodyId, lat: number, lon: number, date: Date, boost: number, lift = 1): V3 {
  const c = displayPos(b, date, boost);
  return add(c, mul(surfaceDir(bodyBasis(b, date), lat, lon), displayRadius(b, boost) * lift));
}

/** Where the launch site is drawn at a date: on the starting body's surface, turning with it. */
export function sitePos(p: Project, date: Date, lift = 1): V3 {
  const s = siteOf(p);
  return surfacePos(p.start.body, s.lat, s.lon, date, p.look.planetSize, lift);
}

/** An offset that turns with the starting body (for views of the launch site) from one moment to another. */
export function turnWithBody(p: Project, off: V3, from: Date, to: Date): V3 {
  const b0 = bodyBasis(p.start.body, from);
  const b1 = bodyBasis(p.start.body, to);
  const c: V3 = [dot(off, b0.x), dot(off, b0.y), dot(off, b0.z)];
  return add(add(mul(b1.x, c[0]), mul(b1.y, c[1])), mul(b1.z, c[2]));
}

/**
 * How much of the start-of-journey symbol shows at video time t: all of it until the ascent
 * has drawn the path out of the launch site into orbit, then it fades in a second.
 */
export function startAlpha(ctx: Pick<CameraCtx, "project" | "mission" | "tl">, t: number): number {
  if (ctx.project.mode !== "vehicle") return 0;
  const m = ctx.mission;
  if (!m?.ok || !m.phases.length) return 1;
  const x = t - videoAt(ctx.tl, m.phases[0].t1);
  return x <= 0 ? 1 : x >= 1 ? 0 : 1 - x * x * (3 - 2 * x);
}

export function targetPos(ctx: Pick<CameraCtx, "project" | "mission" | "tl">, target: Keypoint["target"], t: number): V3 {
  if (target === "vehicle") return vehicleAt(ctx, t) ?? displayPos("earth", dateAt(ctx.tl, t), boostOf(ctx.project));
  if (target === "site") return sitePos(ctx.project, dateAt(ctx.tl, t));
  return displayPos(target, dateAt(ctx.tl, t), boostOf(ctx.project));
}

/**
 * "Keep the camera above the craft": near a body the follow camera's direction is pulled
 * towards the local vertical (from the body's centre through the craft) and a little behind
 * the craft, so the craft is always seen against the body, never hidden by it, and the camera
 * never dips into it. `w` fades the pull in close to the body and out a few radii away.
 */
export interface Above {
  up: V3;
  back: V3;
  w: number;
}
const ABOVE_UP = 1.4;
const ABOVE_BACK = 0.35;
export function aboveFrame(ctx: Pick<CameraCtx, "project" | "mission" | "tl">, t: number): Above | null {
  const m = ctx.mission;
  const v = vehicleAt(ctx, t);
  if (!ctx.project.camera.above || !m?.ok || !m.traj || !v) return null;
  const boost = boostOf(ctx.project);
  const date = dateAt(ctx.tl, t);
  let best: BodyId | null = null;
  let gap = Infinity;
  let c: V3 = [0, 0, 0];
  for (const b of m.bodies) {
    const cb = displayPos(b, date, boost);
    const r = displayRadius(b, boost);
    const g = (norm(sub(v, cb)) - r) / r;
    if (g < gap) {
      gap = g;
      best = b;
      c = cb;
    }
  }
  if (!best) return null;
  const x = (gap - 1.5) / 3;
  const w = x <= 0 ? 1 : x >= 1 ? 0 : 1 - x * x * (3 - 2 * x);
  if (w <= 0) return null;
  const up = unit(sub(v, c));
  // which way the craft moves over the ground: from its true state relative to the body
  const sim = simAt(ctx.tl, t);
  const s = m.traj.at(sim);
  const bs = m.traj.ephem.at(best, sim);
  const rr = sub(s.r, bs.r);
  const vv = sub(s.v, bs.v);
  let n = cross(rr, vv);
  if (norm(n) < 1e-9) n = cross(up, Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  const fwd = unit(cross(unit(n), up));
  return { up, back: mul(fwd, -1), w };
}
export function applyAbove(dir: V3, a: Above): V3 {
  const d = add(add(dir, mul(a.up, ABOVE_UP * a.w)), mul(a.back, ABOVE_BACK * a.w));
  return norm(d) > 1e-9 ? unit(d) : a.up;
}
/** The direction that applyAbove turns into `dir` (for keeping a dragged view as it is). */
export function unapplyAbove(dir: V3, a: Above): V3 {
  const k = add(mul(a.up, ABOVE_UP * a.w), mul(a.back, ABOVE_BACK * a.w));
  const fk = dot(dir, k);
  const disc = fk * fk - dot(k, k) + 1;
  // outside the reachable cap: the closest reachable direction
  const sc = disc >= 0 ? fk + Math.sqrt(disc) : Math.max(0, fk);
  const d = sub(mul(dir, sc), k);
  return norm(d) > 1e-9 ? unit(d) : dir;
}

/** Centripetal Catmull–Rom, so the camera glides through the keypoints without overshooting. */
function catmull(p0: V3, p1: V3, p2: V3, p3: V3, u: number): V3 {
  const tj = (a: V3, b: V3, t: number) => t + Math.max(1e-9, Math.sqrt(norm(sub(b, a))));
  const t0 = 0;
  const t1 = tj(p0, p1, t0);
  const t2 = tj(p1, p2, t1);
  const t3 = tj(p2, p3, t2);
  const t = t1 + (t2 - t1) * u;
  const lerp = (a: V3, b: V3, ta: number, tb: number) => add(mul(a, (tb - t) / (tb - ta)), mul(b, (t - ta) / (tb - ta)));
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/**
 * The follow camera's framing at video time t: what it looks at and how far back it sits
 * (before the user's zoom). Close to a body the craft is framed against it; out in the
 * open the camera pulls back so the nearest body stays in the picture. Every body of the
 * mission votes, weighted by how close it is, so nothing jumps.
 */
export function followFrame(ctx: Pick<CameraCtx, "project" | "mission" | "tl">, t: number): { target: V3; dist: number } | null {
  const m = ctx.mission;
  const v = vehicleAt(ctx, t);
  if (!m || !m.ok || !v) return null;
  const boost = boostOf(ctx.project);
  const date = dateAt(ctx.tl, t);
  let wSum = 0;
  let dist = 0;
  let pull: V3 = [0, 0, 0];
  for (const b of m.bodies) {
    const c = displayPos(b, date, boost);
    const r = displayRadius(b, boost);
    const gap = Math.max(0, norm(sub(v, c)) - r);
    // close in at the pad and on the ground, further out once in orbit and beyond
    const d = r * (0.9 + 2.5 * (gap / (gap + 0.3 * r))) + 1.5 * gap;
    const k = 0.18 + 0.32 * (gap / (gap + 4 * r));
    const w = 1 / (d * d * d * d);
    wSum += w;
    dist += w * d;
    pull = add(pull, mul(sub(c, v), w * k));
  }
  if (!wSum) return { target: v, dist: 0.05 };
  return { target: add(v, mul(pull, 1 / wSum)), dist: dist / wSum };
}

/** A view of the craft near a body: over the orbit plane, towards the site, leaning sunwards. */
function viewOf(n: V3, site: V3, sun: V3): V3 {
  const d = add(add(mul(n, 0.62), mul(site, 0.6)), mul(sun, 0.38));
  return norm(d) > 1e-6 ? unit(d) : n;
}

const views = new WeakMap<Mission, { dep: V3; arr: V3 }>();
/** Good default angles at both ends of a flight: the launch, and the arrival or landing. */
function endViews(m: Mission): { dep: V3; arr: V3 } {
  let v = views.get(m);
  if (v) return v;
  const legs = m.traj!.legs;
  const sunFrom = (b: BodyId, d: Date): V3 => {
    const pos = displayPos(b === "moon" ? "earth" : b, d, 1);
    return norm(pos) > 0 ? mul(unit(pos), -1) : [0, 0, 1];
  };
  const l0 = legs[0];
  const ins = l0.at(l0.t1);
  const dep = viewOf(unit(cross(ins.r, ins.v)), unit(l0.at(0).r), sunFrom(m.from, m.launch));
  let arr = dep;
  if (m.to !== m.from) {
    const tA = (m.arrival.getTime() - m.launch.getTime()) / 1000;
    // the leg around the destination at arrival, just before it
    const k = legs.findIndex((l) => l.t1 >= tA - 1);
    const leg = legs[Math.max(0, k)];
    const s = leg.at(Math.max(0, tA - 300));
    const last = legs[legs.length - 1];
    const site = last.center === leg.center ? unit(last.at(last.t1).r) : unit(s.r);
    const n = unit(cross(s.r, s.v));
    arr = viewOf(norm(n) > 0 ? n : dep, site, sunFrom(m.to, m.arrival));
  }
  v = { dep, arr };
  views.set(m, v);
  return v;
}

/** Spherical blend of two unit vectors. */
function slerp(a: V3, b: V3, u: number): V3 {
  const c = Math.max(-1, Math.min(1, dot(a, b)));
  const th = Math.acos(c);
  if (th < 1e-4) return a;
  let axis = cross(a, b);
  if (norm(axis) < 1e-6) axis = Math.abs(a[1]) < 0.9 ? cross(a, [0, 1, 0]) : cross(a, [1, 0, 0]);
  axis = unit(axis);
  const ang = th * u;
  return unit(add(add(mul(a, Math.cos(ang)), mul(cross(axis, a), Math.sin(ang))), mul(axis, dot(axis, a) * (1 - Math.cos(ang)))));
}

/**
 * Default viewing direction for following: at launch from over the parking orbit, towards
 * the pad and the sunlit side; at the destination the same towards the arrival or landing
 * site. The turn from one to the other happens during the long coast.
 */
export function followDir(ctx: Pick<CameraCtx, "project" | "mission" | "tl">, t: number): V3 {
  const m = ctx.mission;
  if (!m?.ok || !m.traj) return unit(defaultOffset(ctx.project.start.body, 1, new Date(ctx.project.schedule.date)));
  const { dep, arr } = endViews(m);
  // the coast: the phase that covers the most simulated time
  const parts = ctx.tl.parts;
  let main = parts[0];
  for (const x of parts) if (x.t1 - x.t0 > main.t1 - main.t0) main = x;
  const u = (t - ctx.tl.hold - main.v0) / Math.max(1e-6, main.v1 - main.v0);
  const w = u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
  return slerp(dep, arr, w);
}

export function defaultFollowDir(p: Project, m: Mission | null): V3 {
  if (!m?.ok || !m.traj) return unit(defaultOffset(p.start.body === "moon" ? "earth" : p.start.body, 1, new Date(p.schedule.date)));
  return endViews(m).dep;
}

export function followPose(ctx: Pick<CameraCtx, "project" | "mission" | "tl">, t: number): CameraPose | null {
  const f = followFrame(ctx, t);
  if (!f) return null;
  const c = ctx.project.camera.follow;
  let dir = c.dir ? unit(c.dir) : followDir(ctx, t);
  const a = aboveFrame(ctx, t);
  if (a) dir = applyAbove(dir, a);
  return { target: f.target, pos: add(f.target, mul(dir, f.dist * (c.zoom || 1))) };
}

export function cameraAt(ctx: CameraCtx, t: number): CameraPose {
  const p = ctx.project;
  const kps = [...p.camera.keypoints].sort((a, b) => a.t - b.t);
  if (p.camera.mode === "keypoints" && kps.length) {
    const now = dateAt(ctx.tl, t);
    // views of the launch site turn with the ground
    const off = (k: Keypoint): V3 => (k.target === "site" ? turnWithBody(p, k.offset, dateAt(ctx.tl, k.t), now) : k.offset);
    const pos = kps.map((k) => add(targetPos(ctx, k.target, t), off(k)));
    const tgt = kps.map((k) => targetPos(ctx, k.target, t));
    if (t <= kps[0].t || kps.length === 1) return { pos: pos[0], target: tgt[0] };
    if (t >= kps[kps.length - 1].t) return { pos: pos[pos.length - 1], target: tgt[tgt.length - 1] };
    const i = kps.findIndex((k, j) => j < kps.length - 1 && t >= k.t && t <= kps[j + 1].t);
    const u = (t - kps[i].t) / Math.max(1e-6, kps[i + 1].t - kps[i].t);
    const s = u * u * (3 - 2 * u);
    const at = (arr: V3[], j: number) => arr[Math.max(0, Math.min(arr.length - 1, j))];
    const target = catmull(at(tgt, i - 1), at(tgt, i), at(tgt, i + 1), at(tgt, i + 2), s);
    return { pos: swingOut(catmull(at(pos, i - 1), at(pos, i), at(pos, i + 1), at(pos, i + 2), s), target, tgt[i], tgt[i + 1], s), target };
  }
  if (p.mode === "vehicle" && p.camera.mode === "follow") {
    const f = followPose(ctx, t);
    if (f) return f;
  }
  const target = targetPos(ctx, ctx.view.focus, t);
  const v = ctx.view;
  const off = v.focus === "site" && v.t !== undefined ? turnWithBody(p, v.offset, dateAt(ctx.tl, v.t), dateAt(ctx.tl, t)) : v.offset;
  return { pos: add(target, off), target };
}

/**
 * Between two keypoints that look at things far apart (Mars, then Jupiter), the camera on its
 * own would pass close to empty space half-way. It swings out instead, to the side of the way
 * between them and a little above, far enough to keep that way in view, and back in to the
 * next keypoint. `s` is the eased progress through the segment; nothing changes at the ends.
 */
function swingOut(pos: V3, target: V3, a: V3, b: V3, s: number): V3 {
  const sep = norm(sub(b, a));
  const bump = Math.sin(Math.PI * s);
  if (sep < 1e-9 || bump <= 0) return pos;
  const off = sub(pos, target);
  const d = norm(off);
  const want = 1.2 * sep;
  if (want <= d) return pos;
  const along = unit(sub(b, a));
  let side = cross(along, [0, 1, 0]);
  if (norm(side) < 1e-6) side = cross(along, [1, 0, 0]);
  side = unit(side);
  if (d > 0 && dot(side, off) < 0) side = mul(side, -1);
  const out = unit(add(side, [0, 0.35, 0]));
  const from = d > 0 ? unit(off) : out;
  const mix = add(mul(from, 1 - bump), mul(out, bump));
  const dir = norm(mix) > 1e-6 ? unit(mix) : out;
  return add(target, mul(dir, d + (want - d) * bump));
}

/** A sensible first view of a body: from the sunlit side, a little above. */
export function defaultOffset(body: BodyId, boost: number, date: Date): V3 {
  const p = displayPos(body, date, boost);
  const toSun = norm(p) > 0 ? mul(unit(p), -1) : ([0, 0, 1] as V3);
  const side = unit([toSun[2], 0, -toSun[0]]);
  const dir = unit(add(add(mul(toSun, 0.75), mul(side, 0.55)), [0, 0.35, 0]));
  const r = body === "sun" ? 22 : 6;
  return mul(dir, displayRadius(body, boost) * r);
}
