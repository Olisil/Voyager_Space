import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, canEncodeVideo, type VideoCodec } from "mediabunny";
import { displayPos } from "./bodies";
import { cameraAt, sitePos, startAlpha, type CameraCtx } from "./camera";
import { CREDIT, drawOverlay } from "./overlay";
import { SpaceScene, texturesReady } from "./scene";
import { dateAt, frameWeights, simAt } from "./timeline";
import { outputSize, siteOf } from "./types";

export interface ExportProgress {
  frame: number;
  frames: number;
  elapsedMs: number;
  paused: boolean;
}
export interface ExportResult {
  blob: Blob;
  width: number;
  height: number;
  codec: VideoCodec;
}
export class ExportUnsupportedError extends Error {}

const bitrateFor = (w: number, h: number, fps: number) => Math.round(w * h * fps * 0.15);

async function pickCodec(width: number, height: number, fps: number): Promise<VideoCodec> {
  if (typeof VideoEncoder === "undefined") throw new ExportUnsupportedError("This browser can't encode video. Use a recent Chrome, Edge or Safari.");
  const bitrate = bitrateFor(width, height, fps);
  for (const codec of ["avc", "hevc", "vp9", "av1"] as VideoCodec[]) if (await canEncodeVideo(codec, { width, height, bitrate })) return codec;
  throw new ExportUnsupportedError("No video format this browser can encode at this size. Try a smaller resolution.");
}

const visible = () =>
  !document.hidden
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const on = () => {
          if (!document.hidden) {
            document.removeEventListener("visibilitychange", on);
            resolve();
          }
        };
        document.addEventListener("visibilitychange", on);
      });

/**
 * Renders the video frame by frame in its own off-screen 3D view at the output size:
 * every frame is set to its exact moment, so the result never depends on playback speed.
 */
export async function exportVideo(ctx: CameraCtx, onProgress: (p: ExportProgress) => void, signal: AbortSignal): Promise<ExportResult> {
  const p = ctx.project;
  const { width, height } = outputSize(p.output.aspect, p.output.resolution);
  const fps = p.output.fps;
  const codec = await pickCodec(width, height, fps);
  const glCanvas = document.createElement("canvas");
  glCanvas.width = width;
  glCanvas.height = height;
  const space = new SpaceScene(glCanvas, { preserve: true });
  space.setSize(width, height, 1);
  const frameCanvas = document.createElement("canvas");
  frameCanvas.width = width;
  frameCanvas.height = height;
  const g = frameCanvas.getContext("2d")!;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const source = new CanvasSource(frameCanvas, { codec, bitrate: bitrateFor(width, height, fps), keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();
  const frames = Math.max(1, Math.round(ctx.tl.total * fps));
  const started = performance.now();
  // labels are laid out for a ~1080 px tall view, then scaled
  const scale = height / 1080;
  const lw = width / scale;
  const lh = 1080;
  try {
    // warm up: load every texture before the first frame
    space.update({ date: dateAt(ctx.tl, 0), boost: p.look.planetSize, sim: null, mission: ctx.mission, look: p.look, showSpaceports: false, selectedSpaceport: null });
    await texturesReady();
    // the HUD's typeface has to be in before the first frame is drawn
    await Promise.all(['600 40px "Barlow"', '500 40px "Barlow"'].map((f) => document.fonts?.load?.(f).catch(() => null)));
    for (let f = 0; f < frames; f++) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      if (document.hidden) {
        onProgress({ frame: f, frames, elapsedMs: performance.now() - started, paused: true });
        await visible();
      }
      const t = f / fps;
      const date = dateAt(ctx.tl, t);
      const sim = p.mode === "vehicle" && ctx.mission?.ok ? simAt(ctx.tl, t) : null;
      space.update({ date, boost: p.look.planetSize, sim, mission: p.mode === "vehicle" ? ctx.mission : null, look: p.look, showSpaceports: false, selectedSpaceport: null, frames: sim !== null ? frameWeights(ctx.tl, t) : undefined });
      const cam = cameraAt(ctx, t);
      space.camera.position.set(...cam.pos);
      space.camera.lookAt(...cam.target);
      // close to a body: wait for its sharp map before drawing the frame
      space.updateDetail(true);
      if (space.detailLoading) await space.detailReady();
      space.render();
      g.clearRect(0, 0, width, height);
      g.drawImage(glCanvas, 0, 0);
      const alpha = startAlpha(ctx, t);
      let start: { x: number; y: number; name: string; alpha: number } | null = null;
      if (alpha > 0) {
        const at = space.surfaceToScreen(displayPos(p.start.body, date, p.look.planetSize), sitePos(p, date, 1.002));
        if (at) start = { x: at.x / scale, y: at.y / scale, name: siteOf(p).name, alpha };
      }
      drawOverlay(g, {
        scene: { ...space, project: (pt) => { const s = space.project(pt); return s ? { x: s.x / scale, y: s.y / scale } : null; } } as SpaceScene,
        date,
        boost: p.look.planetSize,
        width: lw,
        height: lh,
        scale,
        labels: p.look.labels,
        dateStamp: p.look.dateStamp,
        credit: p.output.credit ? CREDIT : null,
        start,
        focus: null,
        hud: p.mode === "vehicle" && p.look.hud && ctx.mission?.ok ? { mission: ctx.mission, tl: ctx.tl, t, date, showDate: p.look.dateStamp } : null,
      });
      await source.add(f / fps, 1 / fps);
      if (f % 3 === 0) {
        onProgress({ frame: f + 1, frames, elapsedMs: performance.now() - started, paused: false });
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    await output.finalize();
  } catch (e) {
    if (output.state !== "finalized") await output.cancel().catch(() => {});
    throw e;
  } finally {
    space.dispose();
  }
  const buffer = (output.target as BufferTarget).buffer!;
  return { blob: new Blob([buffer], { type: "video/mp4" }), width, height, codec };
}
