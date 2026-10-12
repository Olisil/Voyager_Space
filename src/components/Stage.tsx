import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { displayPos, displayRadius, type BodyId, type V3 } from "../lib/bodies";
import { cameraAt, defaultOffset, followDir, followFrame, type CameraCtx } from "../lib/camera";
import type { Mission } from "../lib/mission";
import { drawOverlay } from "../lib/overlay";
import { SpaceScene, texturesReady } from "../lib/scene";
import { dateAt, frameWeights, simAt, type Timeline } from "../lib/timeline";
import { SPACEPORTS as SPACEPORT_LIST, type Project } from "../lib/types";

export interface StageHandle {
  /** the current view, for keypoints and as the follow camera's viewing angle */
  view: () => { offset: V3; focus: BodyId };
  /** look at a body from a pleasant angle */
  frameBody: (b: BodyId) => void;
  setView: (offset: V3, focus: BodyId) => void;
}

type Follow = Project["camera"]["follow"];

/**
 * The 3D view. While editing, the user orbits and zooms around the focused body (the view
 * keeps following it as time moves). With "Follow the craft" in the Camera and Preview
 * steps the view rides along with the craft at every moment, playing or not; dragging
 * and zooming then set the angle and distance the follow camera keeps. Keypoint moves run
 * while playing (and while scrubbing in Preview).
 */
export const Stage = forwardRef<
  StageHandle,
  {
    project: Project;
    mission: Mission | null;
    tl: Timeline;
    t: number;
    /** run the project's keypoint move instead of the user's free view */
    animateCamera: boolean;
    /** ride along with the craft */
    follow: boolean;
    onFollowChange?: (f: Follow) => void;
    focus: BodyId;
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

  const boost = props.project.look.planetSize;

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
    const frame = p.follow ? followFrame({ project: p.project, mission: p.mission, tl: p.tl }, p.t) : null;
    applying.current = true;
    if (frame) {
      if (!followState.current) {
        const f = p.project.camera.follow;
        followState.current = { dir: f.dir, zoom: f.zoom || 1, dist: frame.dist };
      }
      const st = followState.current;
      st.dist = frame.dist;
      const dir = st.dir ?? followDir({ project: p.project, mission: p.mission, tl: p.tl }, p.t);
      c.enabled = true;
      c.enablePan = false;
      c.minDistance = frame.dist * 0.08;
      c.maxDistance = frame.dist * 40;
      c.target.set(...frame.target);
      const d = frame.dist * st.zoom;
      s.camera.position.set(frame.target[0] + dir[0] * d, frame.target[1] + dir[1] * d, frame.target[2] + dir[2] * d);
      s.camera.lookAt(c.target);
      lastTarget.current = null;
    } else if (p.animateCamera) {
      c.enabled = false;
      const ctx: CameraCtx = { project: p.project, mission: p.mission, tl: p.tl, view: viewNow() };
      const pose = cameraAt(ctx, p.t);
      s.camera.position.set(...pose.pos);
      c.target.set(...pose.target);
      s.camera.lookAt(c.target);
      lastTarget.current = null;
    } else {
      c.enabled = true;
      c.enablePan = true;
      c.maxDistance = Infinity;
      // keep following the focused body as time moves
      const tgt = new THREE.Vector3(...displayPos(p.focus, date, p.project.look.planetSize));
      if (lastTarget.current) s.camera.position.add(tgt.clone().sub(lastTarget.current));
      c.target.copy(tgt);
      lastTarget.current = tgt.clone();
      c.minDistance = displayRadius(p.focus, p.project.look.planetSize) * 1.15;
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
      focus: p.focus,
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

  const viewNow = () => {
    const s = space.current!;
    const c = controls.current!;
    const o = s.camera.position.clone().sub(c.target);
    return { offset: [o.x, o.y, o.z] as V3, focus: latest.current.focus };
  };

  useImperativeHandle(ref, () => ({
    view: viewNow,
    frameBody: (b) => {
      const s = space.current;
      if (!s) return;
      const p = latest.current;
      const date = dateAt(p.tl, p.t);
      const target = new THREE.Vector3(...displayPos(b, date, p.project.look.planetSize));
      s.camera.position.copy(target.clone().add(new THREE.Vector3(...defaultOffset(b, p.project.look.planetSize, date))));
      controls.current!.target.copy(target);
      lastTarget.current = target.clone();
      request();
    },
    setView: (offset, focus) => {
      const s = space.current;
      if (!s) return;
      const p = latest.current;
      const target = new THREE.Vector3(...displayPos(focus, dateAt(p.tl, p.t), p.project.look.planetSize));
      s.camera.position.copy(target.clone().add(new THREE.Vector3(...offset)));
      controls.current!.target.copy(target);
      lastTarget.current = target.clone();
      request();
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
    c.addEventListener("change", () => {
      // the user turned or zoomed the follow camera: keep that angle and distance
      const st = followState.current;
      if (!applying.current && st && latest.current.follow) {
        const o = s.camera.position.clone().sub(c.target);
        const len = o.length();
        if (len > 0 && st.dist > 0) {
          const before = st.dir ?? followDir({ project: latest.current.project, mission: latest.current.mission, tl: latest.current.tl }, latest.current.t);
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
    const date = dateAt(p.tl, p.t);
    const target = new THREE.Vector3(...displayPos(p.focus, date, p.project.look.planetSize));
    s.camera.position.copy(target.clone().add(new THREE.Vector3(...defaultOffset(p.focus, p.project.look.planetSize, date))));
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

  // the follow camera's angle comes from the project (e.g. "Reset view", or another project)
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

  // focus change, or leaving the follow camera: look at the focused body
  const prevFocus = useRef(props.focus);
  const prevFollow = useRef(props.follow);
  useEffect(() => {
    const leftFollow = prevFollow.current && !props.follow;
    prevFollow.current = props.follow;
    if ((prevFocus.current !== props.focus || leftFollow) && space.current) {
      prevFocus.current = props.focus;
      const p = latest.current;
      const date = dateAt(p.tl, p.t);
      const target = new THREE.Vector3(...displayPos(props.focus, date, boost));
      space.current.camera.position.copy(target.clone().add(new THREE.Vector3(...defaultOffset(props.focus, boost, date))));
      controls.current!.target.copy(target);
      lastTarget.current = target.clone();
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
