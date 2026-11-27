// The cars' numbers in the tunables registry (#217): the driving model (DRIVING in cars.ts), the steering lock (STEERING
// in handling.ts), each car type's speed and response (vehicle-spec.ts) and Plåt-Pelle's upgrades (upgrades.ts). The first slice of #217; other areas follow.
// Pure: no DOM, no three.js.
import { DRIVING } from '../cars';
import { STEERING } from './handling';
import type { TunableSpec, Tunables } from './tunables';
import { UPGRADES } from './upgrades';
import { type CarType, specsOfType, tuneResponse, VEHICLE_SPECS } from './vehicle-spec';

/** Adds every car number to the registry. */
export function registerCarTunables(t: Tunables): void {
  t.addFields('driving', DRIVING, {
    DRIFT_MIN_V: { name: 'drift-start-speed', unit: 'm/s', min: 0, max: 30, help: 'the speed a drift can start at' },
    DRIFT_KEEP_V: {
      name: 'drift-keep-speed',
      unit: 'm/s',
      min: 0,
      max: 30,
      help: 'below this speed a drift fizzles out',
    },
    GRIP: { name: 'grip', unit: '1/s', min: 0.5, max: 50, help: 'how fast the line of travel follows the nose' },
    DRIFT_GRIP: { name: 'drift-grip', unit: '1/s', min: 0.1, max: 20, help: 'the same, in a drift' },
    DRIFT_YAW: { name: 'drift-yaw', unit: '×', min: 0.5, max: 4, help: 'how much faster the nose turns in a drift' },
    DRIFT_MAX_SLIP: {
      name: 'drift-max-slip',
      unit: 'rad',
      min: 0.1,
      max: 1.5,
      help: 'the most the nose points off the line',
    },
    DRIFT_DRAG: { name: 'drift-drag', unit: 'm/s²', min: 0, max: 20, help: 'speed lost to sideways scrub' },
    DRIFT_THR: { name: 'drift-throttle', unit: 'share', min: 0, max: 1, help: 'of the acceleration left in a slide' },
    BRAKE_MS2: { name: 'brake', unit: 'm/s²', min: 1, max: 60, help: 'braking' },
    COUNTER_MS2: { name: 'counter-brake', unit: 'm/s²', min: 1, max: 60, help: 'reverse or throttle against the roll' },
    RECOVER_S: { name: 'grip-recovery', unit: 's', min: 0.1, max: 5, help: 'for the grip to come back after a drift' },
    SPIN_DECAY: {
      name: 'spin-decay',
      unit: '1/s',
      min: 0,
      max: 20,
      help: 'fade of the yaw the nose carries out of a slide',
    },
    FLICK_LOOSE: {
      name: 'flick-loose',
      unit: 's',
      min: 0,
      max: 2,
      help: 'looseness each quick left-right reversal adds',
    },
    FLICK_S: {
      name: 'flick-window',
      unit: 's',
      min: 0.1,
      max: 2,
      help: 'how far apart a reversal still counts as quick',
    },
    FLICK_LOAD_S: {
      name: 'flick-load',
      unit: 's',
      min: 0,
      max: 2,
      help: 'how long to hold the first direction of a flick',
    },
    FLICK_SPIN: { name: 'flick-spin', unit: 'rad/s', min: 0, max: 6, help: "the rear's swing at full looseness" },
    CATCH: {
      name: 'counter-steer-catch',
      unit: 'share',
      min: 0,
      max: 1,
      help: 'of the grip that counter-steer turns the nose back',
    },
    TURBO_ACC: { name: 'turbo-acceleration', unit: 'm/s²', min: 0, max: 60, help: 'the mini-turbo push' },
    TURBO_TOP: { name: 'turbo-top-speed', unit: '×', min: 1, max: 3, help: 'top speed while the mini-turbo lasts' },
    FLAT_PULL: {
      name: 'flat-pull',
      unit: 'share',
      min: 0,
      max: 1,
      help: 'of full lock a flat tyre steers towards its side',
    },
    FLAT_TOP: { name: 'flat-top-speed', unit: '×', min: 0.1, max: 1, help: 'top speed with a flat tyre' },
  });
  t.addFields('steering', STEERING, {
    MAX_LOCK_RAD: {
      name: 'max-lock',
      unit: 'rad',
      min: 0.1,
      max: 1.2,
      help: 'front-wheel angle at full stick, standing still',
    },
    LOCK_FADE_MS: {
      name: 'lock-fade-speed',
      unit: 'm/s',
      min: 1,
      max: 60,
      help: 'the speed at which the lock has halved',
    },
  });
  t.addFields('upgrade', UPGRADES, {
    ENGINE_TOP: { name: 'engine-top-speed', unit: '×', min: 1, max: 2, help: "a tuned engine's top speed" },
    ENGINE_ACC: { name: 'engine-acceleration', unit: '×', min: 1, max: 3, help: "a tuned engine's acceleration" },
    SPRINGS_GRIP: { name: 'springs-grip', unit: '×', min: 1, max: 3, help: 'grip on sport springs' },
    SPRINGS_STEER: {
      name: 'springs-steer-response',
      unit: '×',
      min: 0.1,
      max: 1,
      help: 'of the steering response time on sport springs',
    },
    EPA_TOP_MS: { name: 'epa-top-speed', unit: 'm/s', min: 8.33, max: 40, help: "a tuned EPA-traktor's top speed" },
    BODY_DAMAGE: {
      name: 'body-damage',
      unit: 'share',
      min: 0,
      max: 1,
      help: 'of the crash damage a reinforced body takes',
    },
  });
  for (const type of Object.keys(VEHICLE_SPECS) as CarType[]) registerType(t, type);
}

const SPEC: Record<'max' | 'acc' | 'off', TunableSpec & { name: string }> = {
  max: { name: 'top-speed', unit: 'm/s', min: 1, max: 80, help: 'top speed on a road' },
  acc: { name: 'acceleration', unit: 'm/s²', min: 0.5, max: 30, help: 'acceleration from standstill' },
  off: { name: 'off-road', unit: 'share', min: 0.05, max: 1, help: 'of the top speed off the road' },
};
const RESPONSE: Record<'steerResponseS' | 'throttleResponseS', TunableSpec & { name: string }> = {
  steerResponseS: { name: 'steer-response', unit: 's', min: 0, max: 1, help: 'for the steering to follow the stick' },
  throttleResponseS: {
    name: 'throttle-response',
    unit: 's',
    min: 0,
    max: 2,
    help: 'for the throttle to follow the pedal',
  },
};

// Each number is written to every spec of the type (specsOfType, tuneResponse), so it reaches cars already driving and
// every model. A model may bring its own response times: a set value, even the type's default, wins over them, and only a
// reset gives each model its own back.
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
      v => tuneResponse(type, field, v, defaultValue),
      () => tuneResponse(type, field, undefined, defaultValue),
    );
  }
}
