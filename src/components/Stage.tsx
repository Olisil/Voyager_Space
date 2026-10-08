import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { displayPos, displayRadius, type BodyId, type V3 } from "../lib/bodies";
import { cameraAt, defaultOffset, type CameraCtx } from "../lib/camera";
import type { Mission } from "../lib/mission";
import { drawOverlay } from "../lib/overlay";
import { SpaceScene, texturesReady } from "../lib/scene";
import { dateAt, simAt, type Timeline } from "../lib/timeline";
import { SPACEPORTS as SPACEPORT_LIST, type Project } from "../lib/types";

export interface StageHandle {
  /** the current view, for keypoints and as the follow camera's viewing angle */
  view: () => { offset: V3; focus: BodyId };
  /** look at a body from a pleasant angle */
  frameBody: (b: BodyId) => void;
  setView: (offset: V3, focus: BodyId) => void;
}

/**
 * The 3D view. While editing, the user orbits and zooms around the focused body (the view
 * keeps following it as time moves). While playing or scrubbing in the Camera and Preview
 * steps, the camera runs the project's move (follow the craft, or glide through keypoints).
 */
export const Stage = forwardRef<
  StageHandle,
  {
    project: Project;
    mission: Mission | null;
    tl: Timeline;
    t: number;
    /** run the project's camera move instead of the user's free view */
    animateCamera: boolean;
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

  const boost = props.project.look.planetSize;

  const draw = () => {
    const s = space.current;
    if (!s) return;
    const p = latest.current;
    const date = dateAt(p.tl, p.t);
    const sim = p.project.mode === "vehicle" && p.mission?.ok ? simAt(p.tl, p.t) : null;
    s.update({
      date,
      boost: p.project.look.planetSize,
      sim,
      mission: p.project.mode === "vehicle" ? p.mission : null,
      look: p.project.look,
      showSpaceports: p.showSpaceports,
      selectedSpaceport: p.project.start.body === "earth" ? p.project.start.site : null,
    });
    const c = controls.current!;
    if (p.animateCamera) {
      c.enabled = false;
      const ctx: CameraCtx = { project: p.project, mission: p.mission, tl: p.tl, view: viewNow() };
      const pose = cameraAt(ctx, p.t);
      s.camera.position.set(...pose.pos);
      c.target.set(...pose.target);
      s.camera.lookAt(c.target);
      lastTarget.current = null;
    } else {
      c.enabled = true;
      // keep following the focused body as time moves
      const tgt = new THREE.Vector3(...displayPos(p.focus, date, p.project.look.planetSize));
      if (lastTarget.current) s.camera.position.add(tgt.clone().sub(lastTarget.current));
      c.target.copy(tgt);
      lastTarget.current = tgt.clone();
      c.minDistance = displayRadius(p.focus, p.project.look.planetSize) * 1.15;
      c.update();
    }
    s.render();
    // labels and date
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
    c.addEventListener("change", request);
    controls.current = c;
    const p = latest.current;
    const date = dateAt(p.tl, p.t);
    const target = new THREE.Vector3(...displayPos(p.focus, date, p.project.look.planetSize));
    s.camera.position.copy(target.clone().add(new THREE.Vector3(...defaultOffset(p.focus, p.project.look.planetSize, date))));
    c.target.copy(target);
    lastTarget.current = target.clone();
    texturesReady().then(request);
    // textures stream in: redraw a few times while they arrive
    const iv = setInterval(request, 500);
    setTimeout(() => clearInterval(iv), 8000);
    return () => {
      clearInterval(iv);
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

  // focus change: look at the new body
  const prevFocus = useRef(props.focus);
  useEffect(() => {
    if (prevFocus.current !== props.focus && space.current) {
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
