// Fotanglar (#17, lab: pickadoll): spikes that lie where they were thrown for a while. This file says where one comes
// to lie and who is on one each step; what that does to them (a limp, a puncture, a hurt foot) is decided by the page
// module, ../pickadoll.ts. Plain data, metres and seconds.
import { WHEEL, type Wheel } from '../cars';
import type { ShotHit } from './shots';

export const SPIKES_MAX = 140, // on the ground at once; the oldest go first
  SPIKE_S = 60, // one lies this long
  SPIKE_OFF_WALL_M = 0.3; // one that hits a wall or a car drops this far out from it
const SPIKE_STEP_M = 0.55, // a foot within this of one steps on it
  SPIKE_WHEEL_M = 1.3, // a car's middle within this of one drives over it
  SPIKE_CAR_MIN_MS = 1; // a car standing on one is fine until it rolls

/** One fotangel on the ground. `turn` (0..1) is the way it lies, for drawing. */
export interface Spike {
  x: number;
  y: number;
  z: number;
  turn: number;
  leftS: number;
}

/** Who can come by. */
export interface SpikeWorld {
  cars: readonly { x: number; z: number; v: number; h: number }[]; // h: where the nose points (rad, 0 is north)
  people: readonly { x: number; z: number; down?: boolean }[];
  /** you, on foot and on the ground; null in a car or in a jump, which clears them */
  walker: { x: number; z: number } | null;
}

/** What a step found. The lists are indices in the world's, and one can be named twice, by two spikes. */
export interface SpikeStep {
  cars: number[]; // drove over one: it is used up
  wheels: Wheel[]; // for each of those, the wheel that went over it (Car.flat)
  people: number[]; // stand on one
  walker: boolean; // you stand on one
  changed: boolean; // spikes were used up or ran out of time: draw the list again
}

export const newSpikeStep = (): SpikeStep => ({ cars: [], wheels: [], people: [], walker: false, changed: false });

/** The wheel of a car nearest a point: front or rear by which side of the middle it is, left or right likewise. */
export function wheelOver(c: { x: number; z: number; h: number }, p: { x: number; z: number }): Wheel {
  const dx = p.x - c.x,
    dz = p.z - c.z,
    front = dx * Math.sin(c.h) - dz * Math.cos(c.h) >= 0,
    right = dx * Math.cos(c.h) + dz * Math.sin(c.h) >= 0;
  if (front) return right ? WHEEL.FRONT_RIGHT : WHEEL.FRONT_LEFT;
  return right ? WHEEL.REAR_RIGHT : WHEEL.REAR_LEFT;
}

/**
 * Lays a spike where a thrown one hit: on the ground where it fell, or just out from the wall or car it hit, on the
 * ground below. The oldest goes when there are too many.
 */
export function dropSpike(
  spikes: Spike[],
  hit: Pick<ShotHit, 'kind' | 'x' | 'z' | 'nx' | 'nz'>,
  groundAt: (x: number, z: number) => number,
  turn: number,
) {
  const out = hit.kind === 'ground' ? 0 : SPIKE_OFF_WALL_M,
    x = hit.x + hit.nx * out,
    z = hit.z + hit.nz * out;
  if (spikes.length >= SPIKES_MAX) spikes.shift();
  spikes.push({ x, y: groundAt(x, z), z, turn, leftS: SPIKE_S });
}

/**
 * Moves the spikes on by dt seconds and says who is on one. A car that rolls over a spike uses it up; a foot doesn't,
 * so the next one to come by steps on it too. A spike a car used up this step catches nobody else.
 */
export function stepSpikes(spikes: Spike[], dt: number, world: SpikeWorld, out: SpikeStep): SpikeStep {
  out.cars.length = out.wheels.length = out.people.length = 0;
  out.walker = out.changed = false;
  for (let i = spikes.length - 1; i >= 0; i--) {
    const s = spikes[i];
    s.leftS -= dt;
    let used = s.leftS <= 0;
    if (!used)
      for (let k = 0; k < world.cars.length; k++) {
        const c = world.cars[k];
        if (Math.abs(c.v) > SPIKE_CAR_MIN_MS && Math.hypot(c.x - s.x, c.z - s.z) < SPIKE_WHEEL_M) {
          out.cars.push(k);
          out.wheels.push(wheelOver(c, s));
          used = true;
          break;
        }
      }
    if (used) {
      spikes.splice(i, 1);
      out.changed = true;
      continue;
    }
    for (let k = 0; k < world.people.length; k++) {
      const p = world.people[k];
      if (!p.down && Math.hypot(p.x - s.x, p.z - s.z) < SPIKE_STEP_M) out.people.push(k);
    }
    const w = world.walker;
    if (w && Math.hypot(w.x - s.x, w.z - s.z) < SPIKE_STEP_M) out.walker = true;
  }
  return out;
}
