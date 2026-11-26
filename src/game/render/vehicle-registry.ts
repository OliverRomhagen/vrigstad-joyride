import type { CarType } from '../sim/vehicle-spec';

// Metres, +Y up, -Z forward; normalized exports share these node names. rearAxle is metres behind the model's centre.
// length is the model's, measured along Z; width is the body's without mirrors, from the car's spec sheet: the hitbox (#201).
export const BODY_NODE = 'body';
export const WHEEL_NODES = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] as const;
export const GLASS_PREFIX = 'glass_';
export const BEACON_PARTS = /^lamp_(blue_module|police_grille)/;
/** Parts the game addresses separately, which compression must keep named. */
export const keepVehiclePart = (name: string) =>
  name === BODY_NODE ||
  name.startsWith(BODY_NODE + '_') ||
  name.startsWith(GLASS_PREFIX) ||
  BEACON_PARTS.test(name) ||
  WHEEL_NODES.some(wheel => wheel === name);

export const VEHICLES = [
  {
    id: 'volvo240',
    spokenName: 'Volvon',
    name: 'Volvo 240',
    archetype: 'volvo',
    url: 'media/vehicles/volvo240.glb',
    radius: 0.315,
    wheelbase: 2.65,
    rearAxle: 1.23,
    length: 4.82,
    width: 1.71,
    police: false,
  },
  {
    id: 'saab900',
    spokenName: 'Saaben',
    name: 'Saab 900 Classic',
    archetype: 'saab',
    url: 'media/vehicles/saab900-t16.glb',
    radius: 0.305,
    wheelbase: 2.517,
    rearAxle: 1.257,
    length: 4.68,
    width: 1.69,
    police: false,
  },
  {
    id: 'xc70',
    spokenName: 'XC70:n',
    name: 'Volvo XC70 P2',
    archetype: 'saab',
    url: 'media/vehicles/xc70-civilian.glb',
    radius: 0.345,
    wheelbase: 2.763,
    rearAxle: 1.393,
    length: 4.74,
    width: 1.86,
    // a tall, heavy estate on the Saab's type: slower to answer, softer and leaning more
    handling: { steerResponseS: 0.14, throttleResponseS: 0.25 },
    suspension: {
      freqHz: 1.25,
      damping: 0.55,
      rollPerAcc: 0.0055,
      maxRollRad: 0.08,
      pitchPerAcc: 0.003,
      maxPitchRad: 0.05,
    },
    police: false,
  },
  {
    id: 'xc70-police',
    spokenName: 'polisbilen',
    name: 'Police XC70 P2',
    archetype: 'polis',
    url: 'media/vehicles/xc70-police.glb',
    radius: 0.345,
    wheelbase: 2.763,
    rearAxle: 1.393,
    length: 4.74,
    width: 1.86,
    police: true,
  },
  {
    id: 'impala1970',
    spokenName: 'Impalan',
    name: 'Chevrolet Impala 1970 hardtop',
    archetype: 'volvo',
    url: 'media/vehicles/impala1970.glb',
    radius: 0.35,
    wheelbase: 3.0226,
    rearAxle: 1.2294,
    length: 5.49,
    width: 2.03,
    suspension: { freqHz: 1.0, damping: 0.45, rollPerAcc: 0.006, maxRollRad: 0.09 }, // a soft American barge
    police: false,
  },
  {
    id: 'micra-k11',
    spokenName: 'Micran',
    name: 'Nissan Micra K11',
    archetype: 'saab',
    url: 'media/vehicles/micra-k11.glb',
    radius: 0.276,
    wheelbase: 2.36,
    rearAxle: 1.2275,
    length: 3.7,
    width: 1.59,
    suspension: { freqHz: 1.9, rollPerAcc: 0.004 }, // short, light and busy
    police: false,
  },
  {
    id: 'duett-epa',
    spokenName: 'Duetten',
    name: 'Volvo Duett P210 EPA',
    archetype: 'epa',
    url: 'media/vehicles/duett-p210-epa.glb',
    radius: 0.335,
    wheelbase: 2.6,
    rearAxle: 1.5,
    length: 4.1,
    width: 1.6,
    police: false,
  },
] as const satisfies readonly (Record<string, unknown> & { archetype: CarType })[];
export type VehicleId = (typeof VEHICLES)[number]['id'];
export const vehicleDefinition = (id: string | null) => VEHICLES.find(v => v.id === id);
/** The kind of car each civilian model is, by id, and the tractor, which has no model of its own: what Skroten buys and sells and `car <model>` spawns. */
export const CIVILIAN_CAR_TYPES: ReadonlyMap<string, CarType> = new Map<string, CarType>([
  ...VEHICLES.filter(v => !v.police).map(v => [v.id, v.archetype] as const),
  ['traktor', 'traktor'],
]);
// The models each simulation type can wear, with relative weights; every model is in the world.
export const VEHICLE_VARIANTS: Readonly<Partial<Record<CarType, readonly (readonly [VehicleId, number])[]>>> = {
  volvo: [
    ['volvo240', 4],
    ['impala1970', 1],
  ],
  saab: [
    ['saab900', 3],
    ['xc70', 2],
    ['micra-k11', 2],
  ],
  epa: [['duett-epa', 1]],
  polis: [['xc70-police', 1]],
};
// roll is in [0, 1); types without a model (the tractor) get none and keep the procedural mesh.
export function pickVariant(type: CarType, roll: number): VehicleId | undefined {
  const variants = VEHICLE_VARIANTS[type];
  if (!variants) return undefined;
  let left = roll * variants.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [id, weight] of variants) {
    left -= weight;
    if (left < 0) return id;
  }
  return variants[variants.length - 1][0];
}
