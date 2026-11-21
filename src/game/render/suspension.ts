// The body's movement on its springs: roll in corners, squat and dive under throttle and brakes, a bounce over
// bumps. Purely visual; the driving model never reads it. Pure data and functions, no three.js.
// Each type's spring settings are in sim/vehicle-spec.ts.
import { clamp } from '../../world/math';
import type { Suspension } from '../sim/vehicle-spec';

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
  state.roll = clamp(state.roll, -s.maxRollRad * 1.5, s.maxRollRad * 1.5);
  state.pitch = clamp(state.pitch, -s.maxPitchRad * 1.5, s.maxPitchRad * 1.5);
  state.heave = clamp(state.heave, -s.maxHeaveM * 1.5, s.maxHeaveM * 1.5);
  return state;
}
