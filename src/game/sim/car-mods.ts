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

// The names are local; the metallic paints cost more.
export const PAINTS = {
  'vrigstad-rod': { name: 'Vrigstadröd', kr: 300, hex: '#9e1b1b', metallic: false },
  'ema-gron': { name: 'Emågrön', kr: 300, hex: '#2e6b3f', metallic: false },
  'kiosk-gul': { name: 'Kioskgul', kr: 300, hex: '#e3b505', metallic: false },
  'mjolk-vit': { name: 'Mjölkvit', kr: 300, hex: '#eeeae0', metallic: false },
  'slattsjo-bla': { name: 'Slättsjöblå metallic', kr: 500, hex: '#1f4e8c', metallic: true },
  'raggar-svart': { name: 'Raggarsvart metallic', kr: 500, hex: '#141518', metallic: true },
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
