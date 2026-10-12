import { downloadBlob, slug } from "../../lib/db";
import type { ExportProgress } from "../../lib/exporter";
import { outputSize, type Project } from "../../lib/types";
import { Field, Segmented, Slider, Toggle } from "../Controls";
import { Tip } from "../Tip";
import type { Up } from "./StartPanel";

export function ExportPanel(props: {
  project: Project;
  update: Up;
  total: number;
  /** vehicle mode without a flight: why, and what to do (nothing to render yet) */
  noFlight: string | null;
  progress: ExportProgress | null;
  result: { url: string; blob: Blob; w: number; h: number } | null;
  error: string | null;
  onRender: () => void;
  onCancel: () => void;
  onGoSchedule: () => void;
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
      <Tip id="export-render" title="Rendering">
        <p>Every frame is drawn here in your browser, so a long video in 4K takes a while. Keep this tab open and in view: rendering pauses while the tab is hidden.</p>
      </Tip>
      <Field label="Resolution">
        <Segmented label="Resolution" value={o.resolution} options={[1080, 1440, 2160].map((r) => ({ value: r as 1080 | 1440 | 2160, label: r === 2160 ? "4K" : `${r}p` }))} onChange={(v) => set({ resolution: v })} />
      </Field>
      <Field label="Frame rate">
        <Segmented label="Frame rate" value={o.fps} options={[24, 25, 30, 60].map((f) => ({ value: f as 24 | 25 | 30 | 60, label: `${f}` }))} onChange={(v) => set({ fps: v })} />
      </Field>
      {project.mode === "vehicle" && (
        <Slider label="Length of the long coast" value={project.timing.duration} min={4} max={60} step={1} format={(v) => `${v} s`} onChange={(v) => update((p) => ({ ...p, timing: { duration: v } }))} />
      )}
      <Slider label="Still at the start" value={o.holdStart} min={0} max={5} step={0.5} format={(v) => `${v} s`} onChange={(v) => set({ holdStart: v })} />
      <Slider label="Still at the end" value={o.holdEnd} min={0} max={5} step={0.5} format={(v) => `${v} s`} onChange={(v) => set({ holdEnd: v })} />
      <Toggle label="Credits in the video" hint="Ephemeris and texture credits, small in the corner. The textures' licence asks for it." checked={o.credit} onChange={(v) => set({ credit: v })} />
      {!props.noFlight ? (
        <p className="hint">
          {size.width} × {size.height}, {props.total.toFixed(1)} s, MP4.
        </p>
      ) : (
        <div className="info-box info-action">
          <strong>Nothing to render yet</strong>
          <span>{props.noFlight}</span>
          <button type="button" className="btn btn-secondary btn-small" onClick={props.onGoSchedule}>
            Go to Schedule & destination
          </button>
        </div>
      )}
      {props.progress ? (
        <div className="render-progress">
          <div className="progress">
            <span style={{ width: `${(props.progress.frame / props.progress.frames) * 100}%` }} />
          </div>
          <p className="hint">{props.progress.paused ? "Paused while this tab is hidden." : `Frame ${props.progress.frame} of ${props.progress.frames}`}</p>
          <button type="button" className="btn btn-small" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary btn-wide" disabled={!!props.noFlight} onClick={props.onRender}>
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
