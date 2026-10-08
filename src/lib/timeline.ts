import type { Mission } from "./mission";
import type { Project } from "./types";

/**
 * Video time → simulated time. Each mission phase gets a share of the video (ascent and
 * arrival are slow, the cruise is fast and eased), so months of coasting fit in seconds.
 */
export interface Part {
  v0: number;
  v1: number;
  t0: number;
  t1: number;
  ease: boolean;
  name: string;
}
export interface Timeline {
  base: Date;
  hold: number;
  holdEnd: number;
  parts: Part[];
  total: number;
  /** marks for the timeline bar: phase boundaries, seconds of video */
  marks: number[];
}

const easeIO = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);

export function makeTimeline(p: Project, m: Mission | null): Timeline {
  const hold = p.output.holdStart;
  const holdEnd = p.output.holdEnd;
  let parts: Part[];
  let base: Date;
  if (p.mode === "observer" || !m || !m.ok) {
    base = new Date(p.schedule.date);
    parts = [{ v0: 0, v1: p.timing.duration, t0: 0, t1: p.schedule.spanDays * 86400, ease: false, name: "Observation" }];
  } else {
    base = m.launch;
    let v = 0;
    parts = m.phases.map((ph) => {
      const part = { v0: v, v1: v + ph.video, t0: ph.t0, t1: ph.t1, ease: ph.ease, name: ph.name };
      v += ph.video;
      return part;
    });
  }
  const body = parts[parts.length - 1].v1;
  return { base, hold, holdEnd, parts, total: hold + body + holdEnd, marks: parts.slice(1).map((x) => hold + x.v0) };
}

/** Simulated seconds after `base` at video time t. */
export function simAt(tl: Timeline, t: number): number {
  const v = Math.max(0, t - tl.hold);
  const part = tl.parts.find((x) => v <= x.v1) ?? tl.parts[tl.parts.length - 1];
  const u = Math.min(1, Math.max(0, (v - part.v0) / Math.max(1e-6, part.v1 - part.v0)));
  return part.t0 + (part.ease ? easeIO(u) : u) * (part.t1 - part.t0);
}

export function dateAt(tl: Timeline, t: number): Date {
  return new Date(tl.base.getTime() + simAt(tl, t) * 1000);
}
