import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import logoUrl from "../assets/voyager-space-logo.svg";
import { BODIES, type BodyId } from "../lib/bodies";
import { downloadProjectFile, duplicateProject, getProject, saveProject } from "../lib/db";
import { exportVideo, ExportUnsupportedError, type ExportProgress } from "../lib/exporter";
import { tenth } from "../lib/format";
import { buildMission, isLocal, searchTransfers, type Mission, type Transfer } from "../lib/mission";
import { dateAt, makeTimeline } from "../lib/timeline";
import { ASPECTS, isPristine, newProject, outputSize, uid, type Aspect, type Keypoint, type LookTarget, type Project } from "../lib/types";
import { navigate } from "../router";
import { ThemeToggle } from "../theme";
import { CameraPanel } from "./panels/CameraPanel";
import { ExportPanel } from "./panels/ExportPanel";
import { SchedulePanel } from "./panels/SchedulePanel";
import { StartPanel } from "./panels/StartPanel";
import { VehiclePanel } from "./panels/VehiclePanel";
import { Stage, type CamMode, type StageHandle } from "./Stage";
import { Timeline } from "./Timeline";
import { showAllTips, useClosedTips } from "./Tip";

type Step = "start" | "vehicle" | "schedule" | "camera" | "export";
const STEP_LABEL: Record<Step, string> = { start: "Start", vehicle: "Vehicle", schedule: "Schedule & Destination", camera: "Camera", export: "Preview & export" };
const NEXT_LABEL: Record<Step, string> = { start: "Next: choose vehicle", vehicle: "Next: schedule & destination", schedule: "Next: camera", camera: "Next: preview & export", export: "" };

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
  return <EditorLoaded key={project.id} initial={project} />;
}

function EditorLoaded({ initial }: { initial: Project }) {
  const [project, setProject] = useState(initial);
  const update = useCallback((fn: (p: Project) => Project) => setProject((p) => ({ ...fn(p), updatedAt: Date.now() })), []);
  const [step, setStep] = useState<Step>("start");
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [menu, setMenu] = useState(false);
  // keypoints: the user has taken the view by hand; playing gives it back to the camera move
  const [override, setOverride] = useState(false);
  const [askReset, setAskReset] = useState(false);
  const resetBtn = useRef<HTMLButtonElement>(null);
  const stage = useRef<StageHandle>(null);
  const tipsClosed = useClosedTips() !== "";

  // autosave
  useEffect(() => {
    const id = setTimeout(() => saveProject(project), 400);
    return () => clearTimeout(id);
  }, [project]);
  useEffect(() => {
    document.documentElement.classList.add("editor-open");
    return () => document.documentElement.classList.remove("editor-open");
  }, []);

  const vehicle = project.mode === "vehicle";
  const steps: Step[] = vehicle ? ["start", "vehicle", "schedule", "camera", "export"] : ["start", "schedule", "camera", "export"];

  // ---- the mission
  const from = project.start.body;
  const dest = project.schedule.destination;
  const helioDest = vehicle && !!dest && dest in BODIES && dest !== from && !isLocal(from, dest as BodyId);
  const transfers = useMemo<Transfer[] | null>(
    () => (helioDest ? searchTransfers(from, dest as BodyId, new Date(project.schedule.date), project.schedule.windowDays) : null),
    [helioDest, from, dest, project.schedule.date, project.schedule.windowDays],
  );
  const mission = useMemo<Mission | null>(
    () => (vehicle ? buildMission(project, transfers) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.mode, project.start.body, project.start.site, project.schedule, project.vehicle, project.timing, transfers],
  );
  const flightOk = vehicle && !!mission?.ok;
  // vehicle mode without a flight yet: why, for the Camera and Preview steps
  const noFlight = !vehicle || flightOk ? null : !dest ? "Choose a destination in step 3, Schedule & destination." : (mission?.message ?? "This flight couldn't be worked out.");
  const o = project.output;
  const tl = useMemo(
    () => makeTimeline(project, mission),
    // the timeline only reads these
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.mode, project.schedule.date, project.schedule.spanDays, project.timing.duration, o.holdStart, o.holdEnd, mission],
  );
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
  const timelineOff = vehicle && !flightOk;
  const togglePlay = () => {
    if (timelineOff) return;
    if (!playing) {
      if (t >= tl.total - 0.01) setT(0);
      // playing shows the camera move again
      setOverride(false);
    }
    setPlaying(!playing);
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
    setOverride(false);
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
  // The 3D view fills the stage; the video frame is a window in it, in a passe-partout that
  // dims the rest (as in Voyager Earth), with the frame's shape and size above its corner.
  const ratio = ASPECTS[project.output.aspect].ratio;
  const small = area.w < 820;
  const padX = small ? 12 : 48;
  const padY = small ? 34 : 52;
  const fw = Math.max(50, Math.floor(Math.min(area.w - padX * 2, (area.h - padY * 2) * ratio)));
  const fh = Math.floor(fw / ratio);
  const fx = Math.round((area.w - fw) / 2);
  const fy = Math.round((area.h - fh) / 2);
  const out = outputSize(project.output.aspect, project.output.resolution);

  // ---- what the view does
  const cam = project.camera;
  const firstSteps = step === "start" || step === "vehicle";
  const focus: LookTarget = vehicle && firstSteps ? (project.start.view === "site" ? "site" : from) : cam.focus;
  const camStep = step === "camera" || step === "export";
  const usesKeypoints = !vehicle || cam.mode === "keypoints";
  // Camera and Preview steps: the follow camera, or the keypoint move (also when paused, so
  // what you see is what gets rendered); without keypoints the view is free.
  const camMode: CamMode = !camStep ? "free" : vehicle && cam.mode === "follow" && flightOk ? "follow" : usesKeypoints && cam.keypoints.length && !timelineOff ? "keypoints" : "free";
  const markers = camStep && usesKeypoints && !timelineOff ? cam.keypoints : null;
  const showPorts = vehicle && step === "start" && from === "earth";

  // a new camera mode, or no keypoints left: nothing to give back
  useEffect(() => setOverride(false), [cam.mode, cam.keypoints.length === 0]);
  // centred on the launch site: another site brings the view along
  const firstSite = useRef(true);
  useEffect(() => {
    if (firstSite.current) {
      firstSite.current = false;
      return;
    }
    if (focus === "site") stage.current?.frameBody("site");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.start.site, project.start.body]);

  const setFocus = (target: LookTarget) => setProject((p) => (p.camera.focus === target ? p : { ...p, camera: { ...p.camera, focus: target }, updatedAt: Date.now() }));

  // ---- keypoints
  const addKeypoint = () => {
    const v = stage.current?.currentView();
    if (!v) return;
    const at = tenth(tClamped);
    const k: Keypoint = { id: uid(), t: at, target: v.target, offset: v.offset };
    // one keypoint per moment: adding where one is replaces it
    update((p) => ({ ...p, camera: { ...p.camera, mode: "keypoints", keypoints: [...p.camera.keypoints.filter((x) => Math.abs(x.t - at) >= 0.05), k] } }));
    setPlaying(false);
    setT(at);
    setOverride(false);
  };
  const moveKeypoint = (id: string, at: number) => {
    update((p) => ({ ...p, camera: { ...p.camera, keypoints: p.camera.keypoints.map((k) => (k.id === id ? { ...k, t: at } : k)) } }));
    setPlaying(false);
    setT(at);
    setOverride(false);
  };
  const goToKeypoint = (k: Keypoint) => {
    setPlaying(false);
    setT(k.t);
    setOverride(false);
  };
  const lookAt = (target: LookTarget) => {
    setFocus(target);
    stage.current?.frameBody(target);
  };

  // ---- reset
  const pristine = useMemo(() => isPristine(project), [project]);
  const reset = () => {
    const fresh = newProject(project.name);
    setProject((p) => ({ ...fresh, id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: Date.now() }));
    setAskReset(false);
    setPlaying(false);
    setOverride(false);
    setT(0);
    setStep("start");
    setResult(null);
    setExportError(null);
    requestAnimationFrame(() => stage.current?.frameBody(fresh.start.body));
  };

  // ---- export
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob; w: number; h: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const render = async () => {
    setPlaying(false);
    setOverride(false);
    setExportError(null);
    setResult(null);
    abort.current = new AbortController();
    setProgress({ frame: 0, frames: 1, elapsedMs: 0, paused: false });
    try {
      const v = stage.current?.currentView() ?? { target: focus, offset: [0.05, 0.02, 0.05] as [number, number, number] };
      const r = await exportVideo({ project, mission, tl, view: { offset: v.offset, focus: v.target } }, setProgress, abort.current.signal);
      setResult({ url: URL.createObjectURL(r.blob), blob: r.blob, w: r.width, h: r.height });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setExportError(e instanceof ExportUnsupportedError ? e.message : `The render stopped: ${e instanceof Error ? e.message : e}`);
    } finally {
      setProgress(null);
    }
  };

  const i = steps.indexOf(step);
  const next = steps[i + 1];
  const warn = vehicle && !flightOk && step !== "start" && step !== "vehicle" ? (!dest ? (step === "schedule" ? "Choose a destination to plan the flight." : "Choose a destination in step 3 to plan the flight.") : mission?.message) : null;

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
                {tipsClosed && (
                  <button type="button" role="menuitem" onClick={() => (setMenu(false), showAllTips())}>
                    Show the tips again
                  </button>
                )}
              </div>
            )}
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="app-version">Version {__APP_VERSION__}</div>

      <nav className="steps" aria-label="Steps">
        {!pristine && (
          <button
            ref={resetBtn}
            type="button"
            className={`step-reset${askReset ? " is-active" : ""}`}
            aria-haspopup="dialog"
            aria-expanded={askReset}
            title="Reset all settings"
            onClick={() => setAskReset(!askReset)}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
              <path d="M3.2 6.2A5 5 0 1 1 3 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M2.6 2.6v3.9h3.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Reset
          </button>
        )}
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
      {askReset && !pristine && <ResetConfirm anchor={resetBtn.current} onReset={reset} onClose={() => setAskReset(false)} />}

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
              noFlight={noFlight}
              override={override && camMode === "keypoints"}
              onAdd={addKeypoint}
              onJump={goToKeypoint}
              onRelease={() => setOverride(false)}
              onLookAt={lookAt}
              onGoSchedule={() => goStep("schedule")}
            />
          )}
          {step === "export" && (
            <ExportPanel
              project={project}
              update={update}
              total={tl.total}
              noFlight={noFlight}
              progress={progress}
              result={result}
              error={exportError}
              onRender={render}
              onCancel={() => abort.current?.abort()}
              onGoSchedule={() => goStep("schedule")}
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
          <Stage
              ref={stage}
              project={project}
              mission={mission}
              tl={tl}
              t={tClamped}
              camMode={camMode}
              override={override}
              onOverride={(target) => {
                setPlaying(false);
                setOverride(true);
                setFocus(target);
              }}
              onFollowChange={(f) => update((p) => ({ ...p, camera: { ...p.camera, follow: f } }))}
              focus={focus}
              showSpaceports={showPorts}
              startSymbol={!vehicle ? "never" : firstSteps ? "always" : "video"}
              onPickSpaceport={(id) => update((p) => ({ ...p, start: { ...p.start, site: id } }))}
              width={area.w}
              height={area.h}
              frame={{ x: fx, y: fy, w: fw, h: fh }}
            />
          <div className={`frame${progress ? " is-rendering" : ""}`} style={{ left: fx, top: fy, width: fw, height: fh }}>
            <div className="frame-size" aria-label={`Video size ${project.output.aspect}, ${out.width} by ${out.height} pixels`}>
              {project.output.aspect} · {out.width}×{out.height}
            </div>
            {showPorts && <div className="stage-hint">Drag to turn the globe. Click a spaceport to launch from it.</div>}
            {warn && <div className="stage-hint stage-warn">{warn}</div>}
            {override && camMode === "keypoints" && (
              <div className="stage-note" role="status">
                <span>Adjusting the view by hand</span>
                <button type="button" onClick={() => setOverride(false)}>
                  Back to the camera move
                </button>
              </div>
            )}
          </div>
        </div>
        <Timeline
          t={tClamped}
          total={tl.total}
          playing={playing}
          disabled={timelineOff}
          date={dateAt(tl, tClamped)}
          marks={flightOk ? tl.marks : []}
          keypoints={markers}
          onTogglePlay={togglePlay}
          onScrub={(v) => {
            setPlaying(false);
            setT(v);
          }}
          onKeypointMove={moveKeypoint}
          onKeypointPick={goToKeypoint}
        />
      </main>
    </div>
  );
}

/** "Reset all settings?" under the reset button. */
function ResetConfirm({ anchor, onReset, onClose }: { anchor: HTMLElement | null; onReset: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor?.getBoundingClientRect();
      if (!r) return;
      const w = ref.current?.offsetWidth ?? 300;
      setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), top: r.bottom + 6 });
    };
    place();
    window.addEventListener("resize", place);
    // the page scrolls on small screens, and the step bar sideways
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);
  useEffect(() => {
    cancel.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const down = (e: PointerEvent) => {
      const el = e.target as Node;
      if (!ref.current?.contains(el) && !anchor?.contains(el)) onClose();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", down);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", down);
    };
  }, [anchor, onClose]);
  return (
    <div ref={ref} className="confirm" role="dialog" aria-label="Reset all settings" style={pos ?? { visibility: "hidden" }}>
      <p>
        <strong>Reset all settings?</strong>
        Every step goes back to how a new project starts. The project name stays.
      </p>
      <div className="confirm-actions">
        <button type="button" className="btn btn-small btn-danger" onClick={onReset}>
          Reset
        </button>
        <button ref={cancel} type="button" className="btn btn-small" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
