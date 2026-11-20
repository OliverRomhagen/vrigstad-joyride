// How a car answers the controls: its steering geometry and how quickly speed and heading follow the input.
// Pure data and functions, no three.js: drive() in src/game/main.ts reads them. Each type's numbers are in vehicle-spec.ts.

export type Handling = {
  /** Distance between the axles, in metres; a longer car turns wider for the same steering input. */
  wheelbaseM: number;
  /** How far the rear axle sits behind the car's centre, in metres: the car turns about it while gripping. */
  rearAxleM: number;
  /** Seconds for the steering to cover ~63% of the way to the stick; heavier cars answer later. */
  steerResponseS: number;
  /** Seconds for the throttle to cover ~63% of the way to the pedal. */
  throttleResponseS: number;
};

const MAX_LOCK_RAD = 0.6; // front-wheel angle at full stick, standing still
const LOCK_FADE_MS = 13; // m/s at which the lock has halved; it fades with speed squared, so a fast car's small correction stays small

/** Yaw rate in rad/s of a car at speed v (m/s) with the stick at steer (−1..1), from the bicycle model. */
export function yawRate(v: number, steer: number, wheelbaseM: number): number {
  return (v / wheelbaseM) * Math.tan((steer * MAX_LOCK_RAD) / (1 + (v / LOCK_FADE_MS) ** 2));
}

/** Moves current toward target as a first-order lag with time constant responseS; frame-rate independent. */
export function approach(current: number, target: number, responseS: number, dt: number): number {
  return responseS > 0 ? current + (target - current) * (1 - Math.exp(-dt / responseS)) : target;
}

/**
 * How far the car's centre moves when its heading turns from hOld to hNew around the rear axle, which sits
 * rearAxleM behind the centre. Only the front wheels steer, so the rear ones roll straight and the car turns
 * about a point on the rear axle's line. Heading 0 faces −z; x east, z south. Writes into out (called every frame).
 */
export function rearPivotShift(hOld: number, hNew: number, rearAxleM: number, out: { dx: number; dz: number }) {
  out.dx = (Math.sin(hNew) - Math.sin(hOld)) * rearAxleM;
  out.dz = -(Math.cos(hNew) - Math.cos(hOld)) * rearAxleM;
  return out;
}
