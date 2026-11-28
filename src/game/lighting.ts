// Car lights (#304): what each of a car's lamp groups shows, from what the car is doing. Plain data and functions;
// src/game/render/vehicle-visuals.ts turns a LampState into lit or unlit lamp materials.
import type { Car } from './cars';
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
 * What car `c`'s lamps show at clock `timeS` (s, the clock crashes write `hitAt` with). `dark` is 0 by day … 1 fully
 * dark; nothing computes it yet, so today it is always 0 (the dusk glow is a later part of #304). Writes into `out`.
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
