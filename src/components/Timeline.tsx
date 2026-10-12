import { useRef, useState } from "react";
import { fmtClock, fmtDate, tenth } from "../lib/format";
import type { Keypoint } from "../lib/types";

/**
 * Play button, time, scrubber and the date. With keypoints, each one is a diamond above the
 * scrubber: drag it (or use the arrow keys) to change when the camera is there, click it to go
 * there.
 */
export function Timeline(props: {
  t: number;
  total: number;
  playing: boolean;
  /** nothing to play yet */
  disabled: boolean;
  date: Date;
  /** phase boundaries, seconds of video */
  marks: number[];
  /** the camera's keypoints, or null when the camera doesn't use them here */
  keypoints: Keypoint[] | null;
  onTogglePlay: () => void;
  onScrub: (t: number) => void;
  onKeypointMove: (id: string, t: number) => void;
  onKeypointPick: (k: Keypoint) => void;
}) {
  const { t, total } = props;
  const lane = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x0: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const clamp = (x: number) => Math.max(0, Math.min(tenth(total), tenth(x)));
  const timeAt = (clientX: number) => {
    const r = lane.current!.getBoundingClientRect();
    return clamp(((clientX - r.left) / Math.max(1, r.width)) * total);
  };
  const pct = (x: number) => `${(Math.min(Math.max(0, x), total) / Math.max(1e-6, total)) * 100}%`;
  const kps = props.keypoints;

  return (
    <div className={`timeline${kps ? " has-keypoints" : ""}`}>
      <button type="button" className="play" aria-label={props.playing ? "Pause" : "Play"} disabled={props.disabled} onClick={props.onTogglePlay}>
        {props.playing ? (
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
        {fmtClock(t)} <span className="time-total">/ {fmtClock(total)}</span>
      </span>
      <div className="scrub-wrap">
        <input
          className="scrub"
          type="range"
          min={0}
          max={total}
          step={0.01}
          value={t}
          disabled={props.disabled}
          aria-label="Time"
          aria-valuetext={fmtClock(t)}
          onChange={(e) => props.onScrub(parseFloat(e.target.value))}
        />
        {!props.disabled && (
          <div className="scrub-marks" aria-hidden>
            {props.marks.map((m, n) => (
              <span key={n} className="mark mark-sign" style={{ left: pct(m) }} />
            ))}
          </div>
        )}
        {kps && (
          <div className="kp-lane" ref={lane}>
            {kps.map((k) => (
              <button
                key={k.id}
                type="button"
                className={`kp-marker${Math.abs(t - k.t) < 0.05 ? " on" : ""}${dragId === k.id ? " dragging" : ""}`}
                style={{ left: pct(k.t) }}
                aria-label={`Keypoint at ${fmtClock(k.t)}. Arrow keys move it.`}
                title={`Keypoint at ${fmtClock(k.t)}: drag to move it, click to go there`}
                disabled={props.disabled}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.currentTarget.focus();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drag.current = { id: k.id, x0: e.clientX, moved: false };
                  dragged.current = false;
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (!d || d.id !== k.id) return;
                  if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
                  if (!d.moved) setDragId(k.id);
                  d.moved = true;
                  props.onKeypointMove(k.id, timeAt(e.clientX));
                }}
                onPointerUp={() => {
                  dragged.current = !!drag.current?.moved;
                  drag.current = null;
                  setDragId(null);
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  setDragId(null);
                }}
                onClick={() => {
                  // a drag ends with a click too: that one only lets go
                  if (dragged.current) {
                    dragged.current = false;
                    return;
                  }
                  props.onKeypointPick(k);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                  e.preventDefault();
                  const step = (e.shiftKey ? 1 : 0.1) * (e.key === "ArrowLeft" ? -1 : 1);
                  props.onKeypointMove(k.id, clamp(k.t + step));
                }}
              />
            ))}
          </div>
        )}
      </div>
      <span className="sim-date">{fmtDate(props.date)}</span>
    </div>
  );
}
