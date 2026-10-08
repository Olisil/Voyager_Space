import { displayPos, displayRadius, type BodyId, type V3 } from "./bodies";
import { vehiclePos, type Mission } from "./mission";
import { add, mul, norm, sub, unit } from "./orbits";
import { dateAt, simAt, type Timeline } from "./timeline";
import type { Keypoint, Project } from "./types";

export interface CameraCtx {
  project: Project;
  mission: Mission | null;
  tl: Timeline;
  /** the user's current view: camera position minus target, and what it looks at */
  view: { offset: V3; focus: BodyId };
}

export interface CameraPose {
  pos: V3;
  target: V3;
}

const boostOf = (p: Project) => p.look.planetSize;

function targetPos(ctx: CameraCtx, target: Keypoint["target"], t: number): V3 {
  const date = dateAt(ctx.tl, t);
  if (target === "vehicle" && ctx.mission) return vehiclePos(ctx.mission, simAt(ctx.tl, t), boostOf(ctx.project)) ?? [0, 0, 0];
  return displayPos(target === "vehicle" ? "earth" : target, date, boostOf(ctx.project));
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

export function cameraAt(ctx: CameraCtx, t: number): CameraPose {
  const p = ctx.project;
  const kps = [...p.camera.keypoints].sort((a, b) => a.t - b.t);
  if (p.camera.mode === "keypoints" && kps.length) {
    const pos = kps.map((k) => add(targetPos(ctx, k.target, t), k.offset));
    const tgt = kps.map((k) => targetPos(ctx, k.target, t));
    if (t <= kps[0].t || kps.length === 1) return { pos: pos[0], target: tgt[0] };
    if (t >= kps[kps.length - 1].t) return { pos: pos[pos.length - 1], target: tgt[tgt.length - 1] };
    const i = kps.findIndex((k, j) => j < kps.length - 1 && t >= k.t && t <= kps[j + 1].t);
    const u = (t - kps[i].t) / Math.max(1e-6, kps[i + 1].t - kps[i].t);
    const s = u * u * (3 - 2 * u);
    const at = (arr: V3[], j: number) => arr[Math.max(0, Math.min(arr.length - 1, j))];
    return {
      pos: catmull(at(pos, i - 1), at(pos, i), at(pos, i + 1), at(pos, i + 2), s),
      target: catmull(at(tgt, i - 1), at(tgt, i), at(tgt, i + 1), at(tgt, i + 2), s),
    };
  }
  const m = ctx.mission;
  if (p.mode === "vehicle" && p.camera.mode === "follow" && m && m.ok) {
    // keep the user's viewing angle; pull back so the nearest body and the craft both fit
    const sim = simAt(ctx.tl, t);
    const date = dateAt(ctx.tl, t);
    const v = vehiclePos(m, sim, boostOf(p)) ?? [0, 0, 0];
    const near = [m.from, m.to].map((b) => ({ b, d: norm(sub(v, displayPos(b, date, boostOf(p)))) }));
    const wA = Math.exp(-near[0].d / 0.05);
    const wB = Math.exp(-near[1].d / 0.05);
    const rd = (displayRadius(near[0].b, boostOf(p)) * wA + displayRadius(near[1].b, boostOf(p)) * wB) / Math.max(1e-9, wA + wB);
    const dNear = Math.min(near[0].d, near[1].d);
    const r0 = Number.isFinite(rd) && rd > 0 ? rd : displayRadius("earth", boostOf(p));
    const dist = 7 * r0 + 2.4 * dNear;
    // aim a little towards the nearest body so it stays in the picture with the craft
    const nb = near[0].d < near[1].d ? near[0].b : near[1].b;
    const nbPos = displayPos(nb, date, boostOf(p));
    const k = 0.5 * Math.min(1, dNear / (10 * r0));
    const target = add(v, mul(sub(nbPos, v), k));
    return { pos: add(target, mul(unit(ctx.view.offset), dist)), target };
  }
  const target = displayPos(ctx.view.focus, dateAt(ctx.tl, t), boostOf(p));
  return { pos: add(target, ctx.view.offset), target };
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
