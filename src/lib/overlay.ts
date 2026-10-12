import { BODY_IDS, BODIES, displayPos, type BodyId } from "./bodies";
import { drawHud, type HudInput } from "./hud";
import type { SpaceScene } from "./scene";
import { SPACEPORTS } from "./types";

export interface OverlayInput {
  scene: SpaceScene;
  date: Date;
  boost: number;
  width: number;
  height: number;
  scale: number;
  labels: boolean;
  dateStamp: boolean;
  credit: string | null;
  spaceports: { show: boolean; selected: string | null; positions?: { id: string; x: number; y: number }[] };
  focus: BodyId | null;
  /** mission HUD along the bottom (vehicle mode); it then carries the date too */
  hud?: HudInput | null;
}

const FONT = '"Raleway Variable", Raleway, system-ui, sans-serif';

/** Body names, the date, the selected spaceport and the credit, drawn over the 3D view. */
export function drawOverlay(g: CanvasRenderingContext2D, o: OverlayInput) {
  const k = o.scale;
  g.save();
  g.scale(k, k);
  g.textBaseline = "middle";
  if (o.labels) {
    g.font = `500 12px ${FONT}`;
    const cam = o.scene.camera.position;
    for (const id of BODY_IDS) {
      const p = displayPos(id, o.date, o.boost);
      const s = o.scene.project(p);
      if (!s || s.x < -40 || s.y < -20 || s.x > o.width + 40 || s.y > o.height + 20) continue;
      const dist = Math.hypot(p[0] - cam.x, p[1] - cam.y, p[2] - cam.z);
      // moons only once you are close enough to tell them apart from their planet
      if (BODIES[id].parent && BODIES[id].parent !== "sun" && dist > 3) continue;
      const near = id === o.focus;
      g.fillStyle = near ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.7)";
      g.beginPath();
      g.arc(s.x, s.y, 2, 0, Math.PI * 2);
      g.fill();
      g.fillText(BODIES[id].name, s.x + 8, s.y - 8);
    }
  }
  if (o.spaceports.show && o.spaceports.positions) {
    g.font = `600 12px ${FONT}`;
    for (const p of o.spaceports.positions) {
      if (p.id !== o.spaceports.selected) continue;
      const name = SPACEPORTS.find((s) => s.id === p.id)?.name ?? "";
      g.fillStyle = "rgba(14,14,14,0.75)";
      const w = g.measureText(name).width + 16;
      g.fillRect(p.x + 10, p.y - 24, w, 22);
      g.fillStyle = "#BAD70A";
      g.fillText(name, p.x + 18, p.y - 13);
    }
  }
  if (o.hud) drawHud(g, o.hud, o.width, o.height);
  if (o.dateStamp && !o.hud) {
    const d = o.date;
    const txt = `${d.toISOString().slice(0, 10)}  ${d.toISOString().slice(11, 16)} UTC`;
    g.font = `600 ${Math.round(Math.max(14, o.height * 0.026))}px ${FONT}`;
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.textBaseline = "top";
    g.fillText(txt, o.width * 0.035, o.height * 0.045);
  }
  if (o.credit) {
    g.font = `400 ${Math.round(Math.max(10, o.height * 0.014))}px ${FONT}`;
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.textAlign = "right";
    // with the HUD at the bottom, the credit moves to the top corner
    g.textBaseline = o.hud ? "top" : "bottom";
    g.fillText(o.credit, o.width - o.width * 0.02, o.hud ? o.height * 0.02 : o.height - o.height * 0.02);
  }
  g.restore();
}

export const CREDIT = "Ephemeris: astronomy-engine · Textures: Solar System Scope (CC BY 4.0), NASA";
