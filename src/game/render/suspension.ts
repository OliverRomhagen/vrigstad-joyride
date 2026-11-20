// The body's movement on its springs: roll in corners, squat and dive under throttle and brakes, a bounce over
// bumps. Purely visual; the driving model never reads it. Pure data and functions, no three.js.

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

// Keyed by simulation type (TYPES in main.ts).
export const SUSPENSION: Readonly<Record<string, Suspension>> = {
  volvo: {
    freqHz: 1.3,
    damping: 0.6,
    rollPerAcc: 0.0045,
    maxRollRad: 0.07,
    pitchPerAcc: 0.0026,
    maxPitchRad: 0.045,
    heavePerAcc: 0.004,
    maxHeaveM: 0.06,
  },
  saab: {
    freqHz: 1.6,
    damping: 0.7,
    rollPerAcc: 0.0035,
    maxRollRad: 0.055,
    pitchPerAcc: 0.0022,
    maxPitchRad: 0.04,
    heavePerAcc: 0.003,
    maxHeaveM: 0.05,
  },
  epa: {
    freqHz: 1.2,
    damping: 0.5,
    rollPerAcc: 0.005,
    maxRollRad: 0.08,
    pitchPerAcc: 0.003,
    maxPitchRad: 0.05,
    heavePerAcc: 0.005,
    maxHeaveM: 0.07,
  },
  traktor: {
    freqHz: 2.2,
    damping: 0.35,
    rollPerAcc: 0.002,
    maxRollRad: 0.035,
    pitchPerAcc: 0.002,
    maxPitchRad: 0.03,
    heavePerAcc: 0.006,
    maxHeaveM: 0.08,
  },
  polis: {
    freqHz: 1.8,
    damping: 0.75,
    rollPerAcc: 0.003,
    maxRollRad: 0.05,
    pitchPerAcc: 0.002,
    maxPitchRad: 0.035,
    heavePerAcc: 0.0025,
    maxHeaveM: 0.04,
  },
};
// Models that ride differently from the rest of their type.
const MODEL_SUSPENSION: Readonly<Record<string, Partial<Suspension>>> = {
  impala1970: { freqHz: 1.0, damping: 0.45, rollPerAcc: 0.006, maxRollRad: 0.09 }, // a soft American barge
  'micra-k11': { freqHz: 1.9, rollPerAcc: 0.004 }, // short, light and busy
};

export function suspensionFor(type: string, modelId?: string): Suspension {
  const base = SUSPENSION[type] ?? SUSPENSION.volvo;
  const override = modelId ? MODEL_SUSPENSION[modelId] : undefined;
  return override ? { ...base, ...override } : base;
}

/** Spring state per axis: offset and its rate. Plain data, so it can be reset or snapshotted. */
export type BodyState = { roll: number; rollV: number; pitch: number; pitchV: number; heave: number; heaveV: number };
export const restingBody = (): BodyState => ({ roll: 0, rollV: 0, pitch: 0, pitchV: 0, heave: 0, heaveV: 0 });

/** Accelerations the body feels, in m/s²: sideways (+ when turning right), forward, and the ground's upward one. */
export type BodyForces = { lateral: number; longitudinal: number; vertical: number };

const STEP_S = 1 / 120; // substep, so a stiff spring stays stable at a slow frame rate

// A soft limit: linear for small inputs, easing into max, so the body never hits a hard stop.
const soft = (x: number, max: number) => max * Math.tanh(x / max);

/** Advances the springs by dt seconds toward the deflection the forces ask for. Mutates and returns state. */
export function stepBody(state: BodyState, forces: BodyForces, s: Suspension, dt: number): BodyState {
  const w = 2 * Math.PI * s.freqHz,
    k = w * w,
    c = 2 * s.damping * w;
  const roll = soft(forces.lateral * s.rollPerAcc, s.maxRollRad),
    pitch = soft(forces.longitudinal * s.pitchPerAcc, s.maxPitchRad),
    heave = soft(-forces.vertical * s.heavePerAcc, s.maxHeaveM);
  for (let left = dt; left > 1e-6; left -= STEP_S) {
    const h = Math.min(STEP_S, left); // semi-implicit Euler: velocity first, then position
    state.rollV += (k * (roll - state.roll) - c * state.rollV) * h;
    state.roll += state.rollV * h;
    state.pitchV += (k * (pitch - state.pitch) - c * state.pitchV) * h;
    state.pitch += state.pitchV * h;
    state.heaveV += (k * (heave - state.heave) - c * state.heaveV) * h;
    state.heave += state.heaveV * h;
  }
  // Clamp, so a jolt (a wall, a teleport the caller missed) can't flip the body over.
  state.roll = Math.max(-s.maxRollRad * 1.5, Math.min(s.maxRollRad * 1.5, state.roll));
  state.pitch = Math.max(-s.maxPitchRad * 1.5, Math.min(s.maxPitchRad * 1.5, state.pitch));
  state.heave = Math.max(-s.maxHeaveM * 1.5, Math.min(s.maxHeaveM * 1.5, state.heave));
  return state;
}
