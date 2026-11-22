// The cars' numbers in the tunables registry (#217): the driving model (DRIVING in cars.ts), the steering lock (STEERING
// in handling.ts) and each car type's speed and response (vehicle-spec.ts). The first slice of #217; other areas follow.
// Pure: no DOM, no three.js.
import { DRIVING } from '../cars';
import { STEERING } from './handling';
import type { TunableSpec, Tunables } from './tunables';
import { type CarType, specsOfType, tuneResponse, VEHICLE_SPECS } from './vehicle-spec';

/** Adds every car number to the registry. */
export function registerCarTunables(t: Tunables): void {
  t.addFields('driving', DRIVING, {
    DRIFT_MIN_V: { name: 'driftStartSpeed', unit: 'm/s', min: 0, max: 30, help: 'the speed a drift can start at' },
    DRIFT_KEEP_V: {
      name: 'driftKeepSpeed',
      unit: 'm/s',
      min: 0,
      max: 30,
      help: 'below this speed a drift fizzles out',
    },
    GRIP: { name: 'grip', unit: '1/s', min: 0.5, max: 50, help: 'how fast the line of travel follows the nose' },
    DRIFT_GRIP: { name: 'driftGrip', unit: '1/s', min: 0.1, max: 20, help: 'the same, in a drift' },
    DRIFT_YAW: { name: 'driftYaw', unit: '×', min: 0.5, max: 4, help: 'how much faster the nose turns in a drift' },
    DRIFT_MAX_SLIP: {
      name: 'driftMaxSlip',
      unit: 'rad',
      min: 0.1,
      max: 1.5,
      help: 'the most the nose points off the line',
    },
    DRIFT_DRAG: { name: 'driftDrag', unit: 'm/s²', min: 0, max: 20, help: 'speed lost to sideways scrub' },
    DRIFT_THR: { name: 'driftThrottle', unit: 'share', min: 0, max: 1, help: 'of the acceleration left in a slide' },
    BRAKE_MS2: { name: 'brake', unit: 'm/s²', min: 1, max: 60, help: 'braking' },
    COUNTER_MS2: { name: 'counterBrake', unit: 'm/s²', min: 1, max: 60, help: 'reverse or throttle against the roll' },
    RECOVER_S: { name: 'gripRecovery', unit: 's', min: 0.1, max: 5, help: 'for the grip to come back after a drift' },
    SPIN_DECAY: {
      name: 'spinDecay',
      unit: '1/s',
      min: 0,
      max: 20,
      help: 'fade of the yaw the nose carries out of a slide',
    },
    FLICK_LOOSE: {
      name: 'flickLoose',
      unit: 's',
      min: 0,
      max: 2,
      help: 'looseness each quick left-right reversal adds',
    },
    FLICK_S: {
      name: 'flickWindow',
      unit: 's',
      min: 0.1,
      max: 2,
      help: 'how far apart a reversal still counts as quick',
    },
    FLICK_LOAD_S: {
      name: 'flickLoad',
      unit: 's',
      min: 0,
      max: 2,
      help: 'how long to hold the first direction of a flick',
    },
    FLICK_SPIN: { name: 'flickSpin', unit: 'rad/s', min: 0, max: 6, help: "the rear's swing at full looseness" },
    CATCH: {
      name: 'counterSteerCatch',
      unit: 'share',
      min: 0,
      max: 1,
      help: 'of the grip that counter-steer turns the nose back',
    },
    TURBO_ACC: { name: 'turboAcceleration', unit: 'm/s²', min: 0, max: 60, help: 'the mini-turbo push' },
    TURBO_TOP: { name: 'turboTopSpeed', unit: '×', min: 1, max: 3, help: 'top speed while the mini-turbo lasts' },
  });
  t.addFields('steering', STEERING, {
    MAX_LOCK_RAD: {
      name: 'maxLock',
      unit: 'rad',
      min: 0.1,
      max: 1.2,
      help: 'front-wheel angle at full stick, standing still',
    },
    LOCK_FADE_MS: {
      name: 'lockFadeSpeed',
      unit: 'm/s',
      min: 1,
      max: 60,
      help: 'the speed at which the lock has halved',
    },
  });
  for (const type of Object.keys(VEHICLE_SPECS) as CarType[]) registerType(t, type);
}

const SPEC: Record<'max' | 'acc' | 'off', TunableSpec & { name: string }> = {
  max: { name: 'topSpeed', unit: 'm/s', min: 1, max: 80, help: 'top speed on a road' },
  acc: { name: 'acceleration', unit: 'm/s²', min: 0.5, max: 30, help: 'acceleration from standstill' },
  off: { name: 'offRoad', unit: 'share', min: 0.05, max: 1, help: 'of the top speed off the road' },
};
const RESPONSE: Record<'steerResponseS' | 'throttleResponseS', TunableSpec & { name: string }> = {
  steerResponseS: { name: 'steerResponse', unit: 's', min: 0, max: 1, help: 'for the steering to follow the stick' },
  throttleResponseS: {
    name: 'throttleResponse',
    unit: 's',
    min: 0,
    max: 2,
    help: 'for the throttle to follow the pedal',
  },
};

// Each number is written to every spec of the type (specsOfType, tuneResponse), so it reaches cars already driving and
// every model. A model may bring its own response times: the type's default means "not tuned", so setting it, or a reset,
// gives each model its own back.
function registerType(t: Tunables, type: CarType): void {
  const base = VEHICLE_SPECS[type];
  for (const field of Object.keys(SPEC) as (keyof typeof SPEC)[]) {
    const { name, ...spec } = SPEC[field];
    t.add(
      `vehicle.${type}.${name}`,
      spec,
      () => base[field],
      v => {
        for (const s of specsOfType(type)) s[field] = v; // no model changes these
      },
    );
  }
  for (const field of Object.keys(RESPONSE) as (keyof typeof RESPONSE)[]) {
    const { name, ...spec } = RESPONSE[field];
    const defaultValue = base.handling[field];
    t.add(
      `vehicle.${type}.${name}`,
      spec,
      () => base.handling[field],
      v => tuneResponse(type, field, v === defaultValue ? undefined : v, defaultValue),
    );
  }
}
