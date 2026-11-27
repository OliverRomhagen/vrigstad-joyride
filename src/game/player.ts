// The player on foot: walking, wading, jumping, and where you stand when you get out of a car or start over.
// Moved from src/game/main.ts (#177); main.ts keeps the mesh, the collisions, being run over and what E does. No three.js or DOM here.
import { clamp, wrap } from '../world/math';
import { bodyRadius, type CarBody, nearestOnSpine, PERSON_RADIUS_M } from './sim/car-body';
import type { VehicleSpec } from './sim/vehicle-spec';

export const HOME = { x: -8.9, z: 30.1 }; // Torget: you start here, and the police drop you off here
const WALK_MS = 4.6,
  RUN_MS = 8,
  WADE_MS = 1.6; // on foot; running (Shift, or the touch joystick); in water
const MOVE_MIN = 0.08; // keys or stick below this much don't move you
const TURN_K = 12; // how fast you turn to face where you walk (1/s)
const STRIDE_K = 2.1,
  IDLE_PHASE_K = 0.8; // walk cycle phase per metre; standing still keeps this share of it each frame
const JUMP_V_MS = 5.2,
  GRAVITY_MS2 = 16; // m/s up at take-off, m/s² down: a hop about 0.85 m high that lasts 0.65 s
// Standing on cars (#451): the hop alone tops out at 0.85 m, under a bonnet; you reach a car's top by pulling yourself up
const MANTLE_M = 0.75, // in the air, a car's top this far above your feet is in reach: a roof from the ground at the hop's top, a cab from a bonnet
  CLIMB_MS = 5, // how fast you pull yourself up (m/s)
  EDGE_IN_M = 0.25, // pulling up onto a car puts your middle this far in from its side
  LAND_M = 0.05, // a top this little above your feet still takes you as you come down onto it
  TOUCH_M = 0.05; // standing this close to a car's side counts as touching it: where loop.ts's push out leaves you
const EDGE_M = 2; // you stay this far inside the map's edge
const REACH_M = 4.4; // a car closer than this is one you can get into
const GET_OUT_MAX_MS = 3,
  GET_OUT_M = 2; // you can get out at up to this speed, and step out this far to the car's left

type Point = { x: number; z: number };
/**
 * You on foot. `y` is metres above the ground and `vy` its speed (m/s); `floor` is how high what you stand on is (0 on the
 * ground, a car's top on a car); `h` the heading (rad, 0 is north); `phase` drives the walk cycle.
 */
export interface PlayerState extends Point {
  y: number;
  vy: number;
  floor: number;
  h: number;
  speed: number;
  phase: number;
}
/** A car, as getting in and out sees it: `h` its heading, `v` its speed (m/s). */
export interface CarNearby extends Point {
  h: number;
  v: number;
  mode: string;
}

/** The car you'd get into: the closest one within reach that isn't the police. With `only`, the closest of those that pass it. */
export function carInReach<C extends CarNearby>(p: Point, cars: readonly C[], only?: (c: C) => boolean): C | null {
  let best: C | null = null,
    bd = REACH_M;
  for (const c of cars) {
    if (c.mode === 'police' || (only && !only(c))) continue;
    const d = Math.hypot(c.x - p.x, c.z - p.z);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

export const tooFastToGetOut = (c: Pick<CarNearby, 'v'>) => Math.abs(c.v) > GET_OUT_MAX_MS;

/** Puts you on the ground beside the car, on its left, facing the way it faces. */
export function stepOut(p: PlayerState, c: CarNearby) {
  p.x = c.x - Math.cos(c.h) * GET_OUT_M;
  p.z = c.z - Math.sin(c.h) * GET_OUT_M;
  p.h = c.h;
}

/** While you drive, you are where the car is. */
export function ride(p: PlayerState, c: CarNearby) {
  p.x = c.x;
  p.z = c.z;
  p.h = c.h;
  p.speed = Math.abs(c.v);
}

/** Stands you on the ground at (x, z), out of any jump. */
export function standAt(p: PlayerState, x: number, z: number) {
  p.x = x;
  p.z = z;
  p.y = p.vy = p.floor = 0;
}

/** One frame on foot. `mx` / `my` is the move intent (right / forward, -1..1) relative to the camera's `yaw`; `still` while you
 *  can't move (inside a safehouse, under a title card). `half` is half the map's width (m). */
export function walk(
  p: PlayerState,
  dt: number,
  mx: number,
  my: number,
  yaw: number,
  o: { run: boolean; wet: boolean; still: boolean },
  half: number,
) {
  const mag = Math.min(1, Math.hypot(mx, my));
  if (mag > MOVE_MIN && !o.still) {
    const fx = Math.sin(yaw),
      fz = -Math.cos(yaw),
      dx = fx * my - fz * mx,
      dz = fz * my + fx * mx,
      L = Math.hypot(dx, dz);
    const sp = (o.wet ? WADE_MS : o.run ? RUN_MS : WALK_MS) * mag;
    p.x = clamp(p.x + (dx / L) * sp * dt, -half + EDGE_M, half - EDGE_M);
    p.z = clamp(p.z + (dz / L) * sp * dt, -half + EDGE_M, half - EDGE_M);
    p.h += wrap(Math.atan2(dx, -dz) - p.h) * Math.min(1, dt * TURN_K);
    p.speed = sp;
    p.phase += sp * dt * STRIDE_K;
  } else {
    p.speed = 0;
    p.phase *= IDLE_PHASE_K;
  }
}

/**
 * Jumping and falling onto `p.floor` (standOn sets it): `jump` takes off when you stand on it, and a floor above your feet
 * pulls you up to it. Exact for constant gravity, so the hop is the same at any frame rate.
 */
export function hop(p: PlayerState, dt: number, jump: boolean) {
  if (p.y < p.floor) {
    p.y = Math.min(p.floor, p.y + CLIMB_MS * dt); // pulling yourself up onto a car
    p.vy = 0;
    return;
  }
  if (p.y === p.floor && jump) p.vy = JUMP_V_MS;
  if (p.y > p.floor || p.vy > 0) {
    p.y += (p.vy - (GRAVITY_MS2 * dt) / 2) * dt;
    p.vy -= GRAVITY_MS2 * dt;
    if (p.y <= p.floor) {
      p.y = p.floor;
      p.vy = 0;
    }
  }
}

/** A car, as standing on it sees it: where its body is (sim/car-body.ts), and how high its top is. */
export type CarToStandOn = CarBody & {
  T: Pick<VehicleSpec, 'lengthM' | 'widthM' | 'deckM' | 'roofM' | 'roofRearM' | 'roofFrontM'>;
};

// m ahead of c's middle that (x, z) is, along its length
const ahead = (c: CarToStandOn, x: number, z: number) => (x - c.x) * Math.sin(c.h) - (z - c.z) * Math.cos(c.h);

/** How high c's top is at (x, z), in m above the ground: its roof, or its bonnet, boot or load bed. */
export function carTopAt(c: CarToStandOn, x: number, z: number) {
  const s = ahead(c, x, z);
  return s >= c.T.roofRearM && s <= c.T.roofFrontM ? c.T.roofM : c.T.deckM;
}

const _spine = { x: 0, z: 0 };
/**
 * What you stand on this frame, written to `p.floor`: the top of a car you're over and up on, or, in the air, a car whose
 * top is within reach, which you pull yourself up onto and in over, over the climb. 0 for the ground. `left` is the car you
 * last stepped off: you don't climb straight back onto it before you've landed. Walking from a bonnet into the roof of
 * `stood`, the car you stood on last frame, stops you at the windscreen; another car's cab pushes you out of its side, as
 * loop.ts does. Returns the car you stand on or climb, so the push out of cars leaves it alone.
 */
export function standOn<C extends CarToStandOn>(
  p: PlayerState,
  cars: readonly C[],
  dt: number,
  left: C | null = null,
  stood: C | null = null,
): C | null {
  const airborne = p.y !== p.floor || p.vy > 0; // jumping, falling, or already pulling yourself up
  let on: C | null = null,
    floor = 0;
  for (const c of cars) {
    const L = c.T.lengthM;
    if (Math.abs(p.x - c.x) > L || Math.abs(p.z - c.z) > L) continue;
    nearestOnSpine(c, p.x, p.z, _spine);
    const dx = p.x - _spine.x,
      dz = p.z - _spine.z,
      d = Math.hypot(dx, dz),
      r = bodyRadius(c);
    if (d >= r + PERSON_RADIUS_M + TOUCH_M) continue; // not touching it
    let top = carTopAt(c, p.x, p.z);
    if (c === stood && d <= r && p.y < top - LAND_M && p.y >= c.T.deckM - LAND_M && !airborne) {
      // on its bonnet or boot, walking into the roof: the windscreen stops you, and you stay on the deck
      const s = ahead(c, p.x, p.z),
        edge = s - c.T.roofRearM < c.T.roofFrontM - s ? c.T.roofRearM - 0.01 : c.T.roofFrontM + 0.01,
        back = edge - s;
      p.x += Math.sin(c.h) * back;
      p.z -= Math.cos(c.h) * back;
      top = c.T.deckM;
    }
    const standing = d <= r && p.y >= top - LAND_M,
      climbing = airborne && c !== left && top > p.y && top - p.y <= MANTLE_M;
    if ((!standing && !climbing) || top <= floor) continue;
    if (climbing && d > r - EDGE_IN_M && d > 1e-6) {
      // in over its side, where your feet can be: a step at a time, so you get there as hop() gets you up to its top
      const k = Math.min(1, (CLIMB_MS * dt) / (top - p.y)),
        to = d + (r - EDGE_IN_M - d) * k;
      p.x = _spine.x + (dx / d) * to;
      p.z = _spine.z + (dz / d) * to;
    }
    on = c;
    floor = top;
  }
  p.floor = floor;
  return on;
}

/** The car you're on and where it was last frame, so it can carry you as it drives and turns (#451). One object, rewritten each frame. */
export interface CarHold<C extends CarBody> {
  car: C | null;
  x: number;
  z: number;
  h: number;
}

/** Remembers where `car` is now (null: on no car), for `carry` next frame. */
export function holdCar<C extends CarBody>(hold: CarHold<C>, car: C | null) {
  hold.car = car;
  if (!car) return;
  hold.x = car.x;
  hold.z = car.z;
  hold.h = car.h;
}

/**
 * Moves you with the car you were on since `holdCar`: along with it, and round as it turned, whether you stand on it, hop
 * on it or climb up onto it. Not when something else has put you far from it since (a respawn, Gripen!, the console).
 */
export function carry<C extends CarBody>(p: PlayerState, hold: CarHold<C>) {
  const c = hold.car;
  if (!c) return;
  const ox = p.x - hold.x,
    oz = p.z - hold.z;
  if (Math.hypot(ox, oz) > c.T.lengthM) return;
  const dh = c.h - hold.h,
    cs = Math.cos(dh),
    sn = Math.sin(dh);
  p.x = c.x + ox * cs - oz * sn;
  p.z = c.z + ox * sn + oz * cs;
  p.h += dh;
}
