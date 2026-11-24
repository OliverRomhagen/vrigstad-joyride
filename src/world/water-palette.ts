// The water's colours as tokens, sRGB hex: one place to retune the look, and where a season (#114) swaps them.
// Muted late-summer blue-greens; the shallows lean warm and green, never tropical turquoise.

export interface WaterColours {
  /** open water, away from the shore */
  deep: number;
  /** the shallows */
  shallow: number;
  /** the line along the shore */
  edge: number;
  /** the ripple lines */
  ripple: number;
}

export const GAME_WATER: WaterColours = { deep: 0x3e6670, shallow: 0x5d8574, edge: 0xa3ad86, ripple: 0xc9d8c8 };
export const MAP_WATER_LIGHT: WaterColours = { deep: 0x80b6d4, shallow: 0x9fcdea, edge: 0xcfe6ee, ripple: 0xd9edf5 };
export const MAP_WATER_DARK: WaterColours = { deep: 0x10304a, shallow: 0x163d57, edge: 0x2a6289, ripple: 0x2f6d93 };
