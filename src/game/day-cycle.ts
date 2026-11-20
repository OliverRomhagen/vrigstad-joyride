// Time of day (#99). The clock runs from dawn to dusk and then skips the night: over a few seconds the light blends from
// dusk into the next dawn, dimming a little halfway, so the game never gets dark enough to need headlights.
// Plain data and functions: src/game/render/daylight.ts turns a Sky into lights and sky colours.
import { clamp } from '../world/math';
import { type SunPosition, sunAt } from '../world/sun';

export const DAWN_H = 5,
  DUSK_H = 19; // local clock hours the day runs between
export const DAY_S = 12 * 60; // real seconds from dawn to dusk
export const NIGHT_S = 10; // real seconds the light takes to blend from dusk into the next dawn
export const START_H = 10;
// 15 July: the sun is up from about 04:15 to 21:45, so both ends of the day are low, warm sun rather than darkness.
// The date doesn't advance; in winter 05:00 and 19:00 are black night.
const SEASON_DAY = 196;
const NIGHT_DIM = 0.35; // how far the ambient light dips halfway through the skip, as a hint of night
const MIN_SUN_Y = 0.1; // about 6°: a lower sun smears its shadows across the whole shadow map

/** `night` is 0 by day, then runs 0 → 1 while the light blends from dusk into dawn. */
export interface DayClock {
  hour: number;
  night: number;
}

/** What the renderer needs. Direction is a unit vector toward the sun (x east, y up, z south); the rest are 0–1. */
export interface Sky {
  x: number;
  y: number;
  z: number;
  sun: number; // direct sunlight, 1 at a high midday sun
  warm: number; // how golden the light and sky are, 1 at a low sun
  light: number; // ambient and sky brightness, 1 at midday
}

export function makeClock(hour = START_H): DayClock {
  return { hour: clamp(Number.isFinite(hour) ? hour : START_H, DAWN_H, DUSK_H), night: 0 };
}

export function tickClock(c: DayClock, dt: number) {
  if (c.night > 0 || c.hour >= DUSK_H) {
    c.night += dt / NIGHT_S;
    if (c.night >= 1) {
      c.night = 0;
      c.hour = DAWN_H;
    }
  } else c.hour = Math.min(DUSK_H, c.hour + (dt * (DUSK_H - DAWN_H)) / DAY_S);
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const _dusk: SunPosition = { x: 0, y: 1, z: 0, elevationDeg: 90 },
  _dawn: SunPosition = { ..._dusk },
  _now: SunPosition = { ..._dusk };
const _a: Sky = { x: 0, y: 1, z: 0, sun: 1, warm: 0, light: 1 },
  _b: Sky = { ..._a };

// Direction keeps the sun at least MIN_SUN_Y up; the levels are artistic, picked to keep midday as the game was tuned.
function skyFor(p: SunPosition, out: Sky) {
  const e = p.elevationDeg;
  out.sun = smoothstep(-1, 30, e);
  out.warm = 1 - smoothstep(8, 40, e);
  out.light = 0.6 + 0.4 * smoothstep(-4, 30, e);
  return aim(p.x, p.y, p.z, out);
}

function aim(x: number, y: number, z: number, out: Sky) {
  const h = Math.hypot(x, z) || 1,
    up = Math.max(MIN_SUN_Y, y / Math.hypot(h, y)),
    k = Math.sqrt(1 - up * up) / h;
  out.x = x * k;
  out.y = up;
  out.z = z * k;
  return out;
}

/** The light for the clock's current time. Writes into `out`. */
export function skyAt(c: DayClock, out: Sky): Sky {
  if (c.night <= 0) return skyFor(sunAt(SEASON_DAY, c.hour, _now), out);
  const t = smoothstep(0, 1, c.night),
    mid = Math.sin(Math.PI * c.night);
  const a = skyFor(sunAt(SEASON_DAY, DUSK_H, _dusk), _a),
    b = skyFor(sunAt(SEASON_DAY, DAWN_H, _dawn), _b);
  const mix = (u: number, v: number) => u + (v - u) * t;
  // the sun swings round through the north, where it really is at night; it gives no direct light midway
  aim(mix(a.x, b.x), mix(a.y, b.y), mix(a.z, b.z), out);
  out.sun = mix(a.sun, b.sun) * (1 - mid);
  out.warm = mix(a.warm, b.warm);
  out.light = mix(a.light, b.light) * (1 - NIGHT_DIM * mid);
  return out;
}
