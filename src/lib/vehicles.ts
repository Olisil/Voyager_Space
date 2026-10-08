/**
 * Launch vehicles described stage by stage. The rocket equation gives the speed change
 * (Δv) a stack can deliver with a given payload; the preset numbers are approximate public
 * figures, rounded, meant as a starting point — every value can be edited.
 */
export interface Stage {
  name: string;
  /** gross mass of the stage, tonnes (structure + propellant) */
  massT: number;
  /** propellant, tonnes */
  propT: number;
  /** specific impulse, seconds (an average of sea level and vacuum for first stages) */
  isp: number;
  /** thrust, kN */
  thrustKN: number;
}

export interface Vehicle {
  preset: string;
  stages: Stage[];
  payloadT: number;
  /** count each stage as refilled once in low orbit (Starship-style tanker flights) */
  refuel: boolean;
}

export interface Preset {
  id: string;
  name: string;
  hint: string;
  vehicle: Omit<Vehicle, "preset">;
}

export const PRESETS: Preset[] = [
  {
    id: "saturn-v",
    name: "Saturn V",
    hint: "Took Apollo to the Moon in one launch; the Apollo spacecraft did the lunar burns.",
    vehicle: {
      payloadT: 5,
      refuel: false,
      stages: [
        { name: "S-IC", massT: 2290, propT: 2160, isp: 275, thrustKN: 35100 },
        { name: "S-II", massT: 496, propT: 452, isp: 421, thrustKN: 5141 },
        { name: "S-IVB", massT: 123, propT: 109, isp: 421, thrustKN: 1033 },
        { name: "Apollo CSM + LM", massT: 40, propT: 26, isp: 314, thrustKN: 91 },
      ],
    },
  },
  {
    id: "falcon-9",
    name: "Falcon 9",
    hint: "The workhorse to low orbit; about 4 t to Mars when expended.",
    vehicle: {
      payloadT: 8,
      refuel: false,
      stages: [
        { name: "First stage", massT: 433, propT: 411, isp: 297, thrustKN: 7607 },
        { name: "Second stage", massT: 116, propT: 111, isp: 348, thrustKN: 981 },
      ],
    },
  },
  {
    id: "falcon-heavy",
    name: "Falcon Heavy",
    hint: "Three Falcon cores; sent Psyche towards the asteroid belt.",
    vehicle: {
      payloadT: 6,
      refuel: false,
      stages: [
        { name: "Three cores", massT: 1300, propT: 1233, isp: 297, thrustKN: 22819 },
        { name: "Second stage", massT: 116, propT: 111, isp: 348, thrustKN: 981 },
      ],
    },
  },
  {
    id: "starship",
    name: "Starship",
    hint: "Reaches orbit fully loaded, but needs refilling in orbit for the Moon or Mars.",
    vehicle: {
      payloadT: 100,
      refuel: true,
      stages: [
        { name: "Super Heavy", massT: 3600, propT: 3400, isp: 330, thrustKN: 74000 },
        { name: "Ship", massT: 1300, propT: 1200, isp: 375, thrustKN: 12000 },
      ],
    },
  },
  {
    id: "sls",
    name: "SLS Block 1",
    hint: "Artemis I: Orion around the Moon in one launch.",
    vehicle: {
      payloadT: 18,
      refuel: false,
      stages: [
        { name: "Solid boosters", massT: 1470, propT: 1260, isp: 269, thrustKN: 32000 },
        { name: "Core stage", massT: 1080, propT: 987, isp: 420, thrustKN: 7440 },
        { name: "ICPS", massT: 32.6, propT: 28.5, isp: 462, thrustKN: 110 },
        { name: "Orion service module", massT: 10, propT: 8.6, isp: 316, thrustKN: 27 },
      ],
    },
  },
  {
    id: "ariane-6",
    name: "Ariane 6 (A64)",
    hint: "Europe's heavy launcher, mostly to geostationary transfer orbit.",
    vehicle: {
      payloadT: 11.5,
      refuel: false,
      stages: [
        { name: "Core + 4 boosters", massT: 860, propT: 760, isp: 320, thrustKN: 15000 },
        { name: "Upper stage", massT: 37, propT: 31, isp: 457, thrustKN: 180 },
      ],
    },
  },
  {
    id: "soyuz",
    name: "Soyuz-2",
    hint: "Crews and cargo to the space station since the 1960s family.",
    vehicle: {
      payloadT: 7,
      refuel: false,
      stages: [
        { name: "Boosters + core", massT: 380, propT: 345, isp: 290, thrustKN: 4146 },
        { name: "Third stage", massT: 27.6, propT: 25.4, isp: 359, thrustKN: 298 },
      ],
    },
  },
  {
    id: "electron",
    name: "Electron",
    hint: "Small satellites to low orbit, a few hundred kilograms.",
    vehicle: {
      payloadT: 0.3,
      refuel: false,
      stages: [
        { name: "First stage", massT: 12.5, propT: 11, isp: 311, thrustKN: 224 },
        { name: "Second stage", massT: 2.4, propT: 2.1, isp: 343, thrustKN: 25.8 },
      ],
    },
  },
];

export function presetVehicle(id: string): Vehicle {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  return { preset: p.id, ...structuredClone(p.vehicle) };
}

const G0 = 9.80665;

export interface Capability {
  /** total Δv the stack can deliver with its payload, km/s */
  dv: number;
  perStage: number[];
  /** lift-off thrust / weight on the starting body */
  twr: number;
  liftoffT: number;
}

export function capability(v: Vehicle, surfaceGravity = 9.81): Capability {
  const perStage: number[] = [];
  const stack = (i: number) => v.stages.slice(i).reduce((a, s) => a + s.massT, 0) + v.payloadT;
  v.stages.forEach((s, i) => {
    const m0 = stack(i);
    const m1 = m0 - s.propT;
    let dv = m1 > 0 ? (s.isp * G0 * Math.log(m0 / m1)) / 1000 : 0;
    // A refilled final stage starts again with full tanks in low orbit.
    if (v.refuel && i === v.stages.length - 1) dv *= 2;
    perStage.push(dv);
  });
  const liftoffT = stack(0);
  // boosters and core light together at lift-off when the first two stages are side by side
  const parallel = v.stages.length > 2 && /booster/i.test(v.stages[0].name);
  const thrust = v.stages.length ? v.stages[0].thrustKN + (parallel ? v.stages[1].thrustKN : 0) : 0;
  const twr = (thrust * 1000) / (liftoffT * 1000 * surfaceGravity);
  return { dv: perStage.reduce((a, b) => a + b, 0), perStage, twr, liftoffT };
}
