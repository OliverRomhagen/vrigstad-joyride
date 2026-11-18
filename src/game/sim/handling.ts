// How a car type answers the controls: its steering geometry and how quickly speed and heading follow the input.
// Pure data and functions, no three.js: drive() in src/game/main.ts reads them.

export type Handling = {
  /** Distance between the axles, in metres; a longer car turns wider for the same steering input. */
  wheelbaseM: number;
  /** Seconds for the steering to cover ~63% of the way to the stick; heavier cars answer later. */
  steerResponseS: number;
  /** Seconds for the throttle to cover ~63% of the way to the pedal. */
  throttleResponseS: number;
};

// Keyed by simulation type (TYPES in main.ts). The wheelbase is the procedural model's; a GLB model passes its own.
export const HANDLING: Readonly<Record<string, Handling>> = {
  volvo: { wheelbaseM: 2.65, steerResponseS: 0.12, throttleResponseS: 0.22 },
  saab: { wheelbaseM: 2.52, steerResponseS: 0.09, throttleResponseS: 0.16 },
  epa: { wheelbaseM: 2.6, steerResponseS: 0.15, throttleResponseS: 0.35 },
  traktor: { wheelbaseM: 2.4, steerResponseS: 0.24, throttleResponseS: 0.5 },
  polis: { wheelbaseM: 2.76, steerResponseS: 0.08, throttleResponseS: 0.14 },
};
const DEFAULT_HANDLING = HANDLING.volvo;

export function handlingFor(type: string, wheelbaseM?: number): Handling {
  const base = HANDLING[type] ?? DEFAULT_HANDLING;
  return wheelbaseM ? { ...base, wheelbaseM } : base;
}

const MAX_LOCK_RAD = 0.6; // front-wheel angle at full stick, standing still
const LOCK_FADE_MS = 11; // m/s at which the lock has halved, so fast cars don't snap round

/** Yaw rate in rad/s of a car at speed v (m/s) with the stick at steer (−1..1), from the bicycle model. */
export function yawRate(v: number, steer: number, wheelbaseM: number): number {
  return (v / wheelbaseM) * Math.tan((steer * MAX_LOCK_RAD) / (1 + Math.abs(v) / LOCK_FADE_MS));
}

/** Moves current toward target as a first-order lag with time constant responseS; frame-rate independent. */
export function approach(current: number, target: number, responseS: number, dt: number): number {
  return responseS > 0 ? current + (target - current) * (1 - Math.exp(-dt / responseS)) : target;
}

/**
 * How far the car's centre moves when its heading turns from hOld to hNew around the rear axle, which sits
 * half a wheelbase behind the centre. Heading 0 faces −z; x east, z south.
 */
export function rearPivotShift(hOld: number, hNew: number, wheelbaseM: number) {
  const half = wheelbaseM / 2;
  return { dx: (Math.sin(hNew) - Math.sin(hOld)) * half, dz: -(Math.cos(hNew) - Math.cos(hOld)) * half };
}
