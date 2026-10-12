import { BODIES, BODY_IDS } from "../../lib/bodies";
import { fmtClock } from "../../lib/format";
import type { Keypoint, LookTarget, Project } from "../../lib/types";
import { ColorPicker, Field, Section, Segmented, Slider, Toggle } from "../Controls";
import { Tip } from "../Tip";
import type { Up } from "./StartPanel";

export const targetName = (t: LookTarget) => (t === "vehicle" ? "The craft" : t === "site" ? "The launch site" : BODIES[t].name);

export function CameraPanel(props: {
  project: Project;
  update: Up;
  t: number;
  /** vehicle mode without a flight: why, and what to do */
  noFlight: string | null;
  /** keypoints: the user is adjusting the view by hand */
  override: boolean;
  onAdd: () => void;
  onJump: (k: Keypoint) => void;
  onRelease: () => void;
  onLookAt: (target: LookTarget) => void;
  onGoSchedule: () => void;
}) {
  const { project, update } = props;
  const c = project.camera;
  const vehicle = project.mode === "vehicle";
  const usesKeypoints = !vehicle || c.mode === "keypoints";
  const kps = [...c.keypoints].sort((a, b) => a.t - b.t);
  const here = kps.find((k) => Math.abs(k.t - props.t) < 0.05);
  const setLook = (patch: Partial<Project["look"]>) => update((p) => ({ ...p, look: { ...p.look, ...patch } }));
  const looks: LookTarget[] = [...(vehicle ? (["vehicle", "site"] as LookTarget[]) : []), ...BODY_IDS];
  return (
    <>
      <header className="panel-intro">
        <h2>Camera</h2>
        <p>{vehicle ? "Follow the craft, or set your own moves with keypoints." : "Set keypoints: move the view, scrub the timeline, and add a keypoint. The camera glides through them on a smooth curve."}</p>
      </header>
      {props.noFlight && (
        <div className="info-box info-action">
          <strong>No flight to film yet</strong>
          <span>{props.noFlight}</span>
          <button type="button" className="btn btn-secondary btn-small" onClick={props.onGoSchedule}>
            Go to Schedule & destination
          </button>
        </div>
      )}
      {vehicle && (
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
      {vehicle && c.mode === "follow" && (
        <>
          <Tip id="camera-follow" title="Follow the craft">
            <p>The view rides along with the craft and pulls back as it leaves a planet. Drag to choose the angle and scroll to zoom: the camera keeps both all through the flight.</p>
          </Tip>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={!c.follow.dir && (c.follow.zoom || 1) === 1}
            onClick={() => update((p) => ({ ...p, camera: { ...p.camera, follow: { dir: null, zoom: 1 } } }))}
          >
            Reset angle and zoom
          </button>
          <Toggle
            label="Keep the camera above the craft"
            hint="Close to a planet or moon the camera stays on the far side of the craft from its centre, so the craft is never hidden behind it and the camera never dips inside."
            checked={c.above}
            onChange={(v) => update((p) => ({ ...p, camera: { ...p.camera, above: v } }))}
          />
        </>
      )}
      {usesKeypoints && !props.noFlight && (
        <>
          <Tip id="camera-keypoints" title="Keypoints">
            <p>
              Drag the view to turn it, scroll to zoom and move the playhead, then add a keypoint. Each one is a diamond above the timeline: drag it to change when the camera gets
              there. Playing glides through them. Touching the view lets you adjust it, until you press play.
            </p>
          </Tip>
          <Field label="Look at">
            <select className="input" value={c.focus} onChange={(e) => props.onLookAt(e.target.value as LookTarget)}>
              {looks.map((b) => (
                <option key={b} value={b}>
                  {targetName(b)}
                </option>
              ))}
            </select>
          </Field>
          <Section title="Keypoints">
            <button type="button" className="btn btn-secondary btn-wide" onClick={props.onAdd}>
              {here ? `Update the keypoint at ${fmtClock(here.t)}` : `+ Add keypoint at ${fmtClock(props.t)}`}
            </button>
            {props.override && kps.length > 0 && (
              <p className="hint hint-live kp-adjusting">
                You're adjusting the view. Add it as a keypoint, or{" "}
                <button type="button" className="link-button" onClick={props.onRelease}>
                  go back to the camera move
                </button>
                .
              </p>
            )}
            {kps.length === 0 ? (
              <p className="hint">No keypoints yet: the view stays where you leave it.</p>
            ) : (
              <ol className="keypoints">
                {kps.map((k) => (
                  <li key={k.id} className={Math.abs(k.t - props.t) < 0.05 ? "on" : ""}>
                    <button type="button" className="kp-jump" onClick={() => props.onJump(k)} title="Go to this keypoint">
                      <span className="kp-diamond" aria-hidden />
                      <strong>{fmtClock(k.t)}</strong> {targetName(k.target)}
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove the keypoint at ${fmtClock(k.t)}`}
                      onClick={() => update((p) => ({ ...p, camera: { ...p.camera, keypoints: p.camera.keypoints.filter((x) => x.id !== k.id) } }))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </>
      )}
      <Section title="Look">
        {vehicle && (
          <>
            <ColorPicker label="Flight path colour" value={project.look.pathColor} onChange={(v) => setLook({ pathColor: v })} />
            <Slider label="Path thickness" value={project.look.pathWidth} min={1} max={8} step={0.5} format={(v) => `${v} px`} onChange={(v) => setLook({ pathWidth: v })} />
          </>
        )}
        <Slider label="Planet size" value={project.look.planetSize} min={0.5} max={3} step={0.1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setLook({ planetSize: v })} />
        <Toggle label="Orbits" hint="Faint rings where the planets and moons travel." checked={project.look.orbits} onChange={(v) => setLook({ orbits: v })} />
        <Toggle label="Names" checked={project.look.labels} onChange={(v) => setLook({ labels: v })} />
        {vehicle && <Toggle label="Mission HUD" hint="Speed, altitude and a timeline of the flight's steps along the bottom, like a launch broadcast." checked={project.look.hud} onChange={(v) => setLook({ hud: v })} />}
        <Toggle
          label="Date and time"
          hint={vehicle && project.look.hud ? "Shown in the HUD." : "Shown in the corner of the video."}
          checked={project.look.dateStamp}
          onChange={(v) => setLook({ dateStamp: v })}
        />
      </Section>
    </>
  );
}
