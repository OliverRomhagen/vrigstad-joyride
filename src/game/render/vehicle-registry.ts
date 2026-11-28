import type { CarType } from '../sim/vehicle-spec';

// Metres, +Y up, -Z forward; normalized exports share these node names. rearAxle is metres behind the model's centre.
// length is the model's, measured along Z; width is the body's without mirrors, from the car's spec sheet: the hitbox (#201).
// bodyAhead is how far the middle of the model's length lies ahead of its origin (toward -Z), where the wheels sit off it.
// height is the roof's, from the spec sheet too: what you stand on up there (#451). roofRear and roofFront are where the roof
// runs, in m ahead of the model's centre, measured on its mesh (the top of the body along the middle, to 0.1 m).
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

/**
 * A model's lamps by what they show (#304): the names of its lamp meshes, each one material. Housings, reflectors and
 * the dark red outer tail lenses stay unlit. A model without reversing lamps or indicators shows no reversing lights or
 * hazards. tests/unit/vehicles/assets.test.ts checks every name against the model.
 */
export type VehicleLamps = {
  head: readonly string[];
  rear: readonly string[];
  reverse?: readonly string[];
  hazard?: readonly string[];
};
const XC70_LAMPS: VehicleLamps = {
  head: ['parts_headlamp_ivory'],
  rear: ['parts_tail_lamp_red'],
  reverse: ['parts_reverse_lamp_clear'],
  hazard: ['parts_indicator_amber'],
};

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
    height: 1.46,
    roofRear: -1.0,
    roofFront: 0.45,
    lamps: {
      head: ['lamp_front_lenses'],
      rear: ['lamp_rear_red', 'lamp_rear_ribs'],
      reverse: ['lamp_rear_reverse'],
      hazard: ['lamp_indicators'],
    },
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
    length: 4.688,
    width: 1.69,
    height: 1.42,
    roofRear: -1.0,
    roofFront: 0.5,
    lamps: { head: ['round3_headlamp_ivory'], rear: ['round3_tail_lamp_red'], hazard: ['round3_indicator_amber'] },
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
    length: 4.72,
    bodyAhead: -0.058,
    width: 1.86,
    height: 1.56,
    roofRear: -2.2,
    roofFront: 0.3, // the redrawn body's roof reaches further forward (#471)
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
    lamps: XC70_LAMPS,
    coolHead: true, // a newer car's whiter headlamps
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
    length: 4.905,
    bodyAhead: 0.0347, // its bull bar
    width: 1.86,
    height: 1.56,
    roofRear: -2.2,
    roofFront: 0.3, // the redrawn body's roof reaches further forward (#471)
    lamps: XC70_LAMPS,
    coolHead: true, // a newer car's whiter headlamps
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
    height: 1.39,
    roofRear: -1.1,
    roofFront: 0.75,
    suspension: { freqHz: 1.0, damping: 0.45, rollPerAcc: 0.006, maxRollRad: 0.09 }, // a soft American barge
    lamps: {
      head: ['lamp_headlights'],
      rear: ['lamp_taillights'],
      reverse: ['lamp_reverse_units'],
      hazard: ['lamp_parking'],
    },
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
    height: 1.42,
    roofRear: -1.3,
    roofFront: 0.05,
    suspension: { freqHz: 1.9, rollPerAcc: 0.004 }, // short, light and busy
    lamps: { head: ['lamp_headlights'], rear: ['lamp_taillights_red'], hazard: ['parts_amber_indicators'] },
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
    bodyAhead: -0.2575,
    width: 1.6,
    height: 1.55,
    roofRear: -0.85,
    roofFront: 0.2,
    lamps: { head: ['lamp_headlamp'], rear: ['parts_tail_red'], hazard: ['lamp_indicator'] },
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
