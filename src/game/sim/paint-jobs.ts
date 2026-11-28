// Plåt-Pelle's limited paint jobs (#76): colours no car in the village is born with, and decals such as flames. Only his workshop's
// lift sells them: nothing spawns with one, since the fleet picks a new car's paint from its type's own colours (VEHICLE_SPECS cols)
// or, on his lot, from the yard's (skroten-yard.ts), and gives it no decal. Plain data, no three.js, no DOM; render/paint-decals.ts draws the decals.

/** The decals he paints on, by id. */
export const DECALS = { FLAMES: 'flames', STRIPES: 'stripes', RALLY_NUMBER: 'rally-number' } as const;
export type Decal = (typeof DECALS)[keyof typeof DECALS];
export const DECAL_ORDER: readonly Decal[] = [DECALS.FLAMES, DECALS.STRIPES, DECALS.RALLY_NUMBER]; // as his menu lists them

/** The number he paints on the doors, and names on the menu. */
export const RALLY_NUMBER = '69';

export const DECAL_NAMES: Readonly<Record<Decal, string>> = {
  flames: 'Flammor',
  stripes: 'Rallyränder',
  'rally-number': 'Startnummer ' + RALLY_NUMBER,
};

/** His special paints, with the names he gives them; a metallic one shines on the car's model. None is in any car type's colours. */
export const WORKSHOP_PAINTS: readonly { readonly paint: string; readonly name: string; readonly metallic: boolean }[] =
  [
    { paint: '#d9c25a', name: 'Guldmetallic', metallic: true }, // champagne: far from the EPA-traktor's orange-gold #e8a020, which #d4a514 was near
    { paint: '#86c440', name: 'Limegrön', metallic: false },
    { paint: '#6a3a9e', name: 'Discolila', metallic: false },
    { paint: '#e86fa6', name: 'Tuggummirosa', metallic: false },
    { paint: '#f2661c', name: 'Vägverksorange', metallic: false },
  ];

/** Whether this paint is one of his metallic ones. */
export const isMetallicPaint = (paint: string) => WORKSHOP_PAINTS.some(p => p.metallic && p.paint === paint);
