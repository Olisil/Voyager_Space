import { BODIES } from "../../lib/bodies";
import type { Project } from "../../lib/types";
import { capability, PRESETS, presetVehicle, type Stage as VStage } from "../../lib/vehicles";
import { Field, Section, Toggle } from "../Controls";
import { Tip } from "../Tip";
import type { Up } from "./StartPanel";

export function VehiclePanel({ project, update }: { project: Project; update: Up }) {
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
      <Tip id="vehicle-dv" title="What Δv means">
        <p>Δv is how much your rocket can change its speed, and every flight needs a certain amount of it. Step 3 compares what the flight needs with what this rocket has. A lighter payload, another stage or refuelling in orbit can add more.</p>
      </Tip>
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
