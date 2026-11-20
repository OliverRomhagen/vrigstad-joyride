// Procedural fair-weather clouds: the presets, the configuration and the cloud field, as plain numbers. The sky shader
// (src/game/render/sky.ts) draws the same field on the GPU; this copy lets the game ask, once a frame, whether the sun
// is behind a cloud. Keep the two in step: same hash, same noise, same constants.

/** how much of the sky the clouds cover, roughly */
export type CloudCover = 'clear' | 'scattered' | 'partly' | 'mostly';

export interface CloudPreset {
  /** field value where cloud starts; higher means less cloud */
  threshold: number;
  /** width of the soft edge, in field units */
  softness: number;
  /** how strongly large-scale clusters gather the clouds and open clear areas */
  cluster: number;
  /** most opacity a cloud core reaches */
  opacity: number;
  /** share of direct sunlight a cloud in front of the sun takes away */
  sunDim: number;
}

// Artistic values, tuned by eye from screenshots; the coverage test pins their order and rough share of the sky.
export const CLOUD_PRESETS: Readonly<Record<CloudCover, CloudPreset>> = {
  clear: { threshold: 0.75, softness: 0.07, cluster: 0.34, opacity: 0.92, sunDim: 0.3 },
  scattered: { threshold: 0.66, softness: 0.08, cluster: 0.3, opacity: 0.95, sunDim: 0.38 },
  partly: { threshold: 0.57, softness: 0.09, cluster: 0.26, opacity: 0.97, sunDim: 0.42 },
  mostly: { threshold: 0.47, softness: 0.1, cluster: 0.22, opacity: 0.98, sunDim: 0.5 },
};
export const CLOUD_COVERS = Object.keys(CLOUD_PRESETS) as CloudCover[];

/** height of the cloud layer above the world's lowest ground (m): fair-weather cumulus base */
export const CLOUD_ALTITUDE_M = 1800;
/** size of one unit of the cloud field (m); cloud bodies come out a few hundred metres to about 2 km across */
export const CLOUD_SCALE_M = 1600;
/** the noise lattice repeats every this many units */
const CLOUD_PERIOD = 256;
/**
 * the whole field repeats every this many units: a multiple of the lattice period at every frequency used (1, 1/2, 1/4).
 * The wind and time offsets wrap at it, so nothing jumps however long the game runs, and float32 keeps its precision.
 */
export const FIELD_PERIOD = 1024;
/**
 * added to a view ray's rise when it meets the layer: a gently curved layer instead of a flat one, so clouds near the
 * horizon aren't squashed into streaks (as if the eye saw the sides of cumulus heaps, not their flat bases)
 */
export const CLOUD_CURVE = 0.07;
/** distance over which clouds thin out and sink into the haze towards the horizon (m) */
export const CLOUD_FADE_M = 16000;
/** how fast the shapes change, in field units per second of the third (time) axis */
const CLOUD_EVOLVE_PER_S = 1 / 420;
/** how long the sunlight takes to follow a cloud passing in front of the sun (s, exponential time constant) */
export const SUN_SHADE_TAU_S = 1.6;

export interface CloudConfig {
  /** 'off' draws no clouds and leaves the sunlight alone */
  cover: CloudCover | 'off';
  /** picks the sky; the same seed and settings give the same sky */
  seed: number;
  /** where the wind blows from, degrees clockwise from north (meteorological), as a forecast says it */
  windFromDeg: number;
  windSpeedMps: number;
  /** scales the edge softness: above 1 softer, below 1 crisper */
  softness: number;
  /** 'low' draws fewer noise octaves and no self-shadowing, for slow GPUs */
  quality: 'high' | 'low';
}

/** a warm late-summer afternoon: partly cloudy, a light westerly breeze */
export const DEFAULT_CLOUDS: Readonly<CloudConfig> = {
  cover: 'partly',
  seed: 1,
  windFromDeg: 250,
  windSpeedMps: 7,
  softness: 1,
  quality: 'high',
};

/** The part of URLSearchParams this reads; the world has no DOM types (tsconfig.sim.json). */
type Query = { get(name: string): string | null; has(name: string): boolean };

/**
 * The configuration from URL parameters, for visual testing: `?clouds=clear|scattered|partly|mostly|off`,
 * `cloudSeed=7`, `wind=250,7` (from degrees, m/s), `cloudSoft=1.3`, `cloudQuality=low|high`. Anything missing or
 * unreadable keeps the default; `coarse` (a touch screen) defaults the quality to low.
 */
export function parseCloudConfig(q: Query, coarse = false): CloudConfig {
  const c: CloudConfig = { ...DEFAULT_CLOUDS, quality: coarse ? 'low' : 'high' };
  const cover = q.get('clouds');
  if (cover === 'off' || (cover && cover in CLOUD_PRESETS)) c.cover = cover as CloudConfig['cover'];
  const seed = Number(q.get('cloudSeed'));
  if (q.has('cloudSeed') && Number.isInteger(seed)) c.seed = seed;
  const [from, speed] = (q.get('wind') ?? '').split(',').map(Number);
  if (Number.isFinite(from) && q.has('wind')) c.windFromDeg = ((from % 360) + 360) % 360;
  if (Number.isFinite(speed) && speed >= 0) c.windSpeedMps = Math.min(speed, 40);
  const soft = Number(q.get('cloudSoft'));
  if (q.has('cloudSoft') && soft > 0) c.softness = Math.min(Math.max(soft, 0.3), 3);
  const quality = q.get('cloudQuality');
  if (quality === 'low' || quality === 'high') c.quality = quality;
  return c;
}

const fract = (v: number) => v - Math.floor(v);
const mod = (v: number, m: number) => v - m * Math.floor(v / m);

/** Hash of an integer lattice point to [0, 1). The GLSL hash3 in sky.ts is the same formula. */
function hash3(x: number, y: number, z: number) {
  x = mod(x, CLOUD_PERIOD);
  y = mod(y, CLOUD_PERIOD);
  z = mod(z, CLOUD_PERIOD);
  let a = fract(x * 0.1031);
  let b = fract(y * 0.1031);
  let c = fract(z * 0.1031);
  const d = a * c + b * b + c * a + (a + b + c) * 31.32; // dot(q, q.zyx + 31.32)
  a += d;
  b += d;
  c += d;
  return fract((a + b) * c);
}

/** Value noise in [0, 1), smooth, periodic every CLOUD_PERIOD on each axis. */
function valueNoise(x: number, y: number, z: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const n = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz);
  return l(
    l(l(n(0, 0, 0), n(1, 0, 0), ux), l(n(0, 1, 0), n(1, 1, 0), ux), uy),
    l(l(n(0, 0, 1), n(1, 0, 1), ux), l(n(0, 1, 1), n(1, 1, 1), ux), uy),
    uz,
  );
}

/** Fractal sum of `octaves` noise layers, each twice the frequency and half the weight; normalised to [0, 1). */
function fbm(x: number, y: number, z: number, octaves: number) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x, y, z);
    norm += amp;
    amp *= 0.5;
    // whole-number shifts keep the sum periodic; they stop the octaves' lattices lining up
    x = x * 2 + 17;
    y = y * 2 + 31;
    z = z * 2 + 7;
  }
  return sum / norm;
}

/** Billowy fractal sum: |2n - 1| per octave gives rounded lobes with creases between them, like heaped cumulus. */
function billow(x: number, y: number, z: number, octaves: number) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * Math.abs(2 * valueNoise(x, y, z) - 1);
    norm += amp;
    amp *= 0.5;
    x = x * 2 + 17;
    y = y * 2 + 31;
    z = z * 2 + 7;
  }
  return sum / norm;
}

/** Lattice offsets the seed picks, whole numbers so the field stays periodic. */
export function seedOffset(seed: number): [number, number] {
  return [Math.floor(hash3(seed, 11, 3) * CLOUD_PERIOD), Math.floor(hash3(seed, 5, 29) * CLOUD_PERIOD)];
}

/** Where the wind has carried the field after `t` seconds, in field units, wrapped into [0, FIELD_PERIOD). */
export function windOffset(
  cfg: Pick<CloudConfig, 'windFromDeg' | 'windSpeedMps'>,
  t: number,
  out: [number, number] = [0, 0],
) {
  // the wind blows from windFromDeg: the clouds travel the other way. North is -z, east is +x.
  const to = ((cfg.windFromDeg + 180) * Math.PI) / 180;
  const metres = cfg.windSpeedMps * t;
  out[0] = mod((Math.sin(to) * metres) / CLOUD_SCALE_M, FIELD_PERIOD);
  out[1] = mod((-Math.cos(to) * metres) / CLOUD_SCALE_M, FIELD_PERIOD);
  return out;
}

/** The third field axis after `t` seconds: the clouds' slow change of shape. */
export const evolveAt = (t: number) => mod(t * CLOUD_EVOLVE_PER_S, FIELD_PERIOD);

export const HIGH_OCTAVES = 5;
export const LOW_OCTAVES = 3;

/**
 * The cloud field above world point (x, z), with the wind offset (u, v) and the time axis w. `base` says where clouds
 * are (domain-warped, with large clusters that open clear areas); `detail` is the billowy noise that erodes their edges
 * into heaped lobes. The shader computes the same, step for step.
 */
export function cloudField(
  x: number,
  z: number,
  u: number,
  v: number,
  w: number,
  seed: [number, number],
  octaves = HIGH_OCTAVES,
) {
  // the world moves against the wind offset: the field at a world point is the field at (point - offset)
  const px = x / CLOUD_SCALE_M - u + seed[0];
  const pz = z / CLOUD_SCALE_M - v + seed[1];
  // domain warp: bends the field so clouds come out as uneven heaps rather than noise blobs
  const qx = px + (fbm(px * 0.5 + 5, pz * 0.5 + 1, w, 2) - 0.5) * 1.6;
  const qz = pz + (fbm(px * 0.5 + 83, pz * 0.5 + 47, w, 2) - 0.5) * 1.6;
  const cluster = valueNoise(px * 0.25 + 40, pz * 0.25 + 9, w * 0.5);
  const base = fbm(qx, qz, w, 3);
  const detail = billow(qx * 4 + 3, qz * 4 + 11, w * 2, octaves - 2);
  return { base, cluster, detail, qx, qz };
}

/** how deep the billowy detail cuts into a cloud's edge */
export const EROSION = 0.85;

/**
 * Cloud opacity 0..1 from the field: coverage from the base and clusters through the preset's threshold, then the edges
 * eroded by the detail into lobes, with a soft rim of width `softness`.
 */
export function cloudAlpha(base: number, cluster: number, detail: number, preset: CloudPreset, softness = 1) {
  const cover = smooth(preset.threshold - 0.12, preset.threshold + 0.12, base + (cluster - 0.5) * preset.cluster);
  const eroded = cover - (1 - cover) * detail * EROSION;
  return smooth(0, preset.softness * softness * 2, eroded) * preset.opacity;
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How much cloud is in front of the sun, 0..1, seen from (cx, cy, cz) along the unit direction to the sun (sx, sy, sz).
 * The sky shader draws the same cloud there, so the light dims when the player sees the sun go behind one.
 */
export function sunCover(
  cfg: CloudConfig,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  t: number,
) {
  if (cfg.cover === 'off' || sy <= 0.02) return 0;
  const reach = (CLOUD_ALTITUDE_M - cy) / (sy + CLOUD_CURVE);
  if (reach <= 0) return 0;
  const [u, v] = windOffset(cfg, t);
  const f = cloudField(cx + sx * reach, cz + sz * reach, u, v, evolveAt(t), seedOffset(cfg.seed));
  // the same thinning with distance and towards the horizon as the shader, so what you see is what dims the sun
  const h = Math.min(1, Math.max(0, (sy - 0.012) / (0.13 - 0.012)));
  const fade = Math.exp(-reach / CLOUD_FADE_M) * h * h * (3 - 2 * h);
  return (
    (cloudAlpha(f.base, f.cluster, f.detail, CLOUD_PRESETS[cfg.cover], cfg.softness) /
      CLOUD_PRESETS[cfg.cover].opacity) *
    fade
  );
}
