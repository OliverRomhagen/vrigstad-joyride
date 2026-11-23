// Places you can walk into: safehouses (lie low to lose your stars) and the trisslott kiosk on Torget; and Skroten, which you drive into to sell a car.
// Moved from src/game/main.ts (#177); render/places.ts draws them, and main.ts passes in the police, lying low and toasts. No three.js or DOM here.
import { RoadClass } from '../world/data';
import { pointInPolygon, segmentDistance } from '../world/polygon';
import type { RoadLine } from '../world/roads';
import { choice, command, described } from './command-args';
import type { Commands } from './commands';
import { wrecked } from './health';
import { HOME } from './player';
import { RING_UV, yardToWorld } from './skroten-yard';

const SAFE_S = 60,
  SAFE_SEEN_M = 60; // s inside to lose the stars; police closer than this (m) see you go in
const REACH_M = 2.2; // how close you stand to a place's ring to use it
const CAR_REACH_M = 4; // how close a car's middle comes to Skroten's ring to sell it
const DOOR_MIN_WALL_M = 2.5; // a wall shorter than this gets no door
const DOOR_OUT_M = 1.4; // the ring stands this far out from the door (m)
const STREET_CLASS_MAX = RoadClass.TRACK; // only roads below this class (up to service roads, not tracks or paths) count as the street a door faces

/** The safehouses: real houses, each picked by a point inside its footprint, and named after its street. */
const SAFEHOUSES: readonly (readonly [name: string, x: number, z: number])[] = [
  ['Gästgivaregatan', 39.9, -43.6],
  ['Göransgatan', -379.5, -157.8],
  ['Sigfridsvägen', 340.2, 271.5],
];
/** The kiosk on Torget: its middle, its size across x and z (m), and its counter, which faces south towards the spawn point. */
export const KIOSK = { x: -13, z: 25.5, w: 3, d: 2.2, counterZ: 2.3 } as const;
/** Skroten: its ring, just inside the yard's gate on the south side of Stockarydsvägen (skroten-yard.ts). */
export const SKROTEN = yardToWorld(RING_UV.u, RING_UV.v);

export interface Place {
  kind: 'safe' | 'kiosk' | 'skrot';
  name: string;
  x: number;
  z: number;
}
/** A door: the middle of its wall, and the wall's outward normal. */
export interface Door {
  mx: number;
  mz: number;
  nx: number;
  nz: number;
}

/** The middle of the wall of `poly` (a flat [x, z, ...] outline) that is closest to a street, facing out; null when no wall is long enough. */
export function streetDoor(poly: readonly number[], roads: readonly Pick<RoadLine, 'p' | 'c'>[]): Door | null {
  const p = poly as number[];
  let best = 1e9,
    door: Door | null = null;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ex = p[i] - p[j],
      ez = p[i + 1] - p[j + 1],
      len = Math.hypot(ex, ez);
    if (len < DOOR_MIN_WALL_M) continue;
    const mx = (p[i] + p[j]) / 2,
      mz = (p[i + 1] + p[j + 1]) / 2;
    let d = 1e9;
    for (const r of roads)
      if (r.c < STREET_CLASS_MAX)
        for (let k = 1; k < r.p.length; k++)
          d = Math.min(d, segmentDistance(mx, mz, r.p[k - 1][0], r.p[k - 1][1], r.p[k][0], r.p[k][1]));
    if (d < best) {
      best = d;
      let nx = ez / len,
        nz = -ex / len;
      if (pointInPolygon(p, mx + nx * 0.5, mz + nz * 0.5)) {
        nx = -nx;
        nz = -nz;
      }
      door = { mx, mz, nx, nz };
    }
  }
  return door;
}

type Point = { x: number; z: number };
/** What the places read from the rest of the game. */
export interface PlacesDeps {
  footprints: readonly { p: readonly number[] }[];
  roads: readonly Pick<RoadLine, 'p' | 'c'>[];
  police: readonly (Point & { dmg: number })[];
  readonly stars: number;
  lieLow(secs: number): void; // starts the countdown that clears the stars
  toast(msg: string, secs?: number): void;
}

/** The safehouses and the kiosk, and which one you are inside. */
export class Places {
  readonly list: Place[] = [];
  /** the safehouse doors, in the same order as the safehouses in `list` */
  readonly doors: Door[] = [];
  inside: Place | null = null;
  private readonly g: PlacesDeps;

  constructor(g: PlacesDeps) {
    this.g = g;
    for (const [name, x, z] of SAFEHOUSES) {
      const b = g.footprints.find(b => pointInPolygon(b.p as number[], x, z));
      const door = b && streetDoor(b.p, g.roads);
      if (!door) continue;
      this.doors.push(door);
      this.list.push({ kind: 'safe', name, x: door.mx + door.nx * DOOR_OUT_M, z: door.mz + door.nz * DOOR_OUT_M });
    }
    this.list.push({ kind: 'kiosk', name: 'Kiosken', x: KIOSK.x, z: KIOSK.z + KIOSK.counterZ });
    this.list.push({ kind: 'skrot', name: 'Skroten', x: SKROTEN.x, z: SKROTEN.z });
  }

  /** The place whose ring you stand on, if any; Skroten is only for cars. */
  nearest(x: number, z: number) {
    for (const p of this.list) if (p.kind !== 'skrot' && Math.hypot(p.x - x, p.z - z) < REACH_M) return p;
    return null;
  }

  /**
   * go <place> (also tp): takes you to Torget, to a place's ring (the kiosk, Skroten, a safehouse by its street) or to one of `more`
   * (Skroten's workshop lift), in the car if you are in one. `goTo` moves you, and says where you are.
   */
  registerCommands(
    commands: Pick<Commands, 'register'>,
    goTo: (x: number, z: number, name: string) => string,
    more: Readonly<Record<string, { x: number; z: number; name: string }>> = {},
  ) {
    const spots = new Map<string, { x: number; z: number; name: string }>([['torget', { ...HOME, name: 'Torget' }]]);
    for (const p of this.list) spots.set(p.kind === 'kiosk' ? 'kiosk' : p.name.toLowerCase(), p);
    for (const [key, spot] of Object.entries(more)) spots.set(key, spot);
    const names = [...spots.keys()];
    commands.register(
      'go',
      command({
        help: 'go to a place, in the car if you are in one',
        examples: ['go skroten', 'go torget'],
        aliases: ['tp'],
        args: [
          described(choice('place', names), 'Torget, the kiosk, Skroten, its workshop or a safehouse by its street'),
        ],
        run: ({ place }) => {
          const spot = spots.get(place)!; // choice() only gives back a name from the list
          return goTo(spot.x, spot.z, spot.name);
        },
      }),
    );
  }

  /** Skroten, if a car stands on its ring here. */
  skrotenAt(x: number, z: number) {
    for (const p of this.list) if (p.kind === 'skrot' && Math.hypot(p.x - x, p.z - z) < CAR_REACH_M) return p;
    return null;
  }

  /** Goes into a safehouse, unless a police car can see you; true when you went in. */
  enter(p: Place, you: Point & { speed: number }) {
    const g = this.g;
    if (g.police.some(c => !wrecked(c) && Math.hypot(c.x - p.x, c.z - p.z) < SAFE_SEEN_M)) {
      g.toast('The police can see you. Get further ahead of them before you go inside.', 3);
      return false;
    }
    this.inside = p;
    g.lieLow(SAFE_S);
    you.x = p.x;
    you.z = p.z;
    you.speed = 0;
    g.toast(
      g.stars
        ? 'You slip inside. Stay put for a minute and the police give up.'
        : 'Home sweet home. Nobody is looking for you.',
    );
    return true;
  }

  /** Steps back outside; true when you were inside. */
  leave() {
    if (!this.inside) return false;
    this.inside = null;
    if (this.g.stars) this.g.toast('Back outside, and still wanted.', 2.5);
    return true;
  }
}
