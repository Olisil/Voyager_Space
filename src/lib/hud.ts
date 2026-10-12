import { BODIES, type BodyId } from "./bodies";
import type { Mission } from "./mission";
import { norm, sub } from "./orbits";
import { partAt, simAt, videoAt, type Timeline } from "./timeline";

/**
 * Mission HUD along the bottom of the picture, in the spirit of launch webcasts: speed in
 * km/h with mph under it, altitude, a schematic timeline of the flight's events sliding
 * past a "now" mark with the mission clock, and the date and time.
 */

export const HUD_FONT = 'Barlow, "Raleway Variable", system-ui, sans-serif';
const GREEN = "#BAD70A";
const WHITE = "rgba(255,255,255,0.96)";
const GREY = "rgba(200,204,208,0.62)";
const DIM = "rgba(200,204,208,0.42)";

export interface HudInput {
  mission: Mission;
  tl: Timeline;
  /** video time, seconds */
  t: number;
  date: Date;
  showDate: boolean;
}

export interface Telemetry {
  /** km/s */
  speed: number;
  ref: BodyId;
  /** km above ref's surface, or km to the destination when ref is the Sun */
  alt: number;
  distTo: BodyId | null;
}

export function telemetry(m: Mission, sim: number): Telemetry | null {
  const tr = m.traj;
  if (!tr) return null;
  const s = tr.tele(sim);
  if (s.ref !== "sun") return { speed: s.speed, ref: s.ref, alt: s.alt, distTo: null };
  const to: BodyId = m.to === "moon" ? "earth" : m.to;
  const d = norm(sub(tr.at(sim).r, tr.ephem.at(to, sim).r)) - BODIES[to].radiusKm;
  return { speed: s.speed, ref: "sun", alt: d, distTo: m.to };
}

const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
export function missionClock(sim: number, countdown: number | null) {
  if (countdown !== null) return `T− 00:00:${pad(Math.ceil(countdown))}`;
  const s = Math.max(0, sim);
  const d = Math.floor(s / 86400);
  const hms = `${pad((s % 86400) / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;
  return d ? `T+ ${d}D ${hms}` : `T+ ${hms}`;
}

const fmtInt = (x: number) => Math.round(x).toLocaleString("en-US");
function fmtDist(km: number) {
  if (km >= 1e7) return `${(km / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}M`;
  if (km < 100) return km.toFixed(1);
  return fmtInt(km);
}
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Digits in fixed-width cells so ticking numbers don't wobble. */
function drawNumber(g: CanvasRenderingContext2D, text: string, x: number, y: number, align: "left" | "right" | "center") {
  const cell = g.measureText("0").width;
  const widths = [...text].map((ch) => (/[0-9]/.test(ch) ? cell : g.measureText(ch).width));
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = align === "left" ? x : align === "right" ? x - total : x - total / 2;
  const prev = g.textAlign;
  g.textAlign = "center";
  [...text].forEach((ch, i) => {
    g.fillText(ch, cx + widths[i] / 2, y);
    cx += widths[i];
  });
  g.textAlign = prev;
  return total;
}

function spaced(g: CanvasRenderingContext2D, px: number) {
  const gg = g as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in gg) gg.letterSpacing = `${px}px`;
}

interface Block {
  label: string;
  sub?: string;
  value: string;
  unit: string;
  value2: string;
  unit2: string;
}

function drawBlock(g: CanvasRenderingContext2D, b: Block, x: number, y: number, u: number, align: "left" | "right") {
  // label
  g.textBaseline = "alphabetic";
  g.font = `600 ${12 * u}px ${HUD_FONT}`;
  spaced(g, 1.6 * u);
  g.fillStyle = GREY;
  g.textAlign = align;
  g.fillText(b.label, x, y - 46 * u);
  if (b.sub) {
    const w = g.measureText(b.label + " ").width;
    g.font = `500 ${10.5 * u}px ${HUD_FONT}`;
    g.fillStyle = DIM;
    g.fillText(b.sub, align === "left" ? x + w + 4 * u : x - w - 4 * u, y - 46 * u);
  }
  spaced(g, 0);
  // main value: white
  g.font = `600 ${34 * u}px ${HUD_FONT}`;
  g.fillStyle = WHITE;
  const unitFont = `600 ${13 * u}px ${HUD_FONT}`;
  if (align === "left") {
    const w = drawNumber(g, b.value, x, y - 12 * u, "left");
    g.font = unitFont;
    spaced(g, 1.2 * u);
    g.textAlign = "left";
    g.fillText(b.unit, x + w + 6 * u, y - 12 * u);
  } else {
    g.font = unitFont;
    spaced(g, 1.2 * u);
    g.textAlign = "right";
    const uw = g.measureText(b.unit).width;
    g.fillText(b.unit, x, y - 12 * u);
    spaced(g, 0);
    g.font = `600 ${34 * u}px ${HUD_FONT}`;
    drawNumber(g, b.value, x - uw - 6 * u, y - 12 * u, "right");
  }
  spaced(g, 0);
  // secondary value: toned-down grey
  g.font = `500 ${16 * u}px ${HUD_FONT}`;
  g.fillStyle = GREY;
  if (align === "left") {
    const w = drawNumber(g, b.value2, x, y + 10 * u, "left");
    g.font = `600 ${11 * u}px ${HUD_FONT}`;
    spaced(g, 1.2 * u);
    g.textAlign = "left";
    g.fillText(b.unit2, x + w + 5 * u, y + 10 * u);
  } else {
    g.font = `600 ${11 * u}px ${HUD_FONT}`;
    spaced(g, 1.2 * u);
    g.textAlign = "right";
    const uw = g.measureText(b.unit2).width;
    g.fillText(b.unit2, x, y + 10 * u);
    spaced(g, 0);
    g.font = `500 ${16 * u}px ${HUD_FONT}`;
    drawNumber(g, b.value2, x - uw - 5 * u, y + 10 * u, "right");
  }
  spaced(g, 0);
}

const smooth = (x: number) => {
  const c = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return c * c * (3 - 2 * c);
};

/** Event times in video seconds, cached per timeline. */
const evCache = new WeakMap<Timeline, { label: string; sim: number; v: number }[]>();
function eventsOf(m: Mission, tl: Timeline) {
  let e = evCache.get(tl);
  if (!e) {
    e = m.events.map((x) => ({ label: x.label, sim: x.t, v: videoAt(tl, x.t) }));
    evCache.set(tl, e);
  }
  return e;
}

/** Where the track stands at video time v, in event steps (smoothed so close events don't snap). */
function trackIndex(ev: { v: number }[], v: number) {
  const raw = (x: number) => {
    const n = ev.length;
    if (!n) return 0;
    if (x <= ev[0].v) return (x - ev[0].v) / 1.5;
    if (x >= ev[n - 1].v) return n - 1 + (x - ev[n - 1].v) / 1.5;
    let k = 0;
    while (k < n - 2 && x > ev[k + 1].v) k++;
    return k + (x - ev[k].v) / Math.max(1e-6, ev[k + 1].v - ev[k].v);
  };
  let s = 0;
  let w = 0;
  for (let i = -6; i <= 6; i++) {
    const k = Math.exp(-(i * i) / 18);
    s += raw(v + i * 0.06) * k;
    w += k;
  }
  return s / w;
}

export function drawHud(g: CanvasRenderingContext2D, o: HudInput, width: number, height: number) {
  const m = o.mission;
  const tl = o.tl;
  const portrait = width / height < 1.2;
  const u = portrait ? Math.min(height / 1080, width / 640) : Math.min(height / 1080, width / 1500);
  const sim = simAt(tl, o.t);
  const tel = telemetry(m, sim);
  g.save();
  // legibility: a soft dark band at the bottom
  const band = (portrait ? 270 : 170) * u;
  const grad = g.createLinearGradient(0, height - band, 0, height);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.38)");
  grad.addColorStop(1, "rgba(0,0,0,0.62)");
  g.fillStyle = grad;
  g.fillRect(0, height - band, width, band);

  const margin = (portrait ? 26 : 48) * u;
  const baseY = height - (portrait ? 34 : 42) * u;

  // ---- speed and altitude
  if (tel) {
    const kmh = tel.speed * 3600;
    const refName = tel.ref === "sun" ? "SUN" : BODIES[tel.ref].name.toUpperCase();
    drawBlock(g, { label: "SPEED", sub: tel.speed > 0 ? `REL. ${refName}` : undefined, value: fmtInt(kmh), unit: "KM/H", value2: fmtInt(kmh * 0.621371), unit2: "MPH" }, margin, baseY, u, "left");
    const altLabel = tel.distTo ? `TO ${tel.distTo === "moon" ? "MOON" : BODIES[tel.distTo].name.toUpperCase()}` : "ALTITUDE";
    const altX = margin + (portrait ? 205 : 260) * u;
    drawBlock(g, { label: altLabel, value: fmtDist(Math.max(0, tel.alt)), unit: "KM", value2: fmtDist(Math.max(0, tel.alt) * 0.621371), unit2: "MI" }, altX, baseY, u, "left");
  }

  // ---- date and time
  if (o.showDate) {
    const d = o.date;
    const day = `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    drawBlock(g, { label: "DATE", value: day, unit: "", value2: time, unit2: "UTC" }, width - margin, baseY, u, "right");
  }

  // ---- mission timeline
  const ev = eventsOf(m, tl);
  const cx = width / 2;
  const trackW = portrait ? width - 2 * margin : Math.min(width * 0.44, 820 * u);
  const trackY = portrait ? height - 168 * u : height - 112 * u;
  const step = (portrait ? 150 : 172) * u;
  const idx = trackIndex(ev, o.t);
  const half = trackW / 2;
  const fade = (x: number) => 1 - smooth((Math.abs(x - cx) - half * 0.62) / (half * 0.38));
  // line: flown part brighter
  const lineGrad = g.createLinearGradient(cx - half, 0, cx + half, 0);
  lineGrad.addColorStop(0, "rgba(255,255,255,0)");
  lineGrad.addColorStop(0.2, "rgba(255,255,255,0.6)");
  lineGrad.addColorStop(0.5, "rgba(255,255,255,0.6)");
  lineGrad.addColorStop(0.5001, "rgba(255,255,255,0.22)");
  lineGrad.addColorStop(0.8, "rgba(255,255,255,0.22)");
  lineGrad.addColorStop(1, "rgba(255,255,255,0)");
  g.strokeStyle = lineGrad;
  g.lineWidth = Math.max(1, 1.5 * u);
  g.beginPath();
  g.moveTo(cx - half, trackY);
  g.lineTo(cx + half, trackY);
  g.stroke();
  // events
  let current = -1;
  ev.forEach((e, k) => {
    if (e.sim <= sim + 1e-6 && o.t >= tl.hold) current = k;
  });
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  ev.forEach((e, k) => {
    const x = cx + (k - idx) * step;
    const a = fade(x);
    if (a <= 0.01) return;
    const past = k <= current;
    g.globalAlpha = a;
    const r = 4.2 * u;
    g.beginPath();
    g.arc(x, trackY, r, 0, Math.PI * 2);
    if (past) {
      g.fillStyle = k === current ? WHITE : "rgba(255,255,255,0.75)";
      g.fill();
    } else {
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fill();
      g.strokeStyle = GREY;
      g.lineWidth = Math.max(1, 1.4 * u);
      g.stroke();
    }
    g.font = `600 ${11.5 * u}px ${HUD_FONT}`;
    spaced(g, 1.3 * u);
    g.fillStyle = k === current ? WHITE : past ? "rgba(255,255,255,0.7)" : GREY;
    g.fillText(e.label, x, trackY - 14 * u);
    spaced(g, 0);
  });
  g.globalAlpha = 1;
  // now mark
  g.fillStyle = GREEN;
  g.beginPath();
  g.moveTo(cx - 5 * u, trackY + 13 * u);
  g.lineTo(cx + 5 * u, trackY + 13 * u);
  g.lineTo(cx, trackY + 6.5 * u);
  g.closePath();
  g.fill();
  // clock and phase
  const countdown = o.t < tl.hold ? tl.hold - o.t : null;
  g.font = `600 ${25 * u}px ${HUD_FONT}`;
  g.fillStyle = WHITE;
  spaced(g, 0.5 * u);
  drawNumber(g, missionClock(sim, countdown), cx, trackY + 44 * u, "center");
  spaced(g, 1.8 * u);
  g.font = `600 ${12 * u}px ${HUD_FONT}`;
  g.fillStyle = GREEN;
  g.textAlign = "center";
  const phase = countdown !== null ? "READY FOR LAUNCH" : o.t > tl.hold + tl.body ? (m.landed ? "MISSION COMPLETE" : partAt(tl, o.t).name.toUpperCase()) : partAt(tl, o.t).name.toUpperCase();
  g.fillText(phase, cx, trackY + 66 * u);
  spaced(g, 0);
  g.restore();
}
