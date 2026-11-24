// Car mods (#3, the `garage` lab experiment): what Plåt-Pelle can do to a car on the workshop's lift, and what it costs.
// Plain data on the car, so a save (#77) can keep it; the driving code reads the engine step, rendering the rest.

/** What has been done to one car. A car without mods has none of these, and drives and looks as before. */
export interface CarMods {
  paint?: PaintId;
  rims?: RimId;
  glow?: GlowId;
  engine?: 1; // the first engine step; more steps can follow
}

/** One choice in a list: its name in the garage, its price, and what rendering needs. */
interface Part {
  readonly name: string;
  readonly kr: number;
}
export interface Paint extends Part {
  readonly hex: string; // sRGB
  readonly metallic: boolean;
}
export interface Rim extends Part {
  readonly hex: string;
  readonly metalness: number;
  readonly roughness: number;
}
export interface Glow extends Part {
  readonly hex: string;
}

// Colours no car in the village drives in, so a painted car is yours at a glance: they cost more than a plain respray
// would, and the metallic ones more again. A test keeps each at least PAINT_UNIQUE_DE from every colour a car gets in
// the world (the car types' and Skroten's), so a new traffic colour can't quietly copy one. The names are local.
export const PAINT_UNIQUE_DE = 25; // CIE76 ΔE: about where two colours stop reading as the same paint
export const PAINTS = {
  'kiosk-gul': { name: 'Kioskgul', kr: 600, hex: '#f4d311', metallic: false },
  'hallon-rosa': { name: 'Hallonrosa', kr: 600, hex: '#e0457b', metallic: false },
  'ema-turkos': { name: 'Emåturkos', kr: 600, hex: '#11a59b', metallic: false },
  'bjorklov-gron': { name: 'Björklövsgrön', kr: 600, hex: '#8fcf3c', metallic: false },
  'slattsjo-bla': { name: 'Slättsjöblå metallic', kr: 900, hex: '#38b4ef', metallic: true },
  'blabar-lila': { name: 'Blåbärslila metallic', kr: 900, hex: '#5b2a86', metallic: true },
} as const satisfies Record<string, Paint>;
export type PaintId = keyof typeof PAINTS;

// The scene has no environment map, so a true metal has nothing to reflect and draws black: every finish keeps its
// metalness at most FINISH_METAL_MAX, and gets its shine from a low roughness, which catches the sun's highlight.
export const FINISH_METAL_MAX = 0.35;
export const RIMS = {
  krom: { name: 'Kromfälgar', kr: 250, hex: '#f1f4f6', metalness: 0.3, roughness: 0.18 },
  guld: { name: 'Guldfälgar', kr: 250, hex: '#e0b143', metalness: 0.3, roughness: 0.3 },
  svart: { name: 'Svarta fälgar', kr: 250, hex: '#1c1d21', metalness: 0.1, roughness: 0.45 },
} as const satisfies Record<string, Rim>;
export type RimId = keyof typeof RIMS;

export const GLOWS = {
  bla: { name: 'Blått neon', kr: 400, hex: '#2b7bff' },
  rosa: { name: 'Rosa neon', kr: 400, hex: '#ff3fb4' },
  gron: { name: 'Grönt neon', kr: 400, hex: '#39ff6a' },
} as const satisfies Record<string, Glow>;
export type GlowId = keyof typeof GLOWS;

export const ENGINE_STEP = { name: 'Trimmad motor, steg 1', kr: 1200 } as const satisfies Part;
// The engine step is meant to be felt: a quarter more pull, a tenth more top speed (a Volvo 240: 137 to 150 km/h).
export const ENGINE_ACC = 1.25;
export const ENGINE_TOP = 1.1;

/** Acceleration, as a share of the car type's. */
export const modAcc = (mods: CarMods | undefined) => (mods?.engine ? ENGINE_ACC : 1);
/** Top speed, as a share of the car type's. */
export const modTop = (mods: CarMods | undefined) => (mods?.engine ? ENGINE_TOP : 1);
