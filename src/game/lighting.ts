// Car lights (#304): what each of a car's lamp groups shows, from what the car is doing. Plain data and functions;
// src/game/render/vehicle-visuals.ts turns a LampState into lit or unlit lamp materials.
import { clamp } from '../world/math';
import { sunAt } from '../world/sun';
import type { Car } from './cars';
import { type DayClock, SEASON_DAY } from './day-cycle';
import { wrecked } from './health';

/** Dipped headlights by day, as Swedish law has asked of every driven car since 1977: this share of full beam. */
export const DRL_SHARE = 0.35;
/** The rear position lights by day; they rise by REAR_DARK more in the dark. */
export const REAR_RUN = 0.3;
const REAR_DARK = 0.3;
/** How fast a wrecked car's hazards blink (Hz). */
export const HAZARD_HZ = 1.4;
/** Backing up faster than this (m/s) lights the reversing lights, so a car settling at a stop doesn't flicker them. */
const REVERSE_MS = 0.3;

// How dark it is (#304 §3.1): the lamps glow as the sun goes down, and most of the way through the day cycle's night skip.
// Street lighting (#144) is to read the same value, so the lamps and the cars switch on together.
/** the sun this high (°) and above: no glow */
const DARK_START_DEG = 6;
/** the sun this far below the horizon (°): fully dark */
const DARK_FULL_DEG = -4;
/** how dark the middle of the night skip gets (0–1): nearly full dark, for a few seconds */
const NIGHT_DARK = 0.85;

/** `?lights=`: `auto` follows the clock; `on` and `off` force full dark or full day, for looking at the lamps. */
export type LightsMode = 'auto' | 'on' | 'off';
export const lightsModeOf = (param: string | null): LightsMode => (param === 'on' || param === 'off' ? param : 'auto');

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** 0 by day … 1 fully dark, from the clock's sun and its night skip, or forced by the mode. */
export function lightLevel(clock: Pick<DayClock, 'hour' | 'night'>, mode: LightsMode): number {
  if (mode !== 'auto') return mode === 'on' ? 1 : 0;
  const e = sunAt(SEASON_DAY, clock.hour).elevationDeg;
  return Math.max(smoothstep(DARK_START_DEG, DARK_FULL_DEG, e), NIGHT_DARK * Math.sin(Math.PI * clock.night));
}

/** 0 off … 1 full, per lamp group. brake, reverse and hazard are on or off; hazard already blinks. */
export interface LampState {
  head: number;
  rear: number;
  brake: number;
  reverse: number;
  hazard: number;
}

export const lampsOff = (): LampState => ({ head: 0, rear: 0, brake: 0, reverse: 0, hazard: 0 });

/**
 * What car `c`'s lamps show at clock `timeS` (s, the clock crashes write `hitAt` with). `dark` is lightLevel's: 0 by
 * day … 1 fully dark. Writes into `out`.
 */
export function lampState(
  c: Pick<Car, 'mode' | 'v' | 'brk' | 'dmg' | 'hitAt'>,
  dark: number,
  timeS: number,
  out: LampState,
): LampState {
  out.head = out.rear = out.brake = out.reverse = out.hazard = 0;
  if (wrecked(c)) {
    // blinking from the hit that wrecked it, so a row of wrecks doesn't blink in unison
    out.hazard = ((timeS - c.hitAt) * HAZARD_HZ) % 1 < 0.5 ? 1 : 0;
    return out;
  }
  if (c.mode === 'parked' || c.mode === 'idle') return out; // nobody at the wheel, you included once you've got out
  out.head = DRL_SHARE + (1 - DRL_SHARE) * dark;
  out.rear = REAR_RUN + REAR_DARK * dark;
  out.brake = c.brk ? 1 : 0;
  out.reverse = c.v < -REVERSE_MS ? 1 : 0;
  return out;
}
