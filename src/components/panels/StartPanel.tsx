import { BODIES, BODY_IDS, type BodyId } from "../../lib/bodies";
import { AUTO_SITES, EARTH_ORBITS, SPACEPORTS, START_BODIES, type Destination, type Project } from "../../lib/types";
import { Field, Section } from "../Controls";
import { Tip } from "../Tip";

export type Up = (fn: (p: Project) => Project) => void;

const isEarthOrbit = (d: Destination | null) => !!d && EARTH_ORBITS.some((o) => o.id === d);

export function StartPanel({ project, update, onFocus }: { project: Project; update: Up; onFocus: (b: BodyId) => void }) {
  const m = project.mode;
  return (
    <>
      <header className="panel-intro">
        <h2>Godspeed!</h2>
        <p>Choose type of visualization</p>
      </header>
      <div className="source-cards">
        <button type="button" className={`source-card${m === "observer" ? " on" : ""}`} aria-pressed={m === "observer"} onClick={() => update((p) => ({ ...p, mode: "observer", camera: { ...p.camera, mode: "keypoints", focus: p.camera.focus === "vehicle" ? "earth" : p.camera.focus } }))}>
          <span className="source-title">Space observer</span>
          <span className="source-hint">Define a path through the solar system, through keypoints.</span>
        </button>
        <button type="button" className={`source-card${m === "vehicle" ? " on" : ""}`} aria-pressed={m === "vehicle"} onClick={() => update((p) => ({ ...p, mode: "vehicle", camera: { ...p.camera, mode: p.camera.keypoints.length ? p.camera.mode : "follow" } }))}>
          <span className="source-title">Vehicle path</span>
          <span className="source-hint">Launch a spaceship and follow the path to a destination.</span>
        </button>
      </div>
      {m === "observer" ? (
        <>
          <Tip id="start-observer" title="Space observer">
            <p>Pick what to look at first. Next, set the dates: the planets travel as they really do. Then move the camera through the solar system with keypoints.</p>
          </Tip>
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
        </>
      ) : (
        <>
          <Tip id="start-vehicle" title="How it works">
            <p>Choose where to launch from here and a rocket in step 2. In step 3 you pick the destination and the date, and the flight is worked out from where the planets really are. Then set up the camera and render the video.</p>
          </Tip>
          <Section title="Starting point">
            <div className="chips">
              {START_BODIES.map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`chip${project.start.body === b ? " on" : ""}`}
                  onClick={() =>
                    update((p) => {
                      const d = p.schedule.destination;
                      // a destination that no longer fits the new starting point is cleared, to pick again in step 3
                      const clash = d === b || (b !== "earth" && isEarthOrbit(d));
                      return {
                        ...p,
                        start: { body: b, site: b === "earth" ? (SPACEPORTS.some((s) => s.id === p.start.site) ? p.start.site : "ksc") : `auto-${b}` },
                        schedule: { ...p.schedule, destination: clash ? null : d },
                        camera: { ...p.camera, focus: b },
                      };
                    })
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
                <span>Picked automatically: near the equator, where {project.start.body === "moon" ? "the Moon" : BODIES[project.start.body].name}'s spin gives the most help into orbit.</span>
              </div>
            )}
          </Section>
        </>
      )}
    </>
  );
}
