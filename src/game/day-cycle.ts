// Time of day (#99). The clock runs from dawn to dusk and then skips the night: over a few seconds the light blends from
// dusk into the next dawn, dimming a little halfway, so the game never gets dark enough to need headlights.
// Plain data and functions: src/game/render/daylight.ts turns a Sky into lights and sky colours.
import { clamp } from '../world/math';
import { type SunPosition, sunAt } from '../world/sun';
import { num } from './command-args';
import { type Commands, UsageError } from './commands';

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

/** How the clock moves: whether it runs, and how many times faster than DAY_S. Apart from the clock, which is only the time. */
export interface DayPace {
  running: boolean;
  speed: number;
}
const MIN_SPEED = 0.1,
  MAX_SPEED = 200; // × the normal pace; at 200 a day and its night pass in under 4 s

export function makePace(running = true): DayPace {
  return { running, speed: 1 };
}

/** One frame of the clock at its pace. Returns whether the time moved, so the light is only worked out when it did. */
export function stepClock(c: DayClock, pace: DayPace, dt: number): boolean {
  if (!pace.running) return false;
  tickClock(c, dt * pace.speed);
  return true;
}

/** Advances the clock by dt real seconds. Time past dusk or past the skip carries on, so a long step lands where it should. */
export function tickClock(c: DayClock, dt: number) {
  let left = dt;
  while (left > 0) {
    if (c.night > 0 || c.hour >= DUSK_H) {
      const used = Math.min(left, (1 - c.night) * NIGHT_S);
      c.night += used / NIGHT_S;
      left -= used;
      if (left > 0 || c.night >= 1) {
        c.night = 0;
        c.hour = DAWN_H;
      }
    } else {
      const used = Math.min(left, ((DUSK_H - c.hour) * DAY_S) / (DUSK_H - DAWN_H));
      c.hour = left > used ? DUSK_H : c.hour + (used * (DUSK_H - DAWN_H)) / DAY_S;
      left -= used;
    }
  }
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const _now: SunPosition = { x: 0, y: 1, z: 0, elevationDeg: 90 };

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

// the date is fixed, so dusk and dawn always look the same: worked out once, not every frame of the skip
const DUSK_SKY = skyFor(sunAt(SEASON_DAY, DUSK_H), { x: 0, y: 1, z: 0, sun: 1, warm: 0, light: 1 });
const DAWN_SKY = skyFor(sunAt(SEASON_DAY, DAWN_H), { x: 0, y: 1, z: 0, sun: 1, warm: 0, light: 1 });

/** The light for the clock's current time. Writes into `out`. */
export function skyAt(c: DayClock, out: Sky): Sky {
  if (c.night <= 0) return skyFor(sunAt(SEASON_DAY, c.hour, _now), out);
  const t = smoothstep(0, 1, c.night),
    mid = Math.sin(Math.PI * c.night);
  const a = DUSK_SKY,
    b = DAWN_SKY;
  const mix = (u: number, v: number) => u + (v - u) * t;
  // the sun swings round through the north, where it really is at night; it gives no direct light midway
  aim(mix(a.x, b.x), mix(a.y, b.y), mix(a.z, b.z), out);
  out.sun = mix(a.sun, b.sun) * (1 - mid);
  out.warm = mix(a.warm, b.warm);
  out.light = mix(a.light, b.light) * (1 - NIGHT_DIM * mid);
  return out;
}

// ---------- the dev console's `time` (#575) ----------
// the words `time` takes in place of an hour
const MOMENTS = { DAWN: 'dawn', NOON: 'noon', DUSK: 'dusk', NIGHT: 'night' } as const;
const PACES = { HOLD: 'hold', RUN: 'run', SPEED: 'speed' } as const;
const TIME_WORDS: readonly string[] = [...Object.values(MOMENTS), ...Object.values(PACES)];
const NOON_H = 12;
const NIGHT_MID = 0.5; // halfway through the skip, where the light is dimmest

// the console's own number arguments, for their parsing (a comma works as the decimal mark) and their range errors
const SPEED_ARG = num('speed', { min: MIN_SPEED, max: MAX_SPEED });
const HOUR_ARG = num('hour', { min: DAWN_H, max: DUSK_H });

/** 16.5, 16,5 or 16:30 as an hour inside the day; throws a UsageError for anything else. */
function parseHour(w: string): number {
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(w);
  return HOUR_ARG.parse(clock ? String(Number(clock[1]) + Number(clock[2]) / 60) : w);
}

const twoDigits = (n: number) => String(n).padStart(2, '0');
function clockLine(c: DayClock, pace: DayPace): string {
  const mins = Math.floor(c.hour * 60 + 1e-6); // the minute it is, not the nearest: 18:59:59 isn't dusk yet
  const at =
    c.night > 0
      ? `night, ${Math.round(c.night * 100)}% through`
      : `${twoDigits(Math.floor(mins / 60))}:${twoDigits(mins % 60)}`;
  // the speed shows while held too, so `time speed 20` on a held clock says it was taken
  return `Time: ${at}, ${pace.running ? 'running' : 'held'} at ${pace.speed}×.`;
}

/**
 * The dev console's `time`: `time 16:30` jumps to an hour of the day, `time night` to the middle of the night skip,
 * `time hold` and `time run` stop and start the clock, and `time speed 20` runs it that many times faster. `changed` runs
 * after a jump, so the light follows while the clock is held.
 */
export function registerDayCommands(
  commands: Pick<Commands, 'register'>,
  c: DayClock,
  pace: DayPace,
  changed: () => void,
) {
  const jump = (hour: number, night = 0) => {
    c.hour = hour;
    c.night = night;
    changed();
  };
  commands.register('time', {
    usage: `[hour|${Object.values(MOMENTS).join('|')}|${PACES.HOLD}|${PACES.RUN}|${PACES.SPEED} <times>]`,
    help: 'show or set the time of day, hold the clock, or speed it up',
    details: `Hours run from ${DAWN_H} to ${DUSK_H}, as 16.5 or 16:30. The night is a ${NIGHT_S} s skip from dusk to dawn: night jumps to its middle.`,
    examples: ['time', 'time 16:30', 'time dusk', 'time hold', 'time speed 20'],
    complete: index => (index === 0 ? TIME_WORDS : []),
    run: a => {
      const what = a[0]?.toLowerCase();
      if (a.length > (what === PACES.SPEED ? 2 : 1)) throw new UsageError('Too many words.');
      if (what === undefined) return clockLine(c, pace);
      if (what === PACES.HOLD || what === PACES.RUN) pace.running = what === PACES.RUN;
      else if (what === PACES.SPEED) {
        pace.speed = SPEED_ARG.parse(a[1] ?? '');
      } else if (what === MOMENTS.DAWN) jump(DAWN_H);
      else if (what === MOMENTS.NOON) jump(NOON_H);
      else if (what === MOMENTS.DUSK) jump(DUSK_H);
      else if (what === MOMENTS.NIGHT) jump(DUSK_H, NIGHT_MID);
      else jump(parseHour(what));
      return clockLine(c, pace);
    },
  });
}
