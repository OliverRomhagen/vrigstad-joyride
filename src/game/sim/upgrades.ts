// Plåt-Pelle's upgrades on the workshop's lift (#76): what each one does to a car, as plain data and pure rules (no three.js, no DOM).
// A car carries the ones it has in `mods`; drive() and crashCars read them through these helpers. Skroten sells them; a respray only
// changes the car's `color`, so it isn't one of these.

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
  ENGINE_ACC: 1.3,
  SPRINGS_GRIP: 1.4,
  SPRINGS_STEER: 0.7, // a share of the steering's response time: lower answers sooner
  BODY_DAMAGE: 0.5,
};

type Driven = { mods: CarMods; T: { max: number; acc: number; handling: { steerResponseS: number } } };

/** The car's top speed on a road (m/s), with its engine. */
export const topSpeedOf = (c: Driven) => c.T.max * (c.mods.engine ? UPGRADES.ENGINE_TOP : 1);
/** The car's acceleration from standstill (m/s²), with its engine. */
export const accelOf = (c: Driven) => c.T.acc * (c.mods.engine ? UPGRADES.ENGINE_ACC : 1);
/** How long the car's steering takes to follow the stick (s), with its springs. */
export const steerResponseOf = (c: Driven) =>
  c.T.handling.steerResponseS * (c.mods.springs ? UPGRADES.SPRINGS_STEER : 1);
/** The share of the grip the car has, with its springs. */
export const gripShare = (mods: CarMods) => (mods.springs ? UPGRADES.SPRINGS_GRIP : 1);
/** The share of a crash's damage the car takes, with its body; a car without mods (a test's stub) takes all of it. */
export const damageShare = (mods: CarMods | undefined) => (mods?.body ? UPGRADES.BODY_DAMAGE : 1);
