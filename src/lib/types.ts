import type { BodyId } from "./bodies";
import { presetVehicle, type Vehicle } from "./vehicles";

export type Mode = "observer" | "vehicle";
export type Aspect = "16:9" | "9:16" | "1:1" | "4:5";
export type Resolution = 1080 | 1440 | 2160;
export type Fps = 24 | 25 | 30 | 60;
export type EarthOrbit = "leo" | "sso" | "gto" | "geo";
export type Destination = EarthOrbit | BodyId;
export type Scenario = "asap" | "fastest" | "cheapest" | "balanced";

export interface Site {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
}

/** Spaceports with public coordinates (approximate pad locations). */
export const SPACEPORTS: Site[] = [
  { id: "ksc", name: "Kennedy Space Center", country: "USA", lat: 28.573, lon: -80.649 },
  { id: "ccsfs", name: "Cape Canaveral", country: "USA", lat: 28.489, lon: -80.578 },
  { id: "starbase", name: "Starbase, Boca Chica", country: "USA", lat: 25.997, lon: -97.157 },
  { id: "vandenberg", name: "Vandenberg", country: "USA", lat: 34.632, lon: -120.611 },
  { id: "wallops", name: "Wallops", country: "USA", lat: 37.834, lon: -75.488 },
  { id: "kourou", name: "Guiana Space Centre, Kourou", country: "France (French Guiana)", lat: 5.239, lon: -52.768 },
  { id: "baikonur", name: "Baikonur", country: "Kazakhstan", lat: 45.965, lon: 63.305 },
  { id: "vostochny", name: "Vostochny", country: "Russia", lat: 51.884, lon: 128.334 },
  { id: "plesetsk", name: "Plesetsk", country: "Russia", lat: 62.925, lon: 40.577 },
  { id: "wenchang", name: "Wenchang", country: "China", lat: 19.614, lon: 110.951 },
  { id: "jiuquan", name: "Jiuquan", country: "China", lat: 40.958, lon: 100.291 },
  { id: "xichang", name: "Xichang", country: "China", lat: 28.246, lon: 102.027 },
  { id: "taiyuan", name: "Taiyuan", country: "China", lat: 38.849, lon: 111.608 },
  { id: "tanegashima", name: "Tanegashima", country: "Japan", lat: 30.4, lon: 130.97 },
  { id: "sriharikota", name: "Satish Dhawan, Sriharikota", country: "India", lat: 13.72, lon: 80.23 },
  { id: "mahia", name: "Rocket Lab LC-1, Mahia", country: "New Zealand", lat: -39.262, lon: 177.865 },
  { id: "andoya", name: "Andøya Spaceport", country: "Norway", lat: 69.294, lon: 16.02 },
  { id: "esrange", name: "Esrange, Kiruna", country: "Sweden", lat: 67.893, lon: 21.107 },
  { id: "saxavord", name: "SaxaVord, Shetland", country: "United Kingdom", lat: 60.818, lon: -0.773 },
  { id: "alcantara", name: "Alcântara", country: "Brazil", lat: -2.373, lon: -44.396 },
  { id: "palmachim", name: "Palmachim", country: "Israel", lat: 31.884, lon: 34.69 },
  { id: "naro", name: "Naro Space Center", country: "South Korea", lat: 34.432, lon: 127.535 },
];

/** Launch sites picked automatically elsewhere: near the equator, where spin helps most. */
export const AUTO_SITES: Partial<Record<BodyId, Site>> = {
  moon: { id: "auto-moon", name: "Sinus Medii (equator, near side)", country: "Moon", lat: 0, lon: 0 },
  mars: { id: "auto-mars", name: "Meridiani Planum (near the equator)", country: "Mars", lat: -2, lon: -5 },
};

export const START_BODIES: BodyId[] = ["earth", "moon", "mars"];

export const EARTH_ORBITS: { id: EarthOrbit; name: string; hint: string }[] = [
  { id: "leo", name: "Low Earth orbit", hint: "200 km up, where the space station flies" },
  { id: "sso", name: "Sun-synchronous orbit", hint: "600 km, over the poles; Earth-imaging satellites" },
  { id: "gto", name: "Geostationary transfer", hint: "An ellipse up to 35,786 km, where most comsats are dropped off" },
  { id: "geo", name: "Geostationary orbit", hint: "35,786 km over the equator, one turn a day" },
];

export interface Keypoint {
  id: string;
  /** seconds into the video */
  t: number;
  /** what the camera looks at */
  target: BodyId | "vehicle";
  /** camera position relative to the target, scene units (AU) */
  offset: [number, number, number];
}

export interface Project {
  id: string;
  version: 1;
  app: "voyager-space";
  name: string;
  createdAt: number;
  updatedAt: number;
  mode: Mode;
  start: { body: BodyId; site: string };
  vehicle: Vehicle;
  schedule: {
    /** ISO date-time (UTC) of the start of the window / of the observation */
    date: string;
    windowDays: number;
    destination: Destination;
    scenario: Scenario;
    /** observer: how many days the video covers */
    spanDays: number;
  };
  look: {
    pathColor: string;
    pathWidth: number;
    orbits: boolean;
    labels: boolean;
    dateStamp: boolean;
    planetSize: number;
  };
  camera: { mode: "follow" | "keypoints"; focus: BodyId; keypoints: Keypoint[] };
  timing: { duration: number };
  output: { aspect: Aspect; resolution: Resolution; fps: Fps; holdStart: number; holdEnd: number; credit: boolean };
}

export const ASPECTS: Record<Aspect, { ratio: number; label: string }> = {
  "16:9": { ratio: 16 / 9, label: "16:9 Landscape" },
  "9:16": { ratio: 9 / 16, label: "9:16 Story" },
  "1:1": { ratio: 1, label: "1:1 Square" },
  "4:5": { ratio: 4 / 5, label: "4:5 Portrait" },
};
export function outputSize(aspect: Aspect, res: Resolution) {
  const r = ASPECTS[aspect].ratio;
  const even = (n: number) => Math.round(n / 2) * 2;
  return r >= 1 ? { width: even(res * r), height: res } : { width: res, height: even(res / r) };
}

export const uid = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function newProject(name = "Untitled mission"): Project {
  const now = Date.now();
  return {
    id: uid(),
    version: 1,
    app: "voyager-space",
    name,
    createdAt: now,
    updatedAt: now,
    mode: "vehicle",
    start: { body: "earth", site: "starbase" },
    vehicle: presetVehicle("saturn-v"),
    schedule: { date: "2026-09-01T12:00:00Z", windowDays: 800, destination: "moon", scenario: "balanced", spanDays: 365 },
    look: { pathColor: "#FFFFFF", pathWidth: 3, orbits: true, labels: true, dateStamp: true, planetSize: 1 },
    camera: { mode: "follow", focus: "earth", keypoints: [] },
    timing: { duration: 14 },
    output: { aspect: "16:9", resolution: 1080, fps: 30, holdStart: 1, holdEnd: 1.5, credit: true },
  };
}

export function demoProject(): Project {
  const p = newProject("Boca Chica to the Moon");
  return p;
}

export function coerceProject(raw: unknown): Project {
  const bad = new Error("This file isn't a Voyager Space project.");
  if (!raw || typeof raw !== "object") throw bad;
  let r = raw as Record<string, unknown>;
  if (r.format === "voyager-space" && r.project) r = r.project as Record<string, unknown>;
  if (r.app !== "voyager-space") throw bad;
  const base = newProject();
  const p = r as unknown as Project;
  return {
    ...base,
    ...p,
    start: { ...base.start, ...p.start },
    vehicle: { ...base.vehicle, ...p.vehicle },
    schedule: { ...base.schedule, ...p.schedule },
    look: { ...base.look, ...p.look },
    camera: { ...base.camera, ...p.camera },
    timing: { ...base.timing, ...p.timing },
    output: { ...base.output, ...p.output },
  };
}

export function siteOf(p: Project): Site {
  if (p.start.body === "earth") return SPACEPORTS.find((s) => s.id === p.start.site) ?? SPACEPORTS[0];
  return AUTO_SITES[p.start.body] ?? { id: "auto", name: "Equator", country: "", lat: 0, lon: 0 };
}
