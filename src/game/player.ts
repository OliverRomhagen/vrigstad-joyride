// The player on foot: walking, wading, jumping, and where you stand when you get out of a car or start over.
// Moved from src/game/main.ts (#177); main.ts keeps the mesh, the collisions, being run over and what E does. No three.js or DOM here.
import { clamp, wrap } from '../world/math';

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
const EDGE_M = 2; // you stay this far inside the map's edge
const REACH_M = 4.4; // a car closer than this is one you can get into
const GET_OUT_MAX_MS = 3,
  GET_OUT_M = 2; // you can get out at up to this speed, and step out this far to the car's left

type Point = { x: number; z: number };
/** You on foot. `y` is metres above the ground and `vy` its speed (m/s); `h` the heading (rad, 0 is north); `phase` drives the walk cycle. */
export interface PlayerState extends Point {
  y: number;
  vy: number;
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

/** The car you'd get into: the closest one within reach that isn't the police's or another player's. */
export function carInReach<C extends CarNearby>(p: Point, cars: readonly C[]): C | null {
  let best: C | null = null,
    bd = REACH_M;
  for (const c of cars) {
    if (c.mode === 'police' || c.mode === 'remote') continue;
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
  p.y = p.vy = 0;
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

/** Jumping and falling: `jump` takes off when you stand on the ground. Exact for constant gravity, so the hop is the same at any frame rate. */
export function hop(p: PlayerState, dt: number, jump: boolean) {
  if (p.y === 0 && jump) p.vy = JUMP_V_MS;
  if (p.y > 0 || p.vy > 0) {
    p.y += (p.vy - (GRAVITY_MS2 * dt) / 2) * dt;
    p.vy -= GRAVITY_MS2 * dt;
    if (p.y <= 0) p.y = p.vy = 0;
  }
}
