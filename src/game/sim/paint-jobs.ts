// Plåt-Pelle's limited paint jobs (#76): colours no car in the village is born with, and decals such as flames. Only his workshop's
// lift sells them: nothing spawns with one, since the fleet picks a new car's paint from its type's own colours (VEHICLE_SPECS cols)
// and gives it no decal. Plain data, no three.js, no DOM; render/paint-decals.ts draws the decals.

/** The decals he paints on, by id. */
const DECALS = { FLAMES: 'flames', STRIPES: 'stripes', RALLY_NUMBER: 'rally-number' } as const;
export type Decal = (typeof DECALS)[keyof typeof DECALS];
export const DECAL_ORDER: readonly Decal[] = [DECALS.FLAMES, DECALS.STRIPES, DECALS.RALLY_NUMBER]; // as his menu lists them

export const DECAL_NAMES: Readonly<Record<Decal, string>> = {
  flames: 'Flammor',
  stripes: 'Rallyränder',
  'rally-number': 'Startnummer 69',
};

/** His special paints, with the names he gives them. None is in any car type's colours. */
export const WORKSHOP_PAINTS: readonly { readonly paint: string; readonly name: string }[] = [
  { paint: '#d4a514', name: 'Guldmetallic' },
  { paint: '#86c440', name: 'Limegrön' },
  { paint: '#6a3a9e', name: 'Discolila' },
  { paint: '#e86fa6', name: 'Tuggummirosa' },
  { paint: '#f2661c', name: 'Vägverksorange' },
];

export const isDecal = (k: string): k is Decal => (DECAL_ORDER as readonly string[]).includes(k);

/** The name of one of his special paints, or undefined for any other paint. */
export const workshopPaintName = (paint: string) => WORKSHOP_PAINTS.find(p => p.paint === paint)?.name;
