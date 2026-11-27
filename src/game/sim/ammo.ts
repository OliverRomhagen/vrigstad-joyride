// Ammo (#611, lab: pickadoll): what a hit does. The weapon decides how a shot is delivered (./shots.ts), the ammo what
// it does where it lands (#17's rule): a list of effects, which the page module (../pickadoll.ts) carries out on whoever
// or whatever was hit. Plain data, metres and seconds.

/** The ammo, by the id the lab's `ammo` command and the test hook use. */
export const AmmoId = { GEGGA: 'gegga', PANG: 'pang', DANS: 'dans', FOTANGLAR: 'fotanglar' } as const;
export type AmmoId = (typeof AmmoId)[keyof typeof AmmoId];

/** The verbs an ammo is made of. */
export const EffectKind = {
  SPLAT: 'splat',
  STARE: 'stare',
  THROW: 'throw',
  SHOVE: 'shove',
  DAMAGE: 'damage',
  DANCE: 'dance',
  SPIKES: 'spikes',
  SPATTER: 'spatter',
} as const;
export type EffectKind = (typeof EffectKind)[keyof typeof EffectKind];

/** One thing a hit does. The weapon's own numbers (its push, its damage, its splat and blast) say how much. */
export type Effect =
  // a mark where it lands, this share of the weapon's splat; on a person too when `onPeople`
  | { kind: typeof EffectKind.SPLAT; sizeK: number; onPeople: boolean }
  // a person hit stops and looks at you this long
  | { kind: typeof EffectKind.STARE; s: number }
  // a person hit is thrown over, the harder the weapon's push (knockbackOf)
  | { kind: typeof EffectKind.THROW }
  // a parked car hit slides, when the weapon's push beats its brakes (slideCar)
  | { kind: typeof EffectKind.SHOVE }
  // a car hit takes the weapon's damage
  | { kind: typeof EffectKind.DAMAGE }
  // a person hit spins and hops where they stand this long
  | { kind: typeof EffectKind.DANCE; s: number }
  // it lands as a fotangel, which lies on the ground (./spikes.ts) and does nothing else where it lands
  | { kind: typeof EffectKind.SPIKES }
  // a blast leaves this many more splats around where it went off
  | { kind: typeof EffectKind.SPATTER; drops: number };

export interface Ammo {
  id: AmmoId;
  name: string;
  colours: readonly string[]; // what it marks with; a shot rolls one of them (sRGB)
  anyWeapon: boolean; // every weapon fires it, unless the weapon names its own ammo (Weapon.ammo)
  effects: readonly Effect[];
}

// gegga's colours: bright, so nobody reads it as blood
const GEGGA_COLOURS = ['#ff3b6b', '#ffd400', '#22d3a0', '#2e9bff', '#b45cff', '#ff7a1a'] as const;

/**
 * The ammo in the order the lab steps through it. Every weapon fires the first three for now. Ideas for later (#611):
 * some ammo only on some weapons (dans on a few, an exploding ammo on a shotgun), legendary weapons with an ammo of
 * their own, a blast that belongs to the ammo, and modifications that add ammo to a weapon (#610).
 */
export const AMMOS = [
  {
    id: AmmoId.GEGGA,
    name: 'Gegga',
    colours: GEGGA_COLOURS,
    anyWeapon: true,
    effects: [
      { kind: EffectKind.SPLAT, sizeK: 1, onPeople: true },
      { kind: EffectKind.STARE, s: 2.5 },
      { kind: EffectKind.SPATTER, drops: 7 },
    ],
  },
  // people are thrown and cars damaged, and shoved by a hard enough push, with no colour: a scuff where it lands
  {
    id: AmmoId.PANG,
    name: 'Pang',
    colours: ['#2b2b2b'],
    anyWeapon: true,
    effects: [
      { kind: EffectKind.SPLAT, sizeK: 0.45, onPeople: false },
      { kind: EffectKind.THROW },
      { kind: EffectKind.SHOVE },
      { kind: EffectKind.DAMAGE },
    ],
  },
  // a prank: who is hit dances for a while
  {
    id: AmmoId.DANS,
    name: 'Dans',
    colours: ['#ff5fd2'],
    anyWeapon: true,
    effects: [
      { kind: EffectKind.SPLAT, sizeK: 0.45, onPeople: false },
      { kind: EffectKind.DANCE, s: 6 },
    ],
  },
  // only the fotanglar's own weapon throws them
  {
    id: AmmoId.FOTANGLAR,
    name: 'Fotanglar',
    colours: ['#2b2b2b'],
    anyWeapon: false,
    effects: [{ kind: EffectKind.SPIKES }],
  },
] as const satisfies readonly Ammo[];

/** What a weapon says about its ammo: the ammo it fires, or null for every ammo that any weapon fires. */
export interface AmmoRule {
  ammo: readonly AmmoId[] | null;
}

/** The weapon fires this ammo. */
export function accepts(weapon: AmmoRule, ammo: AmmoId): boolean {
  return weapon.ammo ? weapon.ammo.includes(ammo) : AMMOS.some(a => a.id === ammo && a.anyWeapon);
}

/** The index in AMMOS the weapon fires when `chosen` is picked: `chosen` itself, or the first ammo it does fire. */
export function ammoFor(weapon: AmmoRule, chosen: number): number {
  if (accepts(weapon, AMMOS[chosen].id)) return chosen;
  return AMMOS.findIndex(a => accepts(weapon, a.id));
}

/** The ammo after `current` that the weapon fires, in AMMOS's order and round again: what G and the `ammo` command step to. */
export function nextAmmo(weapon: AmmoRule, current: number): number {
  for (let k = 1; k <= AMMOS.length; k++) {
    const i = (current + k) % AMMOS.length;
    if (accepts(weapon, AMMOS[i].id)) return i;
  }
  return current;
}

/** The effect of this kind in the ammo's list, or undefined. */
export function effectOf<K extends EffectKind>(ammo: Ammo, kind: K): Extract<Effect, { kind: K }> | undefined {
  return ammo.effects.find((e): e is Extract<Effect, { kind: K }> => e.kind === kind);
}
