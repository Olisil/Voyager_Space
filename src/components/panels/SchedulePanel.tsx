import { BODIES, type BodyId } from "../../lib/bodies";
import { hasAir, LANDABLE } from "../../lib/descent";
import { fmtDate, fmtDur } from "../../lib/format";
import { isLocal, MOON_TOF, pickScenario, totalDv, type Mission, type Transfer } from "../../lib/mission";
import { EARTH_ORBITS, type Destination, type Project, type Scenario } from "../../lib/types";
import { capability } from "../../lib/vehicles";
import { Field, Section, Slider, Toggle } from "../Controls";
import { Tip } from "../Tip";
import type { Up } from "./StartPanel";

const SCENARIOS: { id: Scenario; name: string }[] = [
  { id: "asap", name: "As soon as possible" },
  { id: "fastest", name: "Fastest" },
  { id: "cheapest", name: "Least fuel" },
  { id: "balanced", name: "Balanced" },
];

export function SchedulePanel({ project, update, mission, transfers }: { project: Project; update: Up; mission: Mission | null; transfers: Transfer[] | null }) {
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
  const dest = s.destination;
  const dests: { group: string; items: { id: Destination; name: string }[] }[] = [];
  if (from === "earth") dests.push({ group: "Earth orbits", items: EARTH_ORBITS.map((o) => ({ id: o.id, name: o.name })) });
  dests.push({
    group: "Moon and planets",
    items: (["earth", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"] as BodyId[]).filter((b) => b !== from).map((b) => ({ id: b, name: BODIES[b].name })),
  });
  const isOrbit = !!dest && EARTH_ORBITS.some((o) => o.id === dest);
  const planet = !!dest && !isOrbit;
  const local2 = planet && isLocal(from, dest as BodyId);
  return (
    <>
      <header className="panel-intro">
        <h2>Schedule & destination</h2>
        <p>Pick where to go and when you'd like to leave. Transfer windows come from the real planet positions.</p>
      </header>
      <Tip id="schedule-destination" title="Where to?">
        <p>
          Choose an Earth orbit, the Moon or a planet, and the earliest day you could launch. For the planets, the window is searched for real transfer orbits and each
          scenario picks one: the soonest, the fastest, the one needing the least fuel, or a balance of time and fuel.
        </p>
      </Tip>
      <Field label="Destination">
        <select className={`input${dest ? "" : " is-empty"}`} value={dest ?? ""} onChange={(e) => set({ destination: (e.target.value || null) as Destination | null })}>
          <option value="" disabled>
            Choose a destination
          </option>
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
      {isOrbit && <p className="hint">{EARTH_ORBITS.find((o) => o.id === dest)?.hint}</p>}
      {dateField}
      {planet && !local2 && <Slider label="Window to search" value={s.windowDays} min={30} max={2000} step={10} format={(v) => (v < 365 ? `${v} days` : `${(v / 365.25).toFixed(1)} years`)} onChange={(v) => set({ windowDays: v })} />}
      {planet && (
        <Section title="Scenario">
          <div className="scenarios">
            {SCENARIOS.map((sc) => {
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
      {planet && LANDABLE.includes(dest as BodyId) && (
        <Toggle
          label={dest === "earth" ? "Come down to Earth" : `Land on ${dest === "moon" ? "the Moon" : BODIES[dest as BodyId].name}`}
          hint={hasAir(dest as BodyId) ? "Entry through the atmosphere, parachutes and touchdown. Off: stay in orbit." : "A powered descent to the surface. Off: stay in orbit."}
          checked={!!s.land}
          onChange={(v) => set({ land: v })}
        />
      )}
      {mission?.ok && (
        <Section title="Flight plan">
          <dl className="plan">
            <div>
              <dt>Launch</dt>
              <dd>{fmtDate(mission.launch)}</dd>
            </div>
            <div>
              <dt>{mission.landed ? (mission.to === "earth" ? "Splashdown" : "Touchdown") : isOrbit ? "In orbit" : "Arrival in orbit"}</dt>
              <dd>{fmtDate(mission.arrival)}</dd>
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
      {mission && !mission.ok && dest && <p className="error">{mission.message}</p>}
    </>
  );
}
