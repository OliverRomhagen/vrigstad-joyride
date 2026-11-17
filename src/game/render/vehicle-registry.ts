// Metres, +Y up, -Z forward; normalized exports share these node names.
export const BODY_NODE = 'body';
export const WHEEL_NODES = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] as const;
export const VEHICLES = [
  {
    id: 'volvo240',
    spokenName: 'Volvon',
    name: 'Volvo 240',
    archetype: 'volvo',
    url: 'media/vehicles/volvo240.glb',
    radius: 0.315,
    wheelbase: 2.65,
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
    police: false,
  },
] as const;
export type VehicleId = (typeof VEHICLES)[number]['id'];
export const vehicleDefinition = (id: string | null) => VEHICLES.find((v) => v.id === id);
// The models each simulation type can wear, with relative weights; every model is in the world.
export const VEHICLE_VARIANTS: Readonly<Record<string, readonly (readonly [VehicleId, number])[]>> = {
  volvo: [['volvo240', 4], ['impala1970', 1]],
  saab: [['saab900', 3], ['xc70', 2], ['micra-k11', 2]],
  epa: [['duett-epa', 1]],
  polis: [['xc70-police', 1]],
};
// roll is in [0, 1); types without a model (the tractor) get none and keep the procedural mesh.
export function pickVariant(type: string, roll: number): VehicleId | undefined {
  const variants = VEHICLE_VARIANTS[type];
  if (!variants) return undefined;
  let left = roll * variants.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [id, weight] of variants) if ((left -= weight) < 0) return id;
  return variants[variants.length - 1][0];
}
