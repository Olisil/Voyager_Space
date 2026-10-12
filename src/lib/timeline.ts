import type { BodyId } from "./bodies";
import { invert, pchip, type Curve } from "./interp";
import type { Mission } from "./mission";
import type { Project } from "./types";

/**
 * Video time → simulated time. Each mission phase gets a share of the video (the ascent and
 * the arrival are slow, the cruise is fast), joined by a monotone cubic so the pace changes
 * smoothly instead of jumping at phase boundaries.
 */
export interface Part {
  v0: number;
  v1: number;
  t0: number;
  t1: number;
  name: string;
  frame: BodyId | null;
}
export interface Timeline {
  base: Date;
  hold: number;
  holdEnd: number;
  parts: Part[];
  /** length of the moving part of the video, seconds */
  body: number;
  total: number;
  /** marks for the timeline bar: phase boundaries, seconds of video */
  marks: number[];
  warp: Curve;
}

export function makeTimeline(p: Project, m: Mission | null): Timeline {
  const hold = p.output.holdStart;
  const holdEnd = p.output.holdEnd;
  let parts: Part[];
  let base: Date;
  if (p.mode === "observer") {
    base = new Date(p.schedule.date);
    parts = [{ v0: 0, v1: p.timing.duration, t0: 0, t1: p.schedule.spanDays * 86400, name: "Observation", frame: null }];
  } else if (!m || !m.ok || !m.phases.length) {
    // no flight yet (no destination, or none found): time stands still at the launch date
    base = new Date(p.schedule.date);
    parts = [{ v0: 0, v1: p.timing.duration, t0: 0, t1: 1e-3, name: "Before launch", frame: null }];
  } else {
    base = m.launch;
    parts = [];
    let v = 0;
    let t = 0;
    for (const ph of m.phases) {
      const t1 = Math.max(t + 1e-3, ph.t1);
      const dv = Math.max(0.3, ph.video);
      parts.push({ v0: v, v1: v + dv, t0: t, t1, name: ph.name, frame: ph.frame ?? null });
      v += dv;
      t = t1;
    }
  }
  const xs = [parts[0].v0, ...parts.map((x) => x.v1)];
  const ys = [parts[0].t0, ...parts.map((x) => x.t1)];
  const warp = pchip(xs, ys);
  const body = xs[xs.length - 1];
  return { base, hold, holdEnd, parts, body, total: hold + body + holdEnd, marks: parts.slice(1).map((x) => hold + x.v0), warp };
}

/** Simulated seconds after `base` at video time t. */
export function simAt(tl: Timeline, t: number): number {
  const v = Math.max(0, Math.min(tl.body, t - tl.hold));
  return Math.max(tl.parts[0].t0, Math.min(tl.parts[tl.parts.length - 1].t1, tl.warp.f(v)));
}

/** Video time when the simulation reaches `sim` seconds. */
export function videoAt(tl: Timeline, sim: number): number {
  return tl.hold + invert((v) => tl.warp.f(v), sim, 0, tl.body);
}

export function dateAt(tl: Timeline, t: number): Date {
  return new Date(tl.base.getTime() + simAt(tl, t) * 1000);
}

/** The part (phase) playing at video time t. */
export function partAt(tl: Timeline, t: number): Part {
  const v = t - tl.hold;
  return tl.parts.find((x) => v <= x.v1) ?? tl.parts[tl.parts.length - 1];
}

/**
 * Which body's frame the path is drawn in at video time t, as weights: one frame per phase,
 * cross-faded where the phase changes. Into and out of the long coast the hand-over takes
 * a good part of the coast, so the picture eases from one frame to the other while the
 * view is wide; elsewhere it takes about a second.
 */
export function frameWeights(tl: Timeline, t: number): Partial<Record<BodyId, number>> {
  const out: Partial<Record<BodyId, number>> = {};
  const P = tl.parts;
  const v = t - tl.hold;
  const add = (f: BodyId | null, w: number) => {
    if (f && w > 0) out[f] = (out[f] ?? 0) + w;
  };
  let main = 0;
  P.forEach((x, i) => {
    if (x.t1 - x.t0 > P[main].t1 - P[main].t0) main = i;
  });
  for (let j = 0; j < P.length - 1; j++) {
    const a = P[j];
    const b = P[j + 1];
    if (a.frame === b.frame) continue;
    let lo: number;
    let hi: number;
    if (j + 1 === main && !b.frame) {
      lo = b.v0;
      hi = b.v0 + 0.35 * (b.v1 - b.v0);
    } else if (j === main && !a.frame) {
      lo = a.v1 - 0.6 * (a.v1 - a.v0);
      hi = a.v1;
    } else {
      const h = Math.min(0.6, 0.45 * (a.v1 - a.v0), 0.45 * (b.v1 - b.v0));
      lo = a.v1 - h;
      hi = a.v1 + h;
    }
    if (v > lo && v < hi) {
      const x = (v - lo) / (hi - lo);
      const w = x * x * (3 - 2 * x);
      add(a.frame, 1 - w);
      add(b.frame, w);
      return out;
    }
  }
  const k = P.findIndex((x) => v <= x.v1);
  add((k < 0 ? P[P.length - 1] : P[k]).frame, 1);
  return out;
}
