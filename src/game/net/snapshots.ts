// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): what one player sends about themselves, and how the
// others turn what arrives into smooth movement. Plain data, so it can cross a channel as it is.
import { wrap } from '../../world/math';
import type { CarType } from '../sim/vehicle-spec';

/** How the car a player drives looks: enough for another client to build the same one. */
export interface CarLook {
  type: CarType;
  model: string | null; // the vehicle id of its model, if it wears one
  color: string;
}

/** The car a player drives: which one it is, and enough for a client that has never seen it to make it. */
export interface CarRef {
  id: string; // the same on every client (shared-cars.ts)
  since: number; // ms: when the player got in, which settles two players taking one car
  dmg: number; // the driver's client decides the damage of the car they drive
  look: CarLook;
}

/** One player at one moment: on foot, or the car they drive when `car` is set. */
export interface Snapshot {
  t: number; // ms, on the clock the peers share
  x: number;
  z: number;
  h: number; // rad, 0 is north: where the player, or the car's nose, points
  vh: number; // rad: the line of travel, which differs from h in a slide
  v: number; // m/s along vh
  y: number; // m above the ground, on foot (a jump)
  phase: number; // the walk cycle, on foot
  hidden: boolean; // inside a safehouse
  car: CarRef | null;
}

export const SEND_HZ = 15;
export const INTERP_DELAY_MS = 120; // remote players are drawn this far in the past: about two snapshots, so there is one on each side
export const COAST_MS = 250; // when snapshots stop, keep moving at the last speed this long, then stand still
const KEEP = 8; // snapshots kept per player: half a second

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const sameCar = (a: CarRef | null, b: CarRef | null) => a?.id === b?.id;

/** The last snapshots of one remote player, and where that player is at a time between or just after them. */
export class SnapshotBuffer {
  private readonly snaps: Snapshot[] = [];

  /** the time of the newest snapshot (ms), or -Infinity before the first */
  get newest() {
    return this.snaps.length ? this.snaps[this.snaps.length - 1].t : -Infinity;
  }

  /** Adds a snapshot. One that is older than the newest arrived out of order and is dropped. */
  push(s: Snapshot) {
    if (s.t <= this.newest) return;
    this.snaps.push(s);
    if (this.snaps.length > KEEP) this.snaps.shift();
  }

  /** Writes the player's state at `t` (ms) into `out`; false when there is no snapshot yet. */
  sample(t: number, out: Snapshot): boolean {
    const { snaps } = this;
    if (!snaps.length) return false;
    let i = snaps.length - 1;
    while (i > 0 && snaps[i].t > t) i--;
    const a = snaps[i],
      b = snaps[i + 1];
    Object.assign(out, a);
    out.t = t;
    if (t <= a.t) return true; // before the oldest: hold it
    if (!b) {
      // after the newest: coast along the line of travel
      const s = Math.min(t - a.t, COAST_MS) / 1000;
      out.x += Math.sin(a.vh) * a.v * s;
      out.z -= Math.cos(a.vh) * a.v * s;
      return true;
    }
    if (!sameCar(a.car, b.car)) return true; // got in or out between the two: no blend between a walk and a car
    const k = (t - a.t) / (b.t - a.t);
    out.x = lerp(a.x, b.x, k);
    out.z = lerp(a.z, b.z, k);
    out.y = lerp(a.y, b.y, k);
    out.v = lerp(a.v, b.v, k);
    out.phase = lerp(a.phase, b.phase, k);
    out.h = a.h + wrap(b.h - a.h) * k; // the short way round
    out.vh = a.vh + wrap(b.vh - a.vh) * k;
    return true;
  }
}

/** An empty snapshot, for `sample` to write into. */
export const blankSnapshot = (): Snapshot => ({
  t: 0,
  x: 0,
  z: 0,
  h: 0,
  vh: 0,
  v: 0,
  y: 0,
  phase: 0,
  hidden: false,
  car: null,
});
