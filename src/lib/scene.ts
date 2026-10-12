import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import {
  BODIES,
  BODY_IDS,
  bodyBasis,
  compressVec,
  displayPos,
  displayRadius,
  moonOffsetKm,
  periodDays,
  PLANETS,
  surfaceDir,
  toScene,
  trueHelio,
  type BodyId,
  type V3,
} from "./bodies";
import { flightPath, type FlightPath } from "./display";
import type { Mission } from "./mission";
import { SPACEPORTS } from "./types";

/**
 * The 3D view. Lighting is physical in spirit: the Sun is the only light, planets have a
 * day side and a night side with a soft terminator, Earth shows city lights on its night side,
 * clouds and a thin blue atmosphere; Saturn has its rings. The flight path is a bright line.
 */

// Bundled by Vite, so the URLs carry the right base path wherever the app is mounted.
const TEXTURE_URLS = import.meta.glob("../assets/textures/*", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const TEX = (f: string) => TEXTURE_URLS[`../assets/textures/${f}`];
const texCache = new Map<string, THREE.Texture>();
const loader = new THREE.TextureLoader();
const pending = new Set<Promise<unknown>>();
function tex(file: string, srgb = true): THREE.Texture {
  let t = texCache.get(file);
  if (!t) {
    const p = new Promise<void>((resolve) => {
      t = loader.load(
        TEX(file),
        () => resolve(),
        undefined,
        () => resolve(),
      );
    });
    pending.add(p);
    p.then(() => pending.delete(p));
    t!.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t!.anisotropy = 4;
    texCache.set(file, t!);
  }
  return t!;
}
/** Resolves when every texture requested so far has loaded (or failed). */
export const texturesReady = () => Promise.all([...pending]);

// Sharper maps for close-ups, loaded when the camera comes near a body and let go when it leaves.
const HI_URLS = import.meta.glob("../assets/textures/hi/*", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const HI = (f: string) => HI_URLS[`../assets/textures/hi/${f}`];
/** the sharp map (and its width), the width of the everyday map it stands in for, and Earth's clouds */
const DETAIL: Partial<Record<BodyId, { file: string; size: number; low: number; clouds?: string }>> = {
  earth: { file: "earth_day.webp", size: 8192, low: 4096, clouds: "earth_clouds.webp" },
  moon: { file: "moon.jpg", size: 8192, low: 2048 },
  mars: { file: "mars.webp", size: 8192, low: 2048 },
  mercury: { file: "mercury.jpg", size: 6144, low: 2048 },
  jupiter: { file: "jupiter.webp", size: 4096, low: 2048 },
  saturn: { file: "saturn.webp", size: 4096, low: 2048 },
  sun: { file: "sun.webp", size: 4096, low: 2048 },
};
type Pixels = HTMLImageElement | ImageBitmap;
const blobs = new Map<string, Promise<Blob | null>>();
/**
 * Decoded off the main thread where the browser can (no hitch when an 8K map arrives); the
 * downloaded file is kept, the decoded pixels only as long as a view uses them.
 */
async function loadPixels(url: string): Promise<Pixels | null> {
  if (typeof createImageBitmap !== "undefined") {
    try {
      let b = blobs.get(url);
      if (!b) {
        b = fetch(url)
          .then((r) => (r.ok ? r.blob() : null))
          .catch(() => null);
        blobs.set(url, b);
      }
      const blob = await b;
      if (blob) return await createImageBitmap(blob);
    } catch {
      /* fall back to an image element */
    }
  }
  return new Promise<Pixels | null>((resolve) => new THREE.ImageLoader().load(url, resolve, undefined, () => resolve(null)));
}
const isBitmap = (px: unknown) => typeof ImageBitmap !== "undefined" && px instanceof ImageBitmap;
/** Bitmaps can't be flipped on upload: the shaders flip them instead (uniform flipV). */
function detailTexture(px: Pixels, red = false): THREE.Texture {
  const t = new THREE.Texture(px as HTMLImageElement);
  t.flipY = !isBitmap(px);
  if (red) {
    t.format = THREE.RedFormat;
    t.colorSpace = THREE.NoColorSpace;
  } else t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
function freeTexture(t: THREE.Texture | undefined) {
  if (!t) return;
  const img = t.image as unknown;
  t.dispose();
  if (isBitmap(img)) (img as ImageBitmap).close();
}

const vert = /* glsl */ `
  varying vec3 vN; varying vec3 vW; varying vec2 vUv;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main(){
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
  }`;

const planetFrag = /* glsl */ `
  uniform sampler2D map; uniform sampler2D night; uniform float hasNight; uniform float ambient;
  uniform vec3 sunPos; uniform float flipV;
  varying vec3 vN; varying vec3 vW; varying vec2 vUv;
  #include <logdepthbuf_pars_fragment>
  void main(){
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vN);
    vec3 l = normalize(sunPos - vW);
    vec3 v = normalize(cameraPosition - vW);
    float d = dot(n, l);
    float lit = clamp((d + 0.04) / 1.04, 0.0, 1.0);
    lit = lit * smoothstep(-0.04, 0.12, d);
    vec3 day = texture2D(map, vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, flipV))).rgb;
    vec3 col = day * (ambient + lit * 1.08);
    if (hasNight > 0.5) {
      float dark = 1.0 - smoothstep(-0.18, 0.06, d);
      vec3 lights = texture2D(night, vUv).rgb;
      col += lights * lights * dark * 2.2;
      // sun glint on water (blue, smooth areas)
      float water = smoothstep(0.02, 0.12, day.b - day.r);
      float spec = pow(max(dot(reflect(-l, n), v), 0.0), 60.0) * water * lit;
      col += vec3(1.0, 0.95, 0.85) * spec * 0.6;
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const cloudFrag = /* glsl */ `
  uniform sampler2D map; uniform vec3 sunPos; uniform float flipV;
  varying vec3 vN; varying vec3 vW; varying vec2 vUv;
  #include <logdepthbuf_pars_fragment>
  void main(){
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vN);
    float d = dot(n, normalize(sunPos - vW));
    float lit = clamp((d + 0.05) / 1.05, 0.0, 1.0) * smoothstep(-0.05, 0.15, d);
    float a = texture2D(map, vec2(vUv.x, mix(vUv.y, 1.0 - vUv.y, flipV))).r;
    gl_FragColor = vec4(vec3(1.0) * (0.015 + lit), a * 0.92);
    #include <colorspace_fragment>
  }`;

const atmoFrag = /* glsl */ `
  uniform vec3 sunPos; uniform vec3 tint; uniform float strength;
  varying vec3 vN; varying vec3 vW; varying vec2 vUv;
  #include <logdepthbuf_pars_fragment>
  void main(){
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vN);
    vec3 v = normalize(cameraPosition - vW);
    float rim = pow(1.0 - abs(dot(n, v)), 2.6);
    float d = dot(n, normalize(sunPos - vW));
    float lit = smoothstep(-0.18, 0.35, d);
    float sunset = (1.0 - smoothstep(-0.02, 0.22, d)) * 0.45;
    vec3 col = mix(tint, vec3(1.0, 0.5, 0.25), sunset);
    gl_FragColor = vec4(col * rim * lit * strength, 1.0);
    #include <colorspace_fragment>
  }`;

const ringFrag = /* glsl */ `
  uniform sampler2D map; uniform vec3 sunPos; uniform vec3 planetPos; uniform float planetR;
  varying vec3 vN; varying vec3 vW; varying vec2 vUv;
  #include <logdepthbuf_pars_fragment>
  void main(){
    #include <logdepthbuf_fragment>
    vec4 c = texture2D(map, vec2(vUv.x, 0.5));
    vec3 l = normalize(sunPos - vW);
    // planet shadow on the rings
    vec3 toP = planetPos - vW;
    float along = dot(toP, l);
    float dist = length(toP - l * along);
    float shadow = along > 0.0 ? smoothstep(planetR * 0.92, planetR * 1.02, dist) : 1.0;
    float lit = 0.35 + 0.65 * abs(dot(normalize(vN), l));
    gl_FragColor = vec4(c.rgb * lit * shadow, c.a);
    #include <colorspace_fragment>
  }`;

function glowTexture(inner: string, outer: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.18, inner);
  grad.addColorStop(0.45, outer);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Matrix that puts a SphereGeometry (Y = pole, +X = longitude 0) into a body's orientation. */
function orientMatrix(x: V3, y: V3, z: V3): THREE.Matrix4 {
  return new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...z), new THREE.Vector3(...y).negate());
}

interface BodyNode {
  id: BodyId;
  group: THREE.Group; // positioned
  spin: THREE.Group; // oriented (body-fixed)
  mats: THREE.ShaderMaterial[];
  ring?: THREE.ShaderMaterial;
  /** the material showing the surface map (a ShaderMaterial with a `map` uniform, or the Sun's basic material) */
  surface: THREE.ShaderMaterial | THREE.MeshBasicMaterial;
  clouds?: THREE.ShaderMaterial;
}

interface Detail {
  ready: boolean;
  promise: Promise<void>;
  tex?: THREE.Texture;
  clouds?: THREE.Texture;
  /** since when the sharp map hasn't been needed (ms) */
  idle?: number;
}

interface PathLine {
  fp: FlightPath;
  holder: THREE.Group;
  full: Line2;
  done: Line2;
  pts: Float32Array;
  segFull: Float32Array;
  segDone: Float32Array;
}

export interface SceneState {
  date: Date;
  boost: number;
  /** seconds after launch, for the vehicle */
  sim: number | null;
  mission: Mission | null;
  look: { pathColor: string; pathWidth: number; orbits: boolean };
  /** whose frame the path is drawn in (see FlightPath.positions) */
  frames?: Partial<Record<BodyId, number>>;
  showSpaceports: boolean;
  selectedSpaceport: string | null;
}

export class SpaceScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  nodes = new Map<BodyId, BodyNode>();
  private orbits = new Map<BodyId, THREE.Line>();
  private orbitsKey = "";
  private path: PathLine | null = null;
  private vehicle: THREE.Sprite;
  private vehicleAt = new THREE.Vector3();
  private stars: THREE.Mesh;
  private size = { w: 1, h: 1 };
  /** the video frame inside the canvas (the camera's own view); the rest is passe-partout */
  private frame = { x: 0, y: 0, w: 1, h: 1 };
  private lineMats: LineMaterial[] = [];
  private detail = new Map<BodyId, Detail>();
  private disposed = false;
  /** called when a sharp map has arrived, so the view can be drawn again */
  onDetail: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, opts: { preserve?: boolean } = {}) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas as HTMLCanvasElement,
      antialias: true,
      logarithmicDepthBuffer: true,
      preserveDrawingBuffer: !!opts.preserve,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 1e-6, 5000);
    this.scene.background = new THREE.Color("#000000");

    // stars: the Milky Way panorama, aligned with the celestial equator
    const starMat = new THREE.MeshBasicMaterial({ map: tex("stars.jpg"), side: THREE.BackSide, depthWrite: false, color: new THREE.Color(0.55, 0.55, 0.6) });
    starMat.toneMapped = false;
    this.stars = new THREE.Mesh(new THREE.SphereGeometry(2000, 64, 32), starMat);
    this.stars.matrixAutoUpdate = false;
    this.stars.matrix.copy(orientMatrix(toScene({ x: 1, y: 0, z: 0 }), toScene({ x: 0, y: 1, z: 0 }), toScene({ x: 0, y: 0, z: 1 })));
    this.stars.renderOrder = -10;
    this.scene.add(this.stars);

    for (const id of BODY_IDS) this.nodes.set(id, this.makeBody(id));

    const vmat = new THREE.SpriteMaterial({ map: glowTexture("rgba(255,255,255,1)", "rgba(255,255,255,0.25)"), depthTest: true, depthWrite: false, sizeAttenuation: false, transparent: true });
    vmat.toneMapped = false;
    this.vehicle = new THREE.Sprite(vmat);
    this.vehicle.renderOrder = 20;
    this.vehicle.visible = false;
    this.scene.add(this.vehicle);
  }

  private makeBody(id: BodyId): BodyNode {
    const info = BODIES[id];
    const group = new THREE.Group();
    const spin = new THREE.Group();
    spin.matrixAutoUpdate = false;
    group.add(spin);
    this.scene.add(group);
    const geo = new THREE.SphereGeometry(1, id === "earth" || id === "sun" ? 128 : 72, id === "earth" || id === "sun" ? 64 : 36);
    const mats: THREE.ShaderMaterial[] = [];
    if (id === "sun") {
      const m = new THREE.MeshBasicMaterial({ map: tex("sun.jpg"), color: new THREE.Color(1.5, 1.35, 1.1) });
      m.toneMapped = false;
      spin.add(new THREE.Mesh(geo, m));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture("rgba(255,244,214,0.9)", "rgba(255,170,60,0.18)"), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      glow.material.toneMapped = false;
      glow.scale.setScalar(7);
      glow.name = "glow";
      group.add(glow);
      return { id, group, spin, mats, surface: m };
    }
    const tint = (() => {
      // the Galilean moons reuse the lunar map, tinted
      const t: Partial<Record<BodyId, [number, number, number]>> = { io: [1.25, 1.1, 0.55], europa: [1.15, 1.05, 0.9], ganymede: [1, 0.95, 0.88], callisto: [0.75, 0.7, 0.65] };
      return t[id];
    })();
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: tint ? planetFrag.replace("vec3 col = day * (ambient", `day *= vec3(${tint.map((x) => x.toFixed(2)).join(",")});\n    vec3 col = day * (ambient`) : planetFrag,
      uniforms: {
        map: { value: tex(info.texture) },
        night: { value: id === "earth" ? tex("earth_night.jpg") : null },
        hasNight: { value: id === "earth" ? 1 : 0 },
        // a faint night side where there are no city lights to see the ground by, so a launch
        // site or a landing in the dark still shows its terrain
        ambient: { value: id === "earth" ? 0.012 : 0.045 },
        sunPos: { value: new THREE.Vector3() },
        flipV: { value: 0 },
      },
    });
    mats.push(mat);
    spin.add(new THREE.Mesh(geo, mat));
    let cm: THREE.ShaderMaterial | undefined;
    if (id === "earth") {
      cm = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: cloudFrag, uniforms: { map: { value: tex("earth_clouds.jpg", false) }, sunPos: { value: new THREE.Vector3() }, flipV: { value: 0 } }, transparent: true, depthWrite: false });
      mats.push(cm);
      const clouds = new THREE.Mesh(geo, cm);
      clouds.scale.setScalar(1.006);
      clouds.name = "clouds";
      spin.add(clouds);
    }
    const atmo: Partial<Record<BodyId, [string, number, number]>> = { earth: ["#6fb2ff", 1.6, 1.035], venus: ["#ffe2a8", 1.1, 1.03], mars: ["#f0a57a", 0.6, 1.02], jupiter: ["#e8d2b0", 0.5, 1.015], saturn: ["#f2dfb4", 0.5, 1.015], uranus: ["#a6f0ff", 0.8, 1.02], neptune: ["#7d9cff", 0.9, 1.02] };
    const a = atmo[id];
    if (a) {
      const am = new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: atmoFrag,
        uniforms: { sunPos: { value: new THREE.Vector3() }, tint: { value: new THREE.Color(a[0]) }, strength: { value: a[1] } },
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      });
      mats.push(am);
      const shell = new THREE.Mesh(geo, am);
      shell.scale.setScalar(a[2]);
      spin.add(shell);
    }
    let ring: THREE.ShaderMaterial | undefined;
    if (id === "saturn") {
      const inner = 74500 / info.radiusKm;
      const outer = 140220 / info.radiusKm;
      const rg = new THREE.RingGeometry(inner, outer, 160, 1);
      const pos = rg.attributes.position;
      const uv = rg.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i));
        uv.setXY(i, (r - inner) / (outer - inner), 0.5);
      }
      ring = new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: ringFrag,
        uniforms: { map: { value: tex("saturn_ring.png") }, sunPos: { value: new THREE.Vector3() }, planetPos: { value: new THREE.Vector3() }, planetR: { value: 1 } },
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const rm = new THREE.Mesh(rg, ring);
      rm.rotation.x = -Math.PI / 2;
      spin.add(rm);
    }
    return { id, group, spin, mats, ring, surface: mat, clouds: cm };
  }

  /**
   * Canvas size (CSS px). `frame` is the video frame inside it: the camera is set up for the
   * frame, and the canvas shows more of the same view around it (the passe-partout).
   */
  setSize(w: number, h: number, pixelRatio = 1, frame?: { x: number; y: number; w: number; h: number }) {
    this.size = { w, h };
    this.frame = frame ?? { x: 0, y: 0, w, h };
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(w, h, false);
    const f = this.frame;
    this.camera.aspect = f.w / f.h;
    if (f.x !== 0 || f.y !== 0 || f.w !== w || f.h !== h) this.camera.setViewOffset(f.w, f.h, -f.x, -f.y, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    for (const m of this.lineMats) m.resolution.set(w * pixelRatio, h * pixelRatio);
  }

  /** Move everything to a moment in time. */
  update(s: SceneState) {
    const { date, boost } = s;
    for (const [id, node] of this.nodes) {
      const p = displayPos(id, date, boost);
      node.group.position.set(...p);
      const r = displayRadius(id, boost);
      node.spin.scale.setScalar(r);
      if (id !== "sun") {
        const b = bodyBasis(id, date);
        node.spin.matrix.copy(orientMatrix(b.x, b.y, b.z)).scale(new THREE.Vector3(r, r, r));
        for (const m of node.mats) m.uniforms.sunPos.value.set(0, 0, 0);
        if (node.ring) {
          node.ring.uniforms.planetPos.value.set(...p);
          node.ring.uniforms.planetR.value = r;
        }
      } else {
        node.spin.matrix.makeScale(r, r, r);
        const glow = node.group.getObjectByName("glow");
        if (glow) glow.scale.setScalar(r * 9);
      }
    }
    this.updateOrbits(s);
    this.updatePath(s);
    this.updatePorts(s);
  }

  private updateOrbits(s: SceneState) {
    const key = `${s.boost}|${s.date.toISOString().slice(0, 7)}`;
    if (key !== this.orbitsKey) {
      this.orbitsKey = key;
      for (const l of this.orbits.values()) {
        l.removeFromParent();
        l.geometry.dispose();
      }
      this.orbits.clear();
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
      for (const id of PLANETS) {
        const pts: THREE.Vector3[] = [];
        const P = periodDays(id);
        for (let i = 0; i <= 256; i++) pts.push(new THREE.Vector3(...trueHelio(id, new Date(s.date.getTime() + (i / 256) * P * 86400000))));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
        this.scene.add(line);
        this.orbits.set(id, line);
      }
      for (const id of ["moon", "io", "europa", "ganymede", "callisto"] as BodyId[]) {
        const parent = BODIES[id].parent!;
        const pts: THREE.Vector3[] = [];
        const P = periodDays(id);
        for (let i = 0; i <= 128; i++) pts.push(new THREE.Vector3(...compressVec(parent, moonOffsetKm(id, new Date(s.date.getTime() + (i / 128) * P * 86400000)), s.boost)));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
        this.nodes.get(parent)!.group.add(line);
        this.orbits.set(id, line);
      }
    }
    for (const l of this.orbits.values()) l.visible = s.look.orbits;
  }

  private updatePath(s: SceneState) {
    const fp = s.sim !== null ? flightPath(s.mission, s.boost) : null;
    if ((this.path?.fp ?? null) !== fp) {
      if (this.path) {
        this.path.holder.removeFromParent();
        this.path.full.geometry.dispose();
        this.path.done.geometry.dispose();
        (this.path.full.material as LineMaterial).dispose();
        (this.path.done.material as LineMaterial).dispose();
      }
      this.path = null;
      this.lineMats = [];
      if (fp && fp.n > 1) {
        const color = new THREE.Color(s.look.pathColor);
        const mk = (opacity: number, width: number) => {
          const mat = new LineMaterial({ color: color.getHex(), linewidth: width, transparent: opacity < 1, opacity, depthTest: true, worldUnits: false });
          mat.toneMapped = false;
          mat.resolution.set(this.size.w * this.renderer.getPixelRatio(), this.size.h * this.renderer.getPixelRatio());
          this.lineMats.push(mat);
          return mat;
        };
        // one segment more than the path has: the path is split at the craft (see below)
        const segFull = new Float32Array(fp.n * 6);
        const segDone = new Float32Array(fp.n * 6);
        const gFull = new LineGeometry();
        LineSegmentsGeometry.prototype.setPositions.call(gFull, segFull);
        const gDone = new LineGeometry();
        LineSegmentsGeometry.prototype.setPositions.call(gDone, segDone);
        const full = new Line2(gFull, mk(0.42, Math.max(1, s.look.pathWidth * 0.7)));
        const done = new Line2(gDone, mk(1, s.look.pathWidth));
        full.renderOrder = 5;
        done.renderOrder = 6;
        full.frustumCulled = false;
        done.frustumCulled = false;
        const holder = new THREE.Group();
        holder.add(full, done);
        this.scene.add(holder);
        this.path = { fp, holder, full, done, pts: new Float32Array(fp.n * 3), segFull, segDone };
      }
    }
    for (const m2 of this.lineMats) {
      m2.color.set(s.look.pathColor);
    }
    const P = this.path;
    if (!P || s.sim === null) {
      this.vehicle.visible = false;
      return;
    }
    (P.full.material as LineMaterial).linewidth = Math.max(1, s.look.pathWidth * 0.7);
    (P.done.material as LineMaterial).linewidth = s.look.pathWidth;
    const now = s.sim;
    const { pts, segFull, segDone } = P;
    const path = P.fp;
    const o = path.origin(now);
    const v = path.vehicle(now, s.frames);
    // vertices relative to the craft (the camera is usually near it), so single precision is enough up close
    const base: V3 = [v[0] - o[0], v[1] - o[1], v[2] - o[2]];
    path.positions(now, pts, s.frames, base);
    P.holder.position.set(o[0] + base[0], o[1] + base[1], o[2] + base[2]);
    const n = path.n;
    for (let i = 0; i < n - 1; i++) {
      segFull.set(pts.subarray(i * 3, i * 3 + 6), i * 6);
    }
    const k = path.doneCount(now);
    const rel: V3 = [0, 0, 0];
    // the whole path runs through the craft too (between two vertices it is on the true curve,
    // a little off their chord): the segment it is on becomes two, the spare slot at the end
    if (k >= 1 && k <= n - 1) {
      segFull.set(rel, (k - 1) * 6 + 3);
      segFull.set(rel, (n - 1) * 6);
      segFull.set(pts.subarray(k * 3, k * 3 + 3), (n - 1) * 6 + 3);
    } else {
      segFull.set(pts.subarray(0, 3), (n - 1) * 6);
      segFull.set(pts.subarray(0, 3), (n - 1) * 6 + 3);
    }
    for (let i = 0; i < k - 1; i++) segDone.set(pts.subarray(i * 3, i * 3 + 6), i * 6);
    if (k >= 1) {
      segDone.set(pts.subarray((k - 1) * 3, k * 3), (k - 1) * 6);
      segDone.set(rel, (k - 1) * 6 + 3);
    }
    const bump = (g: LineGeometry) => {
      const a = g.attributes.instanceStart as unknown as { data: THREE.InterleavedBuffer };
      a.data.needsUpdate = true;
    };
    bump(P.full.geometry as LineGeometry);
    bump(P.done.geometry as LineGeometry);
    (P.done.geometry as LineGeometry).instanceCount = Math.max(0, k);
    P.done.visible = k >= 1;
    this.vehicle.visible = true;
    this.vehicleAt.set(v[0], v[1], v[2]);
    this.vehicle.position.copy(this.vehicleAt);
    // sized against the frame, so it looks the same in the editor and in the video
    this.vehicle.scale.setScalar((0.028 * this.size.h) / this.frame.h);
  }

  private updatePorts(_s: SceneState) {
    // spaceports are drawn over the view (drawOverlay), crisp and never under the clouds
  }

  /** Screen position of a point on a body's surface, or null when it is round the back (or off the canvas edge). */
  surfaceToScreen(center: V3, point: V3): { x: number; y: number } | null {
    const cam = this.camera.position;
    const nx = point[0] - center[0];
    const ny = point[1] - center[1];
    const nz = point[2] - center[2];
    if ((cam.x - point[0]) * nx + (cam.y - point[1]) * ny + (cam.z - point[2]) * nz <= 0) return null;
    return this.project(point);
  }

  // ---- sharp maps for close-ups

  /**
   * Swaps in the sharp map of a body while the camera is close enough for the everyday map
   * to look soft (it would be magnified on screen), and lets it go a while after.
   * `keep`: never let go (a render loads what it needs and keeps it to the end).
   */
  updateDetail(keep = false) {
    if (this.disposed) return;
    const max = this.renderer.capabilities.maxTextureSize;
    const cam = this.camera;
    const fpx = this.frame.h / 2 / Math.tan((cam.fov * Math.PI) / 360);
    cam.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const now = performance.now();
    for (const id of Object.keys(DETAIL) as BodyId[]) {
      const d = DETAIL[id]!;
      if (d.size > max) continue;
      const node = this.nodes.get(id)!;
      const c = node.group.position;
      const r = node.spin.scale.x;
      const dist = cam.position.distanceTo(c);
      const near = Math.max(dist - r, r * 0.002);
      const seen = frustum.intersectsSphere(new THREE.Sphere(c, r));
      // screen pixels per radian of the surface at its nearest point, against texels per radian of the map
      const need = seen ? ((r / near) * fpx * 2 * Math.PI) / d.low : 0;
      const st = this.detail.get(id);
      if (need > 0.9) {
        if (!st) this.loadDetail(id);
        else st.idle = undefined;
      } else if (st && !keep && need < 0.45) {
        st.idle ??= now;
        if (now - st.idle > 4000) this.dropDetail(id);
      }
    }
  }
  /** Resolves when the sharp maps asked for so far are in. */
  detailReady(): Promise<unknown> {
    return Promise.all([...this.detail.values()].map((d) => d.promise));
  }
  get detailLoading() {
    return [...this.detail.values()].some((d) => !d.ready);
  }
  private loadDetail(id: BodyId) {
    const d = DETAIL[id]!;
    const node = this.nodes.get(id)!;
    const st: Detail = { ready: false, promise: Promise.resolve() };
    st.promise = Promise.all([loadPixels(HI(d.file)), d.clouds ? loadPixels(HI(d.clouds)) : Promise.resolve(null)]).then(([px, cpx]) => {
      if (this.disposed || this.detail.get(id) !== st || !px) return;
      const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      st.tex = detailTexture(px);
      st.tex.anisotropy = aniso;
      const m = node.surface;
      if (m instanceof THREE.ShaderMaterial) {
        m.uniforms.map.value = st.tex;
        m.uniforms.flipV.value = st.tex.flipY ? 0 : 1;
      } else {
        if (!st.tex.flipY) {
          st.tex.repeat.set(1, -1);
          st.tex.offset.set(0, 1);
        }
        m.map = st.tex;
      }
      if (cpx && node.clouds) {
        st.clouds = detailTexture(cpx, true);
        st.clouds.anisotropy = aniso;
        node.clouds.uniforms.map.value = st.clouds;
        node.clouds.uniforms.flipV.value = st.clouds.flipY ? 0 : 1;
      }
      st.ready = true;
      this.onDetail?.();
    });
    this.detail.set(id, st);
  }
  private dropDetail(id: BodyId) {
    const st = this.detail.get(id);
    if (!st) return;
    this.detail.delete(id);
    const node = this.nodes.get(id)!;
    const low = tex(BODIES[id].texture);
    const m = node.surface;
    if (m instanceof THREE.ShaderMaterial) {
      m.uniforms.map.value = low;
      m.uniforms.flipV.value = 0;
    } else m.map = low;
    if (node.clouds) {
      node.clouds.uniforms.map.value = tex("earth_clouds.jpg", false);
      node.clouds.uniforms.flipV.value = 0;
    }
    freeTexture(st.tex);
    freeTexture(st.clouds);
  }

  /** Nearest spaceport to a click on the Earth, or null. */
  pickSpaceport(ndc: { x: number; y: number }, date: Date, boost: number): string | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    const c = new THREE.Vector3(...displayPos("earth", date, boost));
    const r = displayRadius("earth", boost);
    const sphere = new THREE.Sphere(c, r);
    const hit = ray.ray.intersectSphere(sphere, new THREE.Vector3());
    if (!hit) return null;
    const dir = hit.sub(c).normalize();
    const b = bodyBasis("earth", date);
    let best: string | null = null;
    let bestDot = -2;
    for (const p of SPACEPORTS) {
      const d = surfaceDir(b, p.lat, p.lon);
      const dd = dir.x * d[0] + dir.y * d[1] + dir.z * d[2];
      if (dd > bestDot) {
        bestDot = dd;
        best = p.id;
      }
    }
    return bestDot > Math.cos((25 * Math.PI) / 180) ? best : null;
  }

  render() {
    // the craft is hidden behind planets, but never sinks into the ground it stands on
    if (this.vehicle.visible) this.vehicle.position.lerpVectors(this.vehicleAt, this.camera.position, 0.02);
    this.stars.position.copy(this.camera.position);
    this.stars.updateMatrixWorld(true);
    this.stars.matrix.setPosition(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  /** Screen position (CSS px) of a world point, or null when behind the camera. */
  project(p: V3): { x: number; y: number } | null {
    const v = new THREE.Vector3(...p).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: ((v.x + 1) / 2) * this.size.w, y: ((1 - v.y) / 2) * this.size.h };
  }

  dispose() {
    this.disposed = true;
    for (const st of this.detail.values()) {
      freeTexture(st.tex);
      freeTexture(st.clouds);
    }
    this.detail.clear();
    this.renderer.dispose();
  }
}
