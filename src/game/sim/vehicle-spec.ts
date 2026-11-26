// Everything that sets one car type apart, in one table: speed, handling, springs and paint. A model in
// render/vehicle-registry.ts can override parts of it. Pure data and functions, no three.js.
import type { Handling } from './handling';

export type CarType = 'volvo' | 'saab' | 'epa' | 'traktor' | 'polis';

export type Suspension = {
  /** Natural frequency of the springs in Hz; lower is softer and floatier. */
  freqHz: number;
  /** Damping ratio: 1 settles without overshoot, lower rocks a little before settling. */
  damping: number;
  /** Radians of roll per m/s² of sideways acceleration, and the most roll the body reaches. */
  rollPerAcc: number;
  maxRollRad: number;
  /** Radians of pitch per m/s² of forward acceleration (nose up when accelerating), and the most pitch. */
  pitchPerAcc: number;
  maxPitchRad: number;
  /** Metres the body sinks per m/s² of upward ground acceleration, and the most it moves either way. */
  heavePerAcc: number;
  maxHeaveM: number;
};

export type VehicleSpec = {
  name: string;
  /** Top speed on a road, m/s. */
  max: number;
  /** Acceleration from standstill, m/s². */
  acc: number;
  /** Share of the top speed off the road. */
  off: number;
  /** Paint colours a car of this type is picked from. */
  cols: readonly string[];
  /** The body's length and width (m, no mirrors): its hitbox (sim/car-body.ts). */
  lengthM: number;
  widthM: number;
  handling: Handling;
  /** How the body moves on its springs; only rendering reads it. */
  suspension: Suspension;
};

// Wheelbase and rear axle are where the procedural model draws its wheels, and length and width its body (render/models.ts;
// the tractor's from its rear wheels to its bonnet); a GLB model brings its own measured ones.
// Response times: the civilian cars answer a little late, so they feel some weight; the police stay sharp for the chase.
// The tunables registry (car-tunables.ts) changes the numbers in each spec while the game runs; a type's spec is never replaced.
export const VEHICLE_SPECS: Readonly<Record<CarType, VehicleSpec>> = {
  volvo: {
    name: 'Volvo 240',
    max: 38,
    acc: 7,
    off: 0.5,
    cols: ['#27406b', '#7a2530', '#c9bd9c', '#e6e4dc', '#2f5a41', '#8a8f93'],
    lengthM: 4.8,
    widthM: 1.74,
    handling: { wheelbaseM: 2.95, rearAxleM: 1.45, steerResponseS: 0.13, throttleResponseS: 0.25 },
    suspension: {
      freqHz: 1.3,
      damping: 0.6,
      rollPerAcc: 0.0045,
      maxRollRad: 0.07,
      pitchPerAcc: 0.0026,
      maxPitchRad: 0.045,
      heavePerAcc: 0.004,
      maxHeaveM: 0.06,
    },
  },
  saab: {
    name: 'Saab 900',
    max: 42,
    acc: 8.5,
    off: 0.5,
    cols: ['#1d1d1f', '#8c1c1c', '#3d5a80', '#d8d4c8', '#55606a'],
    lengthM: 4.6,
    widthM: 1.7,
    handling: { wheelbaseM: 2.8, rearAxleM: 1.35, steerResponseS: 0.1, throttleResponseS: 0.18 },
    suspension: {
      freqHz: 1.6,
      damping: 0.7,
      rollPerAcc: 0.0035,
      maxRollRad: 0.055,
      pitchPerAcc: 0.0022,
      maxPitchRad: 0.04,
      heavePerAcc: 0.003,
      maxHeaveM: 0.05,
    },
  },
  epa: {
    name: 'EPA-traktor',
    max: 8.33,
    acc: 4,
    off: 0.7,
    cols: ['#c8372d', '#2a2a2c', '#e8a020', '#3f6b8a'],
    lengthM: 4.8,
    widthM: 1.74,
    handling: { wheelbaseM: 2.9, rearAxleM: 1.4, steerResponseS: 0.16, throttleResponseS: 0.37 },
    suspension: {
      freqHz: 1.2,
      damping: 0.5,
      rollPerAcc: 0.005,
      maxRollRad: 0.08,
      pitchPerAcc: 0.003,
      maxPitchRad: 0.05,
      heavePerAcc: 0.005,
      maxHeaveM: 0.07,
    },
  },
  traktor: {
    name: 'Traktor',
    max: 11,
    acc: 3.5,
    off: 1,
    cols: ['#2f7a3a', '#b5302a', '#2a5fa0'],
    lengthM: 3.8,
    widthM: 1.9,
    handling: { wheelbaseM: 2.4, rearAxleM: 0.9, steerResponseS: 0.26, throttleResponseS: 0.5 },
    suspension: {
      freqHz: 2.2,
      damping: 0.35,
      rollPerAcc: 0.002,
      maxRollRad: 0.035,
      pitchPerAcc: 0.002,
      maxPitchRad: 0.03,
      heavePerAcc: 0.006,
      maxHeaveM: 0.08,
    },
  },
  polis: {
    name: 'Polisbil',
    max: 35,
    acc: 9,
    off: 0.6,
    cols: ['#f1f1ee'],
    lengthM: 4.8,
    widthM: 1.74,
    handling: { wheelbaseM: 2.95, rearAxleM: 1.45, steerResponseS: 0.08, throttleResponseS: 0.14 },
    suspension: {
      freqHz: 1.8,
      damping: 0.75,
      rollPerAcc: 0.003,
      maxRollRad: 0.05,
      pitchPerAcc: 0.002,
      maxPitchRad: 0.035,
      heavePerAcc: 0.0025,
      maxHeaveM: 0.04,
    },
  },
};

/** What a model can change about its type: its measured axles and body in metres, how it answers the controls and how it rides. */
export type ModelOverrides = {
  wheelbase?: number;
  rearAxle?: number;
  length?: number;
  width?: number;
  handling?: Partial<Pick<Handling, 'steerResponseS' | 'throttleResponseS'>>;
  suspension?: Partial<Suspension>;
};

// one spec per type and model, made the first time it's asked for, so cars that share both share one object, and a
// tuned number reaches every car of the type (specsOfType, tuneResponse). Models come from the fixed table in
// render/vehicle-registry.ts, so this holds at most one copy per model, and a lookup walks a handful.
const copies = new Map<CarType, { spec: VehicleSpec; model: ModelOverrides }[]>();

type Response = Pick<Handling, 'steerResponseS' | 'throttleResponseS'>;
// response times tuned for a whole type: they win over a model's own, in copies made before the tune and after it
const tunedResponse: Partial<Record<CarType, Partial<Response>>> = {};

/** The spec for a car of this type wearing this model. Throws on an unknown type, so a typo can't drive like a Volvo. */
export function specFor(type: CarType, model?: ModelOverrides): VehicleSpec {
  const base = VEHICLE_SPECS[type];
  if (!base) throw new Error(`unknown car type: ${type}`);
  if (
    !model?.wheelbase &&
    !model?.rearAxle &&
    !model?.length &&
    !model?.width &&
    !model?.handling &&
    !model?.suspension
  )
    return base;
  const ofType = copies.get(type) ?? [];
  const known = ofType.find(c => c.model === model);
  if (known) return known.spec;
  const spec = mergeModel(type, base, model);
  ofType.push({ spec, model });
  copies.set(type, ofType);
  return spec;
}

/** Every spec of this type in use: the table's own, and the copy made for each model that changes it. */
export function specsOfType(type: CarType): readonly VehicleSpec[] {
  return [VEHICLE_SPECS[type], ...(copies.get(type) ?? []).map(c => c.spec)];
}

/**
 * Sets a response time for every car of the type, whatever its model, now and for copies made later; undefined takes
 * the tune away, so each model gets its own back and the table gets `typeDefault`.
 */
export function tuneResponse(type: CarType, field: keyof Response, value: number | undefined, typeDefault: number) {
  const tuned = tunedResponse[type] ?? {};
  tunedResponse[type] = tuned;
  if (value === undefined) delete tuned[field];
  else tuned[field] = value;
  VEHICLE_SPECS[type].handling[field] = value ?? typeDefault;
  for (const { spec, model } of copies.get(type) ?? [])
    spec.handling[field] = value ?? model.handling?.[field] ?? typeDefault;
}

function mergeModel(type: CarType, base: VehicleSpec, model: ModelOverrides): VehicleSpec {
  return {
    ...base,
    lengthM: model.length ?? base.lengthM,
    widthM: model.width ?? base.widthM,
    handling: {
      ...base.handling,
      ...model.handling,
      ...tunedResponse[type],
      wheelbaseM: model.wheelbase ?? base.handling.wheelbaseM,
      rearAxleM: model.rearAxle ?? base.handling.rearAxleM,
    },
    suspension: { ...base.suspension, ...model.suspension },
  };
}
