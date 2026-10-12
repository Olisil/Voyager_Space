import { BODY_IDS, BODIES, displayPos, displayRadius, type BodyId } from "./bodies";
import { drawHud, type HudInput } from "./hud";
import type { SpaceScene } from "./scene";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlayInput {
  scene: SpaceScene;
  date: Date;
  boost: number;
  /** the canvas, CSS px */
  width: number;
  height: number;
  /** the video frame inside the canvas: the HUD, the date and the credit sit in it (default: all of it) */
  frame?: Rect;
  scale: number;
  labels: boolean;
  dateStamp: boolean;
  credit: string | null;
  /** spaceports on the globe (Start step): the visible ones, on screen */
  ports?: { id: string; name: string; x: number; y: number }[];
  /** the start-of-journey symbol at the launch site, on screen */
  start?: { x: number; y: number; name: string; alpha: number } | null;
  focus: BodyId | null;
  /** mission HUD along the bottom (vehicle mode); it then carries the date too */
  hud?: HudInput | null;
}

const FONT = '"Raleway Variable", Raleway, system-ui, sans-serif';
const GREEN = "#bad70a";
const INK = "#0e0e0e";

/** Text with a dark halo, legible over planets and stars alike. */
function haloText(g: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, halo = "rgba(14,14,14,0.8)") {
  g.lineJoin = "round";
  g.lineWidth = 3.5;
  g.strokeStyle = halo;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

/**
 * The start of the journey: a signal-green disc with a launch chevron, a faint ring around
 * it, and the site's name beside it. Returns the label's box.
 */
function drawStart(g: CanvasRenderingContext2D, s: NonNullable<OverlayInput["start"]>): Rect {
  g.save();
  g.globalAlpha = s.alpha;
  g.translate(s.x, s.y);
  g.beginPath();
  g.arc(0, 0, 14, 0, Math.PI * 2);
  g.strokeStyle = "rgba(186,215,10,0.55)";
  g.lineWidth = 1.5;
  g.stroke();
  g.beginPath();
  g.arc(0, 0, 8.5, 0, Math.PI * 2);
  g.fillStyle = GREEN;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = INK;
  g.stroke();
  // launch chevron
  g.beginPath();
  g.moveTo(-3.6, 2.6);
  g.lineTo(0, -2.8);
  g.lineTo(3.6, 2.6);
  g.lineWidth = 2;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = INK;
  g.stroke();
  g.font = `600 13px ${FONT}`;
  g.textBaseline = "middle";
  g.textAlign = "left";
  haloText(g, s.name, 20, 0.5, "#ffffff");
  const w = g.measureText(s.name).width;
  g.restore();
  return { x: s.x - 16, y: s.y - 16, w: w + 40, h: 32 };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Body names, the spaceports, the start symbol, the date and the credit, drawn over the 3D view. */
export function drawOverlay(g: CanvasRenderingContext2D, o: OverlayInput) {
  const k = o.scale;
  const fr = o.frame ?? { x: 0, y: 0, w: o.width, h: o.height };
  g.save();
  g.scale(k, k);
  g.textBaseline = "middle";
  if (o.labels) {
    g.font = `500 12px ${FONT}`;
    const cam = o.scene.camera.position;
    const fpx = fr.h / 2 / Math.tan((o.scene.camera.fov * Math.PI) / 360);
    for (const id of BODY_IDS) {
      const p = displayPos(id, o.date, o.boost);
      const s = o.scene.project(p);
      if (!s || s.x < -40 || s.y < -20 || s.x > o.width + 40 || s.y > o.height + 20) continue;
      const dist = Math.hypot(p[0] - cam.x, p[1] - cam.y, p[2] - cam.z);
      // moons only once you are close enough to tell them apart from their planet
      if (BODIES[id].parent && BODIES[id].parent !== "sun" && dist > 3) continue;
      // a body that fills much of the picture needs no name at its hidden centre
      if ((displayRadius(id, o.boost) / Math.max(dist, 1e-12)) * fpx > 0.28 * fr.h) continue;
      const near = id === o.focus;
      g.fillStyle = near ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.7)";
      g.beginPath();
      g.arc(s.x, s.y, 2, 0, Math.PI * 2);
      g.fill();
      g.fillText(BODIES[id].name, s.x + 8, s.y - 8);
    }
  }
  // the start symbol first, so the spaceport names keep clear of it
  const taken: Rect[] = [];
  if (o.start && o.start.alpha > 0.01) taken.push(drawStart(g, o.start));
  if (o.ports?.length) {
    g.font = `500 11px ${FONT}`;
    g.textBaseline = "middle";
    for (const p of o.ports) {
      const w = g.measureText(p.name).width;
      const h = 14;
      // right, left, above, below: the first spot that is free
      const spots: Rect[] = [
        { x: p.x + 7, y: p.y - h / 2, w, h },
        { x: p.x - 7 - w, y: p.y - h / 2, w, h },
        { x: p.x - w / 2, y: p.y - 7 - h, w, h },
        { x: p.x - w / 2, y: p.y + 7, w, h },
      ];
      g.beginPath();
      g.arc(p.x, p.y, 2.8, 0, Math.PI * 2);
      g.fillStyle = "#ffffff";
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = "rgba(14,14,14,0.85)";
      g.stroke();
      const spot = spots.find((r) => !taken.some((t) => overlaps(r, t)));
      if (!spot) continue;
      taken.push(spot);
      g.textAlign = "left";
      haloText(g, p.name, spot.x, spot.y + h / 2, "rgba(230,230,230,0.85)", "rgba(14,14,14,0.7)");
    }
  }
  g.restore();

  // what belongs to the video: in the frame
  g.save();
  g.scale(k, k);
  g.translate(fr.x, fr.y);
  g.beginPath();
  g.rect(0, 0, fr.w, fr.h);
  g.clip();
  g.textBaseline = "middle";
  if (o.hud) drawHud(g, o.hud, fr.w, fr.h);
  if (o.dateStamp && !o.hud) {
    const d = o.date;
    const txt = `${d.toISOString().slice(0, 10)}  ${d.toISOString().slice(11, 16)} UTC`;
    g.font = `600 ${Math.round(Math.max(14, fr.h * 0.026))}px ${FONT}`;
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.textBaseline = "top";
    g.textAlign = "left";
    g.fillText(txt, fr.w * 0.035, fr.h * 0.045);
  }
  if (o.credit) {
    g.font = `400 ${Math.round(Math.max(10, fr.h * 0.014))}px ${FONT}`;
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.textAlign = "right";
    // with the HUD at the bottom, the credit moves to the top corner
    g.textBaseline = o.hud ? "top" : "bottom";
    g.fillText(o.credit, fr.w - fr.w * 0.02, o.hud ? fr.h * 0.02 : fr.h - fr.h * 0.02);
  }
  g.restore();
}

export const CREDIT = "Ephemeris: astronomy-engine · Textures: Solar System Scope (CC BY 4.0), NASA";
