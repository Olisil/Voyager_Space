import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import logoUrl from "../assets/voyager-space-logo.svg";
import { BODIES, BODY_IDS, type BodyId } from "../lib/bodies";
import { downloadBlob, downloadProjectFile, duplicateProject, getProject, saveProject, slug } from "../lib/db";
import { exportVideo, ExportUnsupportedError, type ExportProgress } from "../lib/exporter";
import { buildMission, isLocal, MOON_TOF, pickScenario, searchTransfers, totalDv, type Mission, type Transfer } from "../lib/mission";
import { dateAt, makeTimeline } from "../lib/timeline";
import {
  ASPECTS,
  AUTO_SITES,
  EARTH_ORBITS,
  outputSize,
  SPACEPORTS,
  START_BODIES,
  uid,
  type Aspect,
  type Destination,
  type Project,
  type Scenario,
} from "../lib/types";
import { capability, PRESETS, presetVehicle, type Stage as VStage } from "../lib/vehicles";
import { navigate } from "../router";
import { ThemeToggle } from "../theme";
import { ColorPicker, Field, Section, Segmented, Slider, Toggle } from "./Controls";
import { Stage, type StageHandle } from "./Stage";

type Step = "start" | "vehicle" | "schedule" | "camera" | "export";
const STEP_LABEL: Record<Step, string> = { start: "Start", vehicle: "Vehicle", schedule: "Schedule & Destination", camera: "Camera", export: "Preview & export" };
const NEXT_LABEL: Record<Step, string> = { start: "Next: choose vehicle", vehicle: "Next: schedule & destination", schedule: "Next: camera", camera: "Next: preview & export", export: "" };

const fmtDate = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
const fmtDur = (s: number) => {
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 2 * 86400) return `${(s / 3600).toFixed(1)} h`;
  if (s < 365 * 86400) return `${Math.round(s / 86400)} days`;
  return `${(s / 86400 / 365.25).toFixed(1)} years`;
};
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

export function Editor({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    getProject(projectId).then((p) => (p ? setProject(p) : setMissing(true)));
  }, [projectId]);
  if (missing)
    return (
      <div className="home-main">
        <p>That project isn't in this browser.</p>
        <a className="btn" href="#/">
          Back to projects
        </a>
      </div>
    );
  if (!project) return null;
  return <EditorLoaded initial={project} />;
}

function EditorLoaded({ initial }: { initial: Project }) {
  const [project, setProject] = useState(initial);
  const update = useCallback((fn: (p: Project) => Project) => setProject((p) => ({ ...fn(p), updatedAt: Date.now() })), []);
  const [step, setStep] = useState<Step>("start");
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [scrubbed, setScrubbed] = useState(false);
  const [menu, setMenu] = useState(false);
  const stage = useRef<StageHandle>(null);

  // autosave
  useEffect(() => {
    const id = setTimeout(() => saveProject(project), 400);
    return () => clearTimeout(id);
  }, [project]);
  useEffect(() => {
    document.documentElement.classList.add("editor-open");
    return () => document.documentElement.classList.remove("editor-open");
  }, []);

  const steps: Step[] = project.mode === "vehicle" ? ["start", "vehicle", "schedule", "camera", "export"] : ["start", "schedule", "camera", "export"];

  // ---- the mission
  const from = project.start.body;
  const dest = project.schedule.destination;
  const helioDest = project.mode === "vehicle" && dest in BODIES && dest !== from && !isLocal(from, dest as BodyId);
  const transfers = useMemo<Transfer[] | null>(
    () => (helioDest ? searchTransfers(from, dest as BodyId, new Date(project.schedule.date), project.schedule.windowDays) : null),
    [helioDest, from, dest, project.schedule.date, project.schedule.windowDays],
  );
  const mission = useMemo<Mission | null>(() => (project.mode === "vehicle" ? buildMission(project, transfers) : null), [project.mode, project.start, project.schedule, project.vehicle, project.timing, transfers]);
  const tl = useMemo(() => makeTimeline(project, mission), [project, mission]);
  const tClamped = Math.min(t, tl.total);

  // ---- playback
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setT((x) => {
        const n = x + dt;
        if (n >= tl.total) {
          setPlaying(false);
          return tl.total;
        }
        return n;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, tl.total]);
  const togglePlay = () => {
    if (!playing && t >= tl.total - 0.01) setT(0);
    setPlaying(!playing);
    setScrubbed(true);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const goStep = (s: Step) => {
    setPlaying(false);
    setScrubbed(false);
    setStep(s);
  };

  // ---- stage size
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 800, h: 450 });
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ratio = ASPECTS[project.output.aspect].ratio;
  const pad = 24;
  const fw = Math.max(50, Math.min(area.w - pad * 2, (area.h - pad * 2) * ratio));
  const fh = fw / ratio;

  // ---- what the view looks at
  const focus: BodyId = project.mode === "vehicle" && (step === "start" || step === "vehicle") ? from : project.camera.focus;
  // Camera step: scrub to a moment and frame the view by hand; play to preview the move.
  // Preview & export: playing and scrubbing both show the move.
  const animateCamera = (step === "camera" && playing) || (step === "export" && (playing || scrubbed));
  const showPorts = project.mode === "vehicle" && step === "start" && from === "earth";

  // ---- export
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob; w: number; h: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const render = async () => {
    setPlaying(false);
    setExportError(null);
    setResult(null);
    abort.current = new AbortController();
    setProgress({ frame: 0, frames: 1, elapsedMs: 0, paused: false });
    try {
      const view = stage.current?.view() ?? { offset: [0.05, 0.02, 0.05] as [number, number, number], focus };
      const r = await exportVideo({ project, mission, tl, view }, setProgress, abort.current.signal);
      setResult({ url: URL.createObjectURL(r.blob), blob: r.blob, w: r.width, h: r.height });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setExportError(e instanceof ExportUnsupportedError ? e.message : `The render stopped: ${e instanceof Error ? e.message : e}`);
    } finally {
      setProgress(null);
    }
  };

  const i = steps.indexOf(step);
  const next = steps[i + 1];

  return (
    <div className="editor">
      <header className="topbar app-header">
        <div className="app-header-start">
          <a className="app-logo" href="#/" aria-label="Voyager Space, all projects">
            <img src={logoUrl} alt="Voyager Space" width={218} height={25} />
          </a>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <a className="crumb-link" href="#/">
              Projects
            </a>
            <span className="crumb-sep" aria-hidden>
              /
            </span>
            <input className="project-name" aria-label="Project name" value={project.name} onChange={(e) => update((p) => ({ ...p, name: e.target.value }))} />
          </nav>
        </div>
        <div className="topbar-end">
          <div className="menu-wrap">
            <button type="button" className={`icon-button${menu ? " is-active" : ""}`} aria-label="Project: download or duplicate" title="Project" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <svg viewBox="0 0 18 16" width="24" height="22" aria-hidden>
                <path
                  fill="currentColor"
                  d="M12.5 7.98V6.5c0-.28-.23-.5-.5-.5H9.05C7.46 6 6.11 7.05 5.66 8.49 5.56 8.19 5.5 7.87 5.5 7.5 5.5 5.570 7.07 4 9 4h3c.28 0 .5-.22.5-.5V2.02L15.81 5 12.5 7.98ZM10.5 7.5H11V9c0 .55.45 1 1 1h.12c.25 0 .48-.09.67-.26l4.34-3.91c.24-.21.37-.51.37-.83s-.13-.62-.37-.83L12.81.28A1.08 1.08 0 0 0 11 1.08V2.5H9C6.24 2.5 4 4.74 4 7.5c0 1.89 1.08 3.1 2 3.78.18.14.36.25.52.35.14.08.27.15.37.21.1.05.19.09.26.12.07.03.14.04.22.04h.08c.31 0 .56-.25.56-.56 0-.24-.17-.46-.36-.61l-.04-.03a1.4 1.4 0 0 1-.31-.3 1.97 1.97 0 0 1-.43-1.26c0-1.13.92-2.05 2.05-2.05h1.45L10.5 7.5ZM2.25 1A2.25 2.25 0 0 0 0 3.25v10.5C0 14.99 1.01 16 2.25 16h10.5c1.24 0 2.25-1.01 2.25-2.25v-2a.75.75 0 0 0-1.5 0v2c0 .42-.33.75-.75.75H2.25a.75.75 0 0 1-.75-.75V3.25c0-.42.33-.75.75-.75h2a.75.75 0 0 0 0-1.5h-2Z"
                />
              </svg>
            </button>
            {menu && (
              <div className="menu menu-right" role="menu" onMouseLeave={() => setMenu(false)}>
                <button type="button" role="menuitem" onClick={() => (setMenu(false), downloadProjectFile(project))}>
                  Download project file
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    setMenu(false);
                    const copy = await duplicateProject(project);
                    navigate(`/p/${copy.id}`);
                  }}
                >
                  Duplicate project
                </button>
              </div>
            )}
          </div>
          <ThemeToggle />
        </div>
      </header>

      <nav className="steps" aria-label="Steps">
        {steps.map((s, n) => (
          <button key={s} type="button" className={`step${s === step ? " on" : ""}`} aria-current={s === step ? "step" : undefined} onClick={() => goStep(s)}>
            <span className="step-num">{n + 1}</span>
            {project.mode === "observer" && s === "schedule" ? "Schedule" : STEP_LABEL[s]}
          </button>
        ))}
        <select className="aspect-select" aria-label="Video shape" value={project.output.aspect} onChange={(e) => update((p) => ({ ...p, output: { ...p.output, aspect: e.target.value as Aspect } }))}>
          {(Object.keys(ASPECTS) as Aspect[]).map((a) => (
            <option key={a} value={a}>
              {ASPECTS[a].label}
            </option>
          ))}
        </select>
      </nav>

      <aside className="panel">
        <div className="panel-body">
          {step === "start" && <StartPanel project={project} update={update} onFocus={(b) => stage.current?.frameBody(b)} />}
          {step === "vehicle" && <VehiclePanel project={project} update={update} />}
          {step === "schedule" && <SchedulePanel project={project} update={update} mission={mission} transfers={transfers} />}
          {step === "camera" && (
            <CameraPanel
              project={project}
              update={update}
              t={tClamped}
              mission={mission}
              onAdd={() => {
                const v = stage.current?.view();
                if (!v) return;
                update((p) => ({ ...p, camera: { ...p.camera, mode: "keypoints", keypoints: [...p.camera.keypoints, { id: uid(), t: Math.round(tClamped * 10) / 10, target: v.focus, offset: v.offset }] } }));
              }}
              onJump={(k) => {
                setPlaying(false);
                setScrubbed(false);
                setT(k.t);
                if (k.target !== "vehicle") {
                  update((p) => ({ ...p, camera: { ...p.camera, focus: k.target as BodyId } }));
                  requestAnimationFrame(() => stage.current?.setView(k.offset, k.target as BodyId));
                }
              }}
            />
          )}
          {step === "export" && (
            <ExportPanel
              project={project}
              update={update}
              total={tl.total}
              progress={progress}
              result={result}
              error={exportError}
              onRender={render}
              onCancel={() => abort.current?.abort()}
            />
          )}
        </div>
        {next && (
          <div className="panel-foot">
            <button type="button" className="btn btn-primary" onClick={() => goStep(next)}>
              {project.mode === "observer" && step === "start" ? "Next: schedule" : project.mode === "observer" && step === "schedule" ? "Next: camera" : NEXT_LABEL[step]}
            </button>
          </div>
        )}
      </aside>

      <main className="stage">
        <div className="stage-area" ref={areaRef}>
          <div className="frame" style={{ width: fw, height: fh }}>
            <Stage
              ref={stage}
              project={project}
              mission={mission}
              tl={tl}
              t={tClamped}
              animateCamera={animateCamera}
              focus={focus}
              showSpaceports={showPorts}
              onPickSpaceport={(id) => update((p) => ({ ...p, start: { ...p.start, site: id } }))}
              width={fw}
              height={fh}
            />
            {showPorts && <div className="stage-hint">Drag to turn the globe. Click a spaceport to launch from it.</div>}
            {mission && !mission.ok && step !== "start" && step !== "vehicle" && <div className="stage-hint stage-warn">{mission.message}</div>}
          </div>
        </div>
        <div className="timeline">
          <button type="button" className="play" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
            {playing ? (
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
              </svg>
            )}
          </button>
          <span className="time">
            {fmtClock(tClamped)} <span className="time-total">/ {fmtClock(tl.total)}</span>
          </span>
          <div className="scrub-wrap">
            <input
              className="scrub"
              type="range"
              min={0}
              max={tl.total}
              step={0.01}
              value={tClamped}
              aria-label="Time"
              onChange={(e) => {
                setPlaying(false);
                setScrubbed(true);
                setT(parseFloat(e.target.value));
              }}
            />
            <div className="scrub-marks" aria-hidden>
              {tl.marks.map((m, n) => (
                <span key={n} className="mark mark-sign" style={{ left: `${(m / tl.total) * 100}%` }} />
              ))}
            </div>
          </div>
          <span className="sim-date">{fmtDate(dateAt(tl, tClamped))}</span>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- panels

type Up = (fn: (p: Project) => Project) => void;

function StartPanel({ project, update, onFocus }: { project: Project; update: Up; onFocus: (b: BodyId) => void }) {
  const m = project.mode;
  return (
    <>
      <header className="panel-intro">
        <h2>Godspeed!</h2>
        <p>Choose type of visualization</p>
      </header>
      <div className="source-cards">
        <button type="button" className={`source-card${m === "observer" ? " on" : ""}`} aria-pressed={m === "observer"} onClick={() => update((p) => ({ ...p, mode: "observer", camera: { ...p.camera, mode: "keypoints" } }))}>
          <span className="source-title">Space observer</span>
          <span className="source-hint">Define a path through the solar system, through keypoints.</span>
        </button>
        <button type="button" className={`source-card${m === "vehicle" ? " on" : ""}`} aria-pressed={m === "vehicle"} onClick={() => update((p) => ({ ...p, mode: "vehicle", camera: { ...p.camera, mode: p.camera.keypoints.length ? p.camera.mode : "follow" } }))}>
          <span className="source-title">Vehicle path</span>
          <span className="source-hint">Launch a spaceship and follow the path to a destination.</span>
        </button>
      </div>
      {m === "observer" ? (
        <Section title="Look at" hint="Where the view starts. Drag to turn around it, scroll to zoom.">
          <div className="chips">
            {BODY_IDS.map((b) => (
              <button
                key={b}
                type="button"
                className={`chip${project.camera.focus === b ? " on" : ""}`}
                onClick={() => {
                  update((p) => ({ ...p, camera: { ...p.camera, focus: b } }));
                  onFocus(b);
                }}
              >
                <span className="dot" style={{ background: BODIES[b].color }} aria-hidden />
                {BODIES[b].name}
              </button>
            ))}
          </div>
        </Section>
      ) : (
        <Section title="Starting point">
          <div className="chips">
            {START_BODIES.map((b) => (
              <button
                key={b}
                type="button"
                className={`chip${project.start.body === b ? " on" : ""}`}
                onClick={() =>
                  update((p) => ({
                    ...p,
                    start: { body: b, site: b === "earth" ? (SPACEPORTS.some((s) => s.id === p.start.site) ? p.start.site : "ksc") : `auto-${b}` },
                    schedule: { ...p.schedule, destination: p.schedule.destination === b ? (b === "earth" ? "moon" : "earth") : b !== "earth" && ["leo", "sso", "gto", "geo"].includes(p.schedule.destination) ? "earth" : p.schedule.destination },
                    camera: { ...p.camera, focus: b },
                  }))
                }
              >
                <span className="dot" style={{ background: BODIES[b].color }} aria-hidden />
                {BODIES[b].name}
              </button>
            ))}
          </div>
          {project.start.body === "earth" ? (
            <>
              <Field label="Spaceport">
                <select className="input" value={project.start.site} onChange={(e) => update((p) => ({ ...p, start: { ...p.start, site: e.target.value } }))}>
                  {SPACEPORTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.country}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="hint">Or turn the globe and click a spaceport. Sites near the equator get the most help from Earth's spin.</p>
            </>
          ) : (
            <div className="info-box">
              <strong>{AUTO_SITES[project.start.body]?.name}</strong>
              <span>Picked automatically: near the equator, where the {BODIES[project.start.body].name}'s spin gives the most help into orbit.</span>
            </div>
          )}
        </Section>
      )}
    </>
  );
}

function VehiclePanel({ project, update }: { project: Project; update: Up }) {
  const v = project.vehicle;
  const g = (BODIES[project.start.body].mu / BODIES[project.start.body].radiusKm ** 2) * 1000;
  const cap = capability(v, g);
  const setStage = (i: number, patch: Partial<VStage>) => update((p) => ({ ...p, vehicle: { ...p.vehicle, preset: "custom", stages: p.vehicle.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) } }));
  const num = (val: number, onChange: (n: number) => void, label: string, step = 1) => (
    <input className="input input-num" type="number" aria-label={label} value={val} step={step} min={0} onChange={(e) => onChange(Math.max(0, parseFloat(e.target.value) || 0))} />
  );
  return (
    <>
      <header className="panel-intro">
        <h2>Your vehicle</h2>
        <p>Start from a real rocket, then change any number. The rocket equation tells how much speed change (Δv) it can give your payload.</p>
      </header>
      <Section title="Start from">
        <div className="presets">
          {PRESETS.map((pr) => (
            <button key={pr.id} type="button" className={`preset${v.preset === pr.id ? " on" : ""}`} onClick={() => update((p) => ({ ...p, vehicle: presetVehicle(pr.id) }))}>
              <strong>{pr.name}</strong>
              <span>{pr.hint}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Stages" hint="Mass and propellant in tonnes, engine efficiency (Isp) in seconds, thrust in kilonewtons.">
        <div className="stages">
          <div className="stage-row stage-head" aria-hidden>
            <span>Stage</span>
            <span>Mass t</span>
            <span>Prop. t</span>
            <span>Isp s</span>
            <span>Thrust kN</span>
            <span />
          </div>
          {v.stages.map((s, i) => (
            <div key={i} className="stage-row">
              <input className="input" aria-label={`Stage ${i + 1} name`} value={s.name} onChange={(e) => setStage(i, { name: e.target.value })} />
              {num(s.massT, (n) => setStage(i, { massT: n }), `Stage ${i + 1} mass`, 0.1)}
              {num(s.propT, (n) => setStage(i, { propT: Math.min(n, s.massT) }), `Stage ${i + 1} propellant`, 0.1)}
              {num(s.isp, (n) => setStage(i, { isp: n }), `Stage ${i + 1} Isp`)}
              {num(s.thrustKN, (n) => setStage(i, { thrustKN: n }), `Stage ${i + 1} thrust`)}
              <button type="button" className="icon-btn" aria-label={`Remove stage ${i + 1}`} onClick={() => update((p) => ({ ...p, vehicle: { ...p.vehicle, preset: "custom", stages: p.vehicle.stages.filter((_, j) => j !== i) } }))}>
                ×
              </button>
              <span className="stage-dv">{cap.perStage[i]?.toFixed(2)} km/s</span>
            </div>
          ))}
          <button type="button" className="btn btn-small" onClick={() => update((p) => ({ ...p, vehicle: { ...p.vehicle, preset: "custom", stages: [...p.vehicle.stages, { name: `Stage ${p.vehicle.stages.length + 1}`, massT: 20, propT: 17, isp: 340, thrustKN: 300 }] } }))}>
            Add stage
          </button>
        </div>
        <Field label="Payload, tonnes">{num(v.payloadT, (n) => update((p) => ({ ...p, vehicle: { ...p.vehicle, preset: "custom", payloadT: n } })), "Payload", 0.1)}</Field>
        <Toggle label="Refuel in orbit" hint="The last stage is filled up again in low orbit by tanker flights." checked={v.refuel} onChange={(x) => update((p) => ({ ...p, vehicle: { ...p.vehicle, refuel: x } }))} />
      </Section>
      <dl className="stats">
        <div>
          <dt>Δv available</dt>
          <dd>{cap.dv.toFixed(2)} km/s</dd>
        </div>
        <div>
          <dt>Thrust to weight</dt>
          <dd className={cap.twr < 1.05 ? "bad" : ""}>{cap.twr.toFixed(2)}</dd>
        </div>
      </dl>
      {cap.twr < 1.05 && <p className="error">Too heavy to lift off from {BODIES[project.start.body].name}: thrust must exceed weight.</p>}
    </>
  );
}

function SchedulePanel({ project, update, mission, transfers }: { project: Project; update: Up; mission: Mission | null; transfers: Transfer[] | null }) {
  const s = project.schedule;
  const set = (patch: Partial<Project["schedule"]>) => update((p) => ({ ...p, schedule: { ...p.schedule, ...patch } }));
  const local = s.date.slice(0, 16);
  const dateField = (
    <Field label={project.mode === "vehicle" ? "Earliest launch (UTC)" : "Start date (UTC)"}>
      <input className="input" type="datetime-local" value={local} min="1900-01-01T00:00" max="2199-12-31T23:59" onChange={(e) => e.target.value && set({ date: `${e.target.value}:00Z` })} />
    </Field>
  );
  if (project.mode === "observer")
    return (
      <>
        <header className="panel-intro">
          <h2>When</h2>
          <p>The planets are where they really were or will be on these dates.</p>
        </header>
        {dateField}
        <Slider label="Time covered" value={s.spanDays} min={1} max={3650} step={1} format={(v) => (v < 365 ? `${v} days` : `${(v / 365.25).toFixed(1)} years`)} onChange={(v) => set({ spanDays: v })} />
        <Slider label="Video length" value={project.timing.duration} min={4} max={120} step={1} format={(v) => `${v} s`} onChange={(v) => update((p) => ({ ...p, timing: { duration: v } }))} />
      </>
    );
  const from = project.start.body;
  const g = (BODIES[from].mu / BODIES[from].radiusKm ** 2) * 1000;
  const cap = capability(project.vehicle, g);
  const need = mission?.ok ? totalDv(mission) : 0;
  const dests: { group: string; items: { id: Destination; name: string; hint?: string }[] }[] = [];
  if (from === "earth") dests.push({ group: "Earth orbits", items: EARTH_ORBITS.map((o) => ({ id: o.id, name: o.name, hint: o.hint })) });
  dests.push({
    group: "Moon and planets",
    items: (["earth", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"] as BodyId[]).filter((b) => b !== from).map((b) => ({ id: b, name: BODIES[b].name })),
  });
  const isOrbit = ["leo", "sso", "gto", "geo"].includes(s.destination);
  const scenarios: { id: Scenario; name: string }[] = [
    { id: "asap", name: "As soon as possible" },
    { id: "fastest", name: "Fastest" },
    { id: "cheapest", name: "Least fuel" },
    { id: "balanced", name: "Balanced" },
  ];
  const local2 = isLocal(from, s.destination as BodyId);
  return (
    <>
      <header className="panel-intro">
        <h2>Schedule & destination</h2>
        <p>Pick where to go and when you'd like to leave. Transfer windows come from the real planet positions.</p>
      </header>
      <Field label="Destination">
        <select className="input" value={s.destination} onChange={(e) => set({ destination: e.target.value as Destination })}>
          {dests.map((d) => (
            <optgroup key={d.group} label={d.group}>
              {d.items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      {isOrbit && <p className="hint">{EARTH_ORBITS.find((o) => o.id === s.destination)?.hint}</p>}
      {dateField}
      {!isOrbit && !local2 && <Slider label="Window to search" value={s.windowDays} min={30} max={2000} step={10} format={(v) => (v < 365 ? `${v} days` : `${(v / 365.25).toFixed(1)} years`)} onChange={(v) => set({ windowDays: v })} />}
      {!isOrbit && (
        <Section title="Scenario">
          <div className="scenarios">
            {scenarios.map((sc) => {
              const tr = transfers ? pickScenario(transfers, sc.id) : null;
              const detail = local2 ? `${MOON_TOF[sc.id]} days` : tr ? `Leave ${tr.depart.toISOString().slice(0, 10)}, ${fmtDur(tr.tofDays * 86400)}, ${(tr.dvDep + tr.dvArr).toFixed(1)} km/s` : "No transfer in window";
              return (
                <button key={sc.id} type="button" className={`scenario${s.scenario === sc.id ? " on" : ""}`} onClick={() => set({ scenario: sc.id })}>
                  <strong>{sc.name}</strong>
                  <span>{detail}</span>
                </button>
              );
            })}
          </div>
        </Section>
      )}
      {mission?.ok && (
        <Section title="Flight plan">
          <dl className="plan">
            <div>
              <dt>Launch</dt>
              <dd>{fmtDate(mission.launch)}</dd>
            </div>
            <div>
              <dt>Arrival</dt>
              <dd>
                {fmtDate(new Date(mission.launch.getTime() + mission.phases[mission.phases.length - 2 >= 0 && !isOrbit ? mission.phases.length - 2 : mission.phases.length - 1].t1 * 1000))}
              </dd>
            </div>
            {mission.dv.map((d) => (
              <div key={d.label}>
                <dt>{d.label}</dt>
                <dd>{d.dv.toFixed(2)} km/s</dd>
              </div>
            ))}
            <div className="plan-total">
              <dt>Δv needed</dt>
              <dd>{need.toFixed(2)} km/s</dd>
            </div>
            <div>
              <dt>Δv your vehicle has</dt>
              <dd>{cap.dv.toFixed(2)} km/s</dd>
            </div>
          </dl>
          <p className={`verdict ${cap.dv >= need ? "ok" : "short"}`}>
            {cap.dv >= need
              ? `It makes it, with ${(cap.dv - need).toFixed(2)} km/s to spare.`
              : `Short by ${(need - cap.dv).toFixed(2)} km/s with this payload. Lighten the payload, add a stage${project.vehicle.refuel ? "" : ", refuel in orbit"} or pick a cheaper scenario. The path is still drawn.`}
          </p>
          <p className="hint">Patched-conic estimate: two-body orbits joined at each planet. Good to a few percent; not for real mission planning.</p>
        </Section>
      )}
    </>
  );
}

function CameraPanel(props: { project: Project; update: Up; t: number; mission: Mission | null; onAdd: () => void; onJump: (k: Project["camera"]["keypoints"][number]) => void }) {
  const { project, update } = props;
  const c = project.camera;
  const setLook = (patch: Partial<Project["look"]>) => update((p) => ({ ...p, look: { ...p.look, ...patch } }));
  return (
    <>
      <header className="panel-intro">
        <h2>Camera</h2>
        <p>{project.mode === "vehicle" ? "Follow the craft, or set your own moves with keypoints." : "Set keypoints: move the view, scrub the timeline, and add a keypoint. The camera glides through them on a smooth curve."}</p>
      </header>
      {project.mode === "vehicle" && (
        <Segmented
          label="Camera"
          value={c.mode}
          options={[
            { value: "follow", label: "Follow the craft" },
            { value: "keypoints", label: "Keypoints" },
          ]}
          onChange={(v) => update((p) => ({ ...p, camera: { ...p.camera, mode: v } }))}
        />
      )}
      {project.mode === "vehicle" && c.mode === "follow" && <p className="hint">The camera keeps your current viewing angle and pulls back as the craft leaves a planet. Turn the view before pressing play to change the angle.</p>}
      <Field label="Look at">
        <select className="input" value={c.focus} onChange={(e) => update((p) => ({ ...p, camera: { ...p.camera, focus: e.target.value as BodyId } }))}>
          {BODY_IDS.map((b) => (
            <option key={b} value={b}>
              {BODIES[b].name}
            </option>
          ))}
        </select>
      </Field>
      {(c.mode === "keypoints" || project.mode === "observer") && (
        <Section title="Keypoints" hint={`At ${fmtClock(props.t)} in the video.`}>
          <button type="button" className="btn btn-secondary btn-wide" onClick={props.onAdd}>
            + Add keypoint from this view
          </button>
          {c.keypoints.length === 0 ? (
            <p className="hint">No keypoints yet: the view stays where you leave it.</p>
          ) : (
            <ol className="keypoints">
              {[...c.keypoints]
                .sort((a, b) => a.t - b.t)
                .map((k) => (
                  <li key={k.id}>
                    <button type="button" className="kp-jump" onClick={() => props.onJump(k)}>
                      <strong>{fmtClock(k.t)}</strong> {k.target === "vehicle" ? "Craft" : BODIES[k.target].name}
                    </button>
                    <button type="button" className="icon-btn" aria-label="Remove keypoint" onClick={() => update((p) => ({ ...p, camera: { ...p.camera, keypoints: p.camera.keypoints.filter((x) => x.id !== k.id) } }))}>
                      ×
                    </button>
                  </li>
                ))}
            </ol>
          )}
        </Section>
      )}
      <Section title="Look">
        {project.mode === "vehicle" && (
          <>
            <ColorPicker label="Flight path colour" value={project.look.pathColor} onChange={(v) => setLook({ pathColor: v })} />
            <Slider label="Path thickness" value={project.look.pathWidth} min={1} max={8} step={0.5} format={(v) => `${v} px`} onChange={(v) => setLook({ pathWidth: v })} />
          </>
        )}
        <Slider label="Planet size" value={project.look.planetSize} min={0.5} max={3} step={0.1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setLook({ planetSize: v })} />
        <Toggle label="Orbits" hint="Faint rings where the planets and moons travel." checked={project.look.orbits} onChange={(v) => setLook({ orbits: v })} />
        <Toggle label="Names" checked={project.look.labels} onChange={(v) => setLook({ labels: v })} />
        <Toggle label="Date and time" hint="Shown in the corner of the video." checked={project.look.dateStamp} onChange={(v) => setLook({ dateStamp: v })} />
      </Section>
    </>
  );
}

function ExportPanel(props: {
  project: Project;
  update: Up;
  total: number;
  progress: ExportProgress | null;
  result: { url: string; blob: Blob; w: number; h: number } | null;
  error: string | null;
  onRender: () => void;
  onCancel: () => void;
}) {
  const { project, update } = props;
  const o = project.output;
  const set = (patch: Partial<Project["output"]>) => update((p) => ({ ...p, output: { ...p.output, ...patch } }));
  const size = outputSize(o.aspect, o.resolution);
  return (
    <>
      <header className="panel-intro">
        <h2>Preview & export</h2>
        <p>Press play to preview. The video is rendered frame by frame in this browser.</p>
      </header>
      <Field label="Resolution">
        <Segmented label="Resolution" value={o.resolution} options={[1080, 1440, 2160].map((r) => ({ value: r as 1080 | 1440 | 2160, label: r === 2160 ? "4K" : `${r}p` }))} onChange={(v) => set({ resolution: v })} />
      </Field>
      <Field label="Frame rate">
        <Segmented label="Frame rate" value={o.fps} options={[24, 25, 30, 60].map((f) => ({ value: f as 24 | 25 | 30 | 60, label: `${f}` }))} onChange={(v) => set({ fps: v })} />
      </Field>
      <Slider label="Still at the start" value={o.holdStart} min={0} max={5} step={0.5} format={(v) => `${v} s`} onChange={(v) => set({ holdStart: v })} />
      <Slider label="Still at the end" value={o.holdEnd} min={0} max={5} step={0.5} format={(v) => `${v} s`} onChange={(v) => set({ holdEnd: v })} />
      <Toggle label="Credits in the video" hint="Ephemeris and texture credits, small in the corner. The textures' licence asks for it." checked={o.credit} onChange={(v) => set({ credit: v })} />
      <p className="hint">
        {size.width} × {size.height}, {props.total.toFixed(1)} s, MP4.
      </p>
      {props.progress ? (
        <div className="render-progress">
          <div className="progress">
            <span style={{ width: `${(props.progress.frame / props.progress.frames) * 100}%` }} />
          </div>
          <p className="hint">
            {props.progress.paused ? "Paused while this tab is hidden." : `Frame ${props.progress.frame} of ${props.progress.frames}`}
          </p>
          <button type="button" className="btn btn-small" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary btn-wide" onClick={props.onRender}>
          Render video
        </button>
      )}
      {props.error && <p className="error">{props.error}</p>}
      {props.result && (
        <div className="render-result">
          <video src={props.result.url} controls muted playsInline />
          <button type="button" className="btn btn-primary btn-wide" onClick={() => downloadBlob(props.result!.blob, `${slug(project.name)}.mp4`)}>
            Download MP4
          </button>
        </div>
      )}
    </>
  );
}
