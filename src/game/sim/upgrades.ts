// Plåt-Pelle's upgrades on the workshop's lift (#76): what each one does to a car, as plain data and pure rules (no three.js, no DOM).
// A car carries the ones it has in `mods`; drive() and crashCars read them through these helpers. Skroten sells them; a respray only
// changes the car's `color`, so it isn't one of these.
import { VEHICLE_SPECS } from './vehicle-spec';

/** The upgrades a car has. Each is bought once, for that car only. */
export interface CarMods {
  engine: boolean; // a tuned engine: faster, and quicker off the mark
  springs: boolean; // sport springs: the line follows the nose sooner, and the steering answers sooner
  body: boolean; // a reinforced body: crashes do less damage
}
export type Upgrade = keyof CarMods;

export const UPGRADE_ORDER: readonly Upgrade[] = ['engine', 'springs', 'body']; // as the lift's menu lists them

export const noMods = (): CarMods => ({ engine: false, springs: false, body: false });

// What each upgrade does, in one object so the tunables registry can change it (car-tunables.ts holds the units and ranges).
export const UPGRADES = {
  ENGINE_TOP: 1.15, // enough to feel on Växjövägen; the police still catch a tuned Volvo in the bends
  ENGINE_ACC: 1.3, // more than the top speed's gain: in the village you feel the pull out of every junction, long before the top speed
  SPRINGS_GRIP: 1.4, // enough to feel in the first bend; well short of a doubling, which would hold a car like rails
  SPRINGS_STEER: 0.7, // with the grip: a car that grips more but turns in as late would feel the same
  BODY_DAMAGE: 0.5, // half: twice the crashes before it's wrecked (eight at ~70 km/h instead of four)
  EPA_TOP_MS: 13.9, // a tuned EPA-traktor's top speed with its limiter on: 50 km/h; the switch gives it a Volvo's
};

type Driven = {
  type: string;
  mods: CarMods;
  limiterOff: boolean;
  T: { max: number; acc: number; handling: { steerResponseS: number } };
};

/** A tuned EPA-traktor: it has the switch under the wheel that takes its limiter off. */
export const hasLimiterSwitch = (c: Pick<Driven, 'type' | 'mods'>) => c.type === 'epa' && c.mods.engine;

/** The car's top speed on a road (m/s), with its engine; a tuned EPA with its limiter off keeps up with a Volvo. */
export function topSpeedOf(c: Driven) {
  if (hasLimiterSwitch(c)) return c.limiterOff ? VEHICLE_SPECS.volvo.max : Math.max(c.T.max, UPGRADES.EPA_TOP_MS);
  return c.T.max * (c.mods.engine ? UPGRADES.ENGINE_TOP : 1);
}
/** The car's acceleration from standstill (m/s²), with its engine. */
export function accelOf(c: Driven) {
  if (hasLimiterSwitch(c) && c.limiterOff) return VEHICLE_SPECS.volvo.acc;
  return c.T.acc * (c.mods.engine ? UPGRADES.ENGINE_ACC : 1);
}

/** T, or the touch Limiter button: flips a tuned EPA's limiter switch. What you say when it clicks; null for any other car. */
export function flipLimiter(c: (Pick<Driven, 'type' | 'mods'> & { limiterOff: boolean }) | null): string | null {
  if (!c || !hasLimiterSwitch(c)) return null;
  c.limiterOff = !c.limiterOff;
  return c.limiterOff ? '”Klick. Nu ä dä ingen EPA längre.”' : '”Klick. Snäll EPA igen.”';
}
/** How long the car's steering takes to follow the stick (s), with its springs. */
export const steerResponseOf = (c: Driven) =>
  c.T.handling.steerResponseS * (c.mods.springs ? UPGRADES.SPRINGS_STEER : 1);
/** The share of the grip the car has, with its springs. */
export const gripShare = (mods: CarMods) => (mods.springs ? UPGRADES.SPRINGS_GRIP : 1);
/** The share of a crash's damage the car takes, with its body. */
export const damageShare = (mods: CarMods) => (mods.body ? UPGRADES.BODY_DAMAGE : 1);
