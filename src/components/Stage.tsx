import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { BODY_IDS, displayRadius, type V3 } from "../lib/bodies";
import { cameraAt, defaultOffset, followDir, followFrame, targetPos, vehicleAt, type CameraCtx } from "../lib/camera";
import type { Mission } from "../lib/mission";
import { drawOverlay } from "../lib/overlay";
import { SpaceScene, texturesReady } from "../lib/scene";
import { dateAt, frameWeights, simAt, type Timeline } from "../lib/timeline";
import { SPACEPORTS as SPACEPORT_LIST, type LookTarget, type Project } from "../lib/types";

export interface StageHandle {
  /**
   * The view as a keypoint would keep it: what it looks at (the body or craft nearest to the
   * point the view turns around) and the camera's place relative to that, at this moment.
   */
  currentView: () => { target: LookTarget; offset: V3 };
  /** Look at a body (or the craft) from a pleasant angle. Over a keypoint move, the user takes the view. */
  frameBody: (b: LookTarget) => void;
}

type Follow = Project["camera"]["follow"];

/**
 * How the view is steered:
 * - free: the user turns and zooms around the focus; the view keeps up with it as time moves;
 * - follow: rides along with the craft (dragging and zooming set the angle and distance kept);
 * - keypoints: the camera move from the keypoints, at the current moment, playing or not.
 *   Grabbing the view (drag, scroll, or frameBody) hands it to the user, who then turns it
 *   around what it looked at, as in the free view; `onOverride` says so and names that
 *   target. The editor gives the move back by setting `override` to false.
 */
export type CamMode = "free" | "follow" | "keypoints";

export const Stage = forwardRef<
  StageHandle,
  {
    project: Project;
    mission: Mission | null;
    tl: Timeline;
    t: number;
    camMode: CamMode;
    /** keypoints mode: the user has the view; false gives the keypoint move back */
    override: boolean;
    onOverride?: (target: LookTarget) => void;
    onFollowChange?: (f: Follow) => void;
    focus: LookTarget;
    showSpaceports: boolean;
    onPickSpaceport?: (id: string) => void;
    width: number;
    height: number;
  }
>(function Stage(props, ref) {
  const glRef = useRef<HTMLCanvasElement>(null);
  const ovRef = useRef<HTMLCanvasElement>(null);
  const space = useRef<SpaceScene | null>(null);
  const controls = useRef<OrbitControls | null>(null);
  const lastTarget = useRef<THREE.Vector3 | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const frameReq = useRef(0);
  // follow camera: the angle and zoom the user picked, and the auto distance of the last frame
  // (dir null: the automatic angle, which turns from the launch view to the arrival view)
  const followState = useRef<{ dir: V3 | null; zoom: number; dist: number } | null>(null);
  const applying = useRef(false);
  const saveTimer = useRef(0);
  // keypoints mode: the user has the view and turns it around `grabFocus`
  const grabbed = useRef(false);
  const grabFocus = useRef<LookTarget | null>(null);

  const ctxOf = (p: typeof props) => ({ project: p.project, mission: p.mission, tl: p.tl });
  const focusAt = (p: typeof props, f: LookTarget) => new THREE.Vector3(...targetPos(ctxOf(p), f, p.t));
  const focusRadius = (p: typeof props, f: LookTarget) => (f === "vehicle" ? displayRadius("moon", p.project.look.planetSize) * 0.05 : displayRadius(f, p.project.look.planetSize));
  const offsetFor = (p: typeof props, f: LookTarget): V3 => {
    if (f !== "vehicle") return defaultOffset(f, p.project.look.planetSize, dateAt(p.tl, p.t));
    const fr = followFrame(ctxOf(p), p.t);
    const dir = followDir(ctxOf(p), p.t);
    const d = fr?.dist ?? 0.05;
    return [dir[0] * d, dir[1] * d, dir[2] * d];
  };
  /** what the free view turns around */
  const freeFocus = (p: typeof props): LookTarget => (grabbed.current && grabFocus.current) || p.focus;
  const posing = (p: typeof props) => p.camMode === "keypoints" && !grabbed.current;
  /** the body or craft nearest to a point of the scene, now */
  const nearest = (p: typeof props, at: THREE.Vector3): LookTarget => {
    const candidates: LookTarget[] = p.project.mode === "vehicle" && vehicleAt(ctxOf(p), p.t) ? ["vehicle", ...BODY_IDS] : [...BODY_IDS];
    let best: LookTarget = p.focus;
    let bestD = Infinity;
    for (const f of candidates) {
      const d = focusAt(p, f).distanceTo(at);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    return best;
  };

  const draw = () => {
    const s = space.current;
    if (!s) return;
    const p = latest.current;
    const date = dateAt(p.tl, p.t);
    const vehicleMode = p.project.mode === "vehicle" && !!p.mission?.ok;
    const sim = vehicleMode ? simAt(p.tl, p.t) : null;
    s.update({
      date,
      boost: p.project.look.planetSize,
      sim,
      mission: p.project.mode === "vehicle" ? p.mission : null,
      look: p.project.look,
      showSpaceports: p.showSpaceports,
      selectedSpaceport: p.project.start.body === "earth" ? p.project.start.site : null,
      frames: vehicleMode ? frameWeights(p.tl, p.t) : undefined,
    });
    const c = controls.current!;
    const frame = p.camMode === "follow" ? followFrame(ctxOf(p), p.t) : null;
    applying.current = true;
    if (frame) {
      if (!followState.current) {
        const f = p.project.camera.follow;
        followState.current = { dir: f.dir, zoom: f.zoom || 1, dist: frame.dist };
      }
      const st = followState.current;
      st.dist = frame.dist;
      const dir = st.dir ?? followDir(ctxOf(p), p.t);
      c.enablePan = false;
      c.minDistance = frame.dist * 0.08;
      c.maxDistance = frame.dist * 40;
      c.target.set(...frame.target);
      const d = frame.dist * st.zoom;
      s.camera.position.set(frame.target[0] + dir[0] * d, frame.target[1] + dir[1] * d, frame.target[2] + dir[2] * d);
      s.camera.lookAt(c.target);
      lastTarget.current = null;
    } else if (posing(p)) {
      // the move at this moment; the controls stay live so a drag can take over
      c.enablePan = true;
      c.minDistance = 0;
      c.maxDistance = Infinity;
      const ctx: CameraCtx = { ...ctxOf(p), view: { offset: [0, 0, 1], focus: p.focus } };
      const pose = cameraAt(ctx, p.t);
      s.camera.position.set(...pose.pos);
      c.target.set(...pose.target);
      s.camera.lookAt(c.target);
      lastTarget.current = null;
    } else {
      // free: keep up with the focus as time moves
      const f = freeFocus(p);
      c.enablePan = true;
      c.maxDistance = Infinity;
      const tgt = focusAt(p, f);
      if (lastTarget.current) s.camera.position.add(tgt.clone().sub(lastTarget.current));
      c.target.copy(tgt);
      lastTarget.current = tgt.clone();
      // never inside the body, and no jump when a keypoint view starts closer than that
      c.minDistance = Math.min(focusRadius(p, f) * 1.15, s.camera.position.distanceTo(tgt) * 0.999);
      c.update();
    }
    applying.current = false;
    s.render();
    // labels, HUD and date
    const ov = ovRef.current!;
    const g = ov.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, ov.width, ov.height);
    const ports =
      p.showSpaceports && p.project.start.body === "earth"
        ? (() => {
            const e = s.nodes.get("earth")!;
            const site = p.project.start.site;
            const out: { id: string; x: number; y: number }[] = [];
            const m = e.spin.matrixWorld;
            const port = (lat: number, lon: number) => {
              const la = (lat * Math.PI) / 180;
              const lo = (lon * Math.PI) / 180;
              return new THREE.Vector3(1.004 * Math.cos(la) * Math.cos(lo), 1.004 * Math.sin(la), -1.004 * Math.cos(la) * Math.sin(lo)).applyMatrix4(m);
            };
            for (const sp of SPACEPORT_LIST) {
              if (sp.id !== site) continue;
              const w = port(sp.lat, sp.lon);
              const scr = s.project([w.x, w.y, w.z]);
              // hide it when it is on the far side of the globe
              const toCam = s.camera.position.clone().sub(w);
              const normal = w.clone().sub(e.group.position).normalize();
              if (scr && toCam.dot(normal) > 0) out.push({ id: sp.id, ...scr });
            }
            return out;
          })()
        : undefined;
    const labelFocus = frame || posing(p) ? null : freeFocus(p);
    drawOverlay(g, {
      scene: s,
      date,
      boost: p.project.look.planetSize,
      width: p.width,
      height: p.height,
      scale: dpr,
      labels: p.project.look.labels,
      dateStamp: p.project.look.dateStamp,
      credit: null,
      spaceports: { show: p.showSpaceports, selected: p.project.start.site, positions: ports },
      focus: labelFocus === "vehicle" ? null : labelFocus,
      hud: vehicleMode && p.project.look.hud && p.mission ? { mission: p.mission, tl: p.tl, t: p.t, date, showDate: p.project.look.dateStamp } : null,
    });
  };

  const request = () => {
    if (frameReq.current) return;
    frameReq.current = requestAnimationFrame(() => {
      frameReq.current = 0;
      draw();
    });
  };

  /** Puts the camera at a pleasant distance from `b` and turns the view around it. */
  const frameOn = (b: LookTarget) => {
    const s = space.current;
    if (!s) return;
    const p = latest.current;
    const target = focusAt(p, b);
    s.camera.position.copy(target.clone().add(new THREE.Vector3(...offsetFor(p, b))));
    controls.current!.target.copy(target);
    s.camera.lookAt(target);
    lastTarget.current = target.clone();
    request();
  };

  /** Over a keypoint move: the user takes the view, turning it around `b`. */
  const grab = (b: LookTarget) => {
    const p = latest.current;
    grabbed.current = true;
    grabFocus.current = b;
    p.onOverride?.(b);
  };

  useImperativeHandle(ref, () => ({
    currentView: () => {
      const s = space.current;
      const p = latest.current;
      if (!s) return { target: p.focus, offset: [0.05, 0.02, 0.05] };
      const target = posing(p) || p.camMode === "follow" ? nearest(p, controls.current!.target) : freeFocus(p);
      const o = s.camera.position.clone().sub(focusAt(p, target));
      return { target, offset: [o.x, o.y, o.z] };
    },
    frameBody: (b) => {
      const p = latest.current;
      if (p.camMode === "keypoints") grab(b);
      frameOn(b);
    },
  }));

  // create once
  useEffect(() => {
    const s = new SpaceScene(glRef.current!);
    space.current = s;
    const c = new OrbitControls(s.camera, glRef.current!);
    c.enableDamping = false;
    c.zoomSpeed = 1.2;
    c.rotateSpeed = 0.7;
    c.addEventListener("start", () => {
      // a drag or a scroll over the keypoint move: the user takes the view and turns it around
      // the body (or the craft) it looks at
      const p = latest.current;
      if (!posing(p)) return;
      const best = nearest(p, c.target);
      const tgt = focusAt(p, best);
      c.target.copy(tgt);
      lastTarget.current = tgt.clone();
      c.minDistance = Math.min(focusRadius(p, best) * 1.15, s.camera.position.distanceTo(tgt) * 0.999);
      c.maxDistance = Infinity;
      grab(best);
    });
    c.addEventListener("change", () => {
      // the user turned or zoomed the follow camera: keep that angle and distance
      const st = followState.current;
      if (!applying.current && st && latest.current.camMode === "follow") {
        const o = s.camera.position.clone().sub(c.target);
        const len = o.length();
        if (len > 0 && st.dist > 0) {
          const before = st.dir ?? followDir(ctxOf(latest.current), latest.current.t);
          const now: V3 = [o.x / len, o.y / len, o.z / len];
          // a zoom alone keeps the automatic angle; turning the view fixes the angle
          if (st.dir || Math.abs(now[0] - before[0]) + Math.abs(now[1] - before[1]) + Math.abs(now[2] - before[2]) > 1e-4) st.dir = now;
          st.zoom = Math.max(0.05, Math.min(60, len / st.dist));
          clearTimeout(saveTimer.current);
          saveTimer.current = window.setTimeout(() => latest.current.onFollowChange?.({ dir: st.dir, zoom: st.zoom }), 250);
        }
      }
      request();
    });
    controls.current = c;
    const p = latest.current;
    const target = focusAt(p, p.focus);
    s.camera.position.copy(target.clone().add(new THREE.Vector3(...offsetFor(p, p.focus))));
    c.target.copy(target);
    lastTarget.current = target.clone();
    texturesReady().then(request);
    // the HUD's typeface may still be on its way
    document.fonts?.load?.('600 20px "Barlow"').then(request).catch(() => {});
    document.fonts?.load?.('500 20px "Barlow"').then(request).catch(() => {});
    // textures stream in: redraw a few times while they arrive
    const iv = setInterval(request, 500);
    setTimeout(() => clearInterval(iv), 8000);
    return () => {
      clearInterval(iv);
      clearTimeout(saveTimer.current);
      c.dispose();
      s.dispose();
      space.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // size
  useEffect(() => {
    const s = space.current;
    if (!s || props.width < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    s.setSize(props.width, props.height, dpr);
    const ov = ovRef.current!;
    ov.width = Math.round(props.width * (window.devicePixelRatio || 1));
    ov.height = Math.round(props.height * (window.devicePixelRatio || 1));
    request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.width, props.height]);

  // the editor gives the keypoint move back (play, a jump to a keypoint, a new keypoint)
  useEffect(() => {
    if (!props.override && grabbed.current) {
      grabbed.current = false;
      grabFocus.current = null;
      request();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.override]);

  // the follow camera's angle comes from the project (e.g. "Reset angle and zoom", or a reset)
  const fol = props.project.camera.follow;
  useEffect(() => {
    const st = followState.current;
    if (!st) return;
    const want = fol.dir;
    const sameDir = want === null ? st.dir === null : !!st.dir && Math.abs(want[0] - st.dir[0]) + Math.abs(want[1] - st.dir[1]) + Math.abs(want[2] - st.dir[2]) < 1e-6;
    if (!sameDir || Math.abs((fol.zoom || 1) - st.zoom) > 1e-6) {
      st.dir = want;
      st.zoom = fol.zoom || 1;
      request();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fol.dir?.[0], fol.dir?.[1], fol.dir?.[2], fol.zoom]);

  // A new focus in the free view: look at it, unless the view already turns around it. Back
  // from the follow camera: look at the focus too, the follow view may be anywhere.
  const prevFocus = useRef(props.focus);
  const prevMode = useRef(props.camMode);
  useEffect(() => {
    const p = latest.current;
    const focusChanged = prevFocus.current !== p.focus;
    const leftFollow = prevMode.current === "follow" && p.camMode !== "follow";
    prevFocus.current = p.focus;
    prevMode.current = p.camMode;
    if (grabbed.current) {
      // over a keypoint move the view turns around what the user grabbed (or framed)
      if (focusChanged && grabFocus.current !== p.focus) {
        grabFocus.current = p.focus;
        frameOn(p.focus);
      }
    } else if (p.camMode === "free" && (focusChanged || leftFollow)) {
      const already = controls.current!.target.distanceTo(focusAt(p, p.focus)) < 1e-9;
      if (!already || leftFollow) frameOn(p.focus);
    }
    request();
  });

  const onClick = (e: React.MouseEvent) => {
    const p = latest.current;
    if (!p.showSpaceports || !p.onPickSpaceport || !space.current) return;
    const r = (e.target as HTMLElement).getBoundingClientRect();
    const ndc = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -(((e.clientY - r.top) / r.height) * 2 - 1) };
    const id = space.current.pickSpaceport(ndc, dateAt(p.tl, p.t), p.project.look.planetSize);
    if (id) p.onPickSpaceport(id);
  };
  // a click (not a drag) picks a spaceport
  const down = useRef<{ x: number; y: number } | null>(null);

  return (
    <div className="space-stage" style={{ width: props.width, height: props.height }}>
      <canvas
        ref={glRef}
        className="space-gl"
        style={{ width: props.width, height: props.height }}
        onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
        onClick={(e) => {
          const d = down.current;
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) onClick(e);
        }}
      />
      <canvas ref={ovRef} className="space-overlay" style={{ width: props.width, height: props.height }} aria-hidden />
    </div>
  );
});
