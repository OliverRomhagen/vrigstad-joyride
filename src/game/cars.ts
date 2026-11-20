// The cars as the game rules see them: the driving model the player and the police share, traffic that follows the street network, and the cars parked along the streets.
// Moved from src/game/main.ts (#177, #283); main.ts passes in a car's meshes (addCar, placeCar), what a crash does to you and what ramming the police does. No three.js or DOM here.
import type { BuildingIndex } from '../world/buildings';
import { ROAD_WIDTH_M as ROAD_W } from '../world/data';
import { clamp, wrap } from '../world/math';
import { nodeKey, type RoadNetwork } from '../world/roads';
import type { Water } from '../world/water';
import { impactSpeed, topSpeedShare, wrecked } from './health';
import { approach, rearPivotShift, yawRate } from './sim/handling';
import type { CarType, VehicleSpec } from './sim/vehicle-spec';

// Drifting (player only): brake plus steering at speed breaks the rear loose. The car keeps sliding along its line of
// travel (c.vh) while the nose (c.h) swings into the turn. Holding a slide charges a mini-turbo, fired when the brake is let go.
const DRIFT_MIN_V = 7.5,
  DRIFT_KEEP_V = 4; // m/s to start a drift, and below which it fizzles out
const GRIP = 12,
  DRIFT_GRIP = 1.6; // 1/s: how fast the line of travel swings round to where the nose points
const DRIFT_YAW = 1.7,
  DRIFT_MAX_SLIP = 1.0; // yaw rate multiplier in a drift; rad, the most the nose can point off the line (no spin-outs)
const DRIFT_DRAG = 2.5,
  DRIFT_THR = 0.35; // m/s² lost to sideways scrub; share of normal acceleration the throttle still gives
const BRAKE_MS2 = 21,
  COUNTER_MS2 = 17; // m/s² of braking, and of reverse or throttle against the roll: firm, but a car still carries its weight
const RECOVER_S = 0.9,
  SPIN_DECAY = 2.5; // s for grip to come back after a drift; 1/s fade of the yaw the nose carries out of it (counter-steer to catch it)
const FLICK_LOOSE = 0.5,
  FLICK_S = 0.6; // s of looseness each quick left-right reversal adds (up to RECOVER_S); s apart that still counts as quick
const FLICK_LOAD_S = 0.3; // s the first direction must be held to load the car up: shorter taps are corrections, not a flick
const FLICK_SPIN = 1.5; // rad/s the rear's swing adds to the new direction at full looseness, on top of the steering
const CATCH = 0.8; // share of the grip that swings the nose back to the path, not the path to the nose, at full opposite lock
export const TURBO_AT = [1, 2.2] as const; // s of sliding for a blue / an orange spark
const TURBO_S = [0.7, 1.3]; // s each of those boosts lasts
const TURBO_ACC = 14,
  TURBO_TOP = 1.2; // m/s² of boost; top speed multiplier while boosting
const _pivot = { dx: 0, dz: 0 }; // rearPivotShift writes here: no allocation per car per frame

type Point = { x: number; z: number };
/** Who drives a car: nobody yet (`parked`), nobody since you got out (`idle`), traffic (`ai`), the police, or you. */
export type CarMode = 'parked' | 'idle' | 'ai' | 'police' | 'player';
/** A car. `h` is where its nose points and `vh` its line of travel (rad, 0 is north; they differ in a slide), `v` its speed along `vh` (m/s). */
export interface Car extends Point {
  type: CarType;
  T: VehicleSpec;
  h: number;
  vh: number;
  v: number;
  st: number; // steering and throttle as the car answers them, a little behind the input
  thr: number;
  slip: number; // rad the nose points off the line of travel
  drift: number; // the side of a drift (-1 or 1), 0 when not drifting
  charge: number; // s of sliding towards a mini-turbo
  yr: number; // yaw rate (rad/s)
  spin: number; // yaw the nose carries out of a slide (rad/s)
  loose: number; // s left before the rear grips again
  flickDir: number; // the last side steered hard to, the time since (s), and how long it was held (s)
  flickT: number;
  flickHeld: number;
  boost: number; // s of turbo left
  mode: CarMode;
  wet: boolean;
  owned: boolean;
  blocked: number; // traffic: s stuck behind something; then it drives through it as a ghost for `ghost` s
  ghost: number;
  stuck: number; // the police's, in police.ts
  rev: number;
  revSteer: number;
  dmg: number; // damage, and the clock (s) of the last hit (health.ts)
  hitAt: number;
}
/** Where a car or a walker is on the street network: road ri, from vertex a towards a + dir. */
export interface OnRoad {
  ri: number;
  a: number;
  dir: number;
}
/** A car in the traffic, `t` metres along its segment; `first` until its first frame, which puts it on the road at once. */
export interface TrafficCar extends Car, OnRoad {
  t: number;
  first: boolean;
}

/**
 * What the cars read from the rest of the game. The getters are read when used, so main.ts can declare those later.
 * The callbacks are function properties, not methods: the Fleet calls them detached, without `this`.
 */
export interface FleetDeps {
  roads: Pick<RoadNetwork, 'lines' | 'junctions' | 'driveable' | 'nearestRoad'>;
  buildings: Pick<BuildingIndex, 'collide'>;
  water: Pick<Water, 'inWater'>;
  half: number; // half the map's side (m)
  rnd: () => number; // the game's seeded stream, so the rolls stay in the order they were
  pick: <T>(a: readonly T[]) => T;
  addCar: (type: CarType, x: number, z: number, h: number, mode: CarMode) => Car; // makes the car's meshes and adds it to `cars`
  placeCar: (c: Car) => void; // puts the car's meshes where the car is
  crash: (c: Car, o: Car | null, impact: number) => void; // c hit o, or a wall, at `impact` m/s: the damage, and what you hear and feel
  rammed: (c: Car, o: Car) => void; // c hit police car o at speed
  readonly player: Point;
  readonly inCar: boolean;
}

/** Every car in the village: parked, in traffic, the police's and yours. */
export class Fleet {
  readonly cars: Car[] = [];
  private readonly g: FleetDeps;

  constructor(g: FleetDeps) {
    this.g = g;
  }

  civType(): CarType {
    const r = this.g.rnd();
    return r < 0.45 ? 'volvo' : r < 0.75 ? 'saab' : r < 0.9 ? 'epa' : 'traktor';
  }
  // parked cars along streets and driveways
  parkCars() {
    const {
        rnd,
        pick,
        roads: { lines: R },
        buildings,
        water,
        half: HALF,
      } = this.g,
      cars = this.cars;
    let count = 0;
    for (let tries = 0; tries < 900 && count < 58; tries++) {
      const r = pick(R);
      if (r.c !== 2 && r.c !== 3) continue;
      const i = 1 + Math.floor(rnd() * (r.p.length - 1)),
        a = r.p[i - 1],
        b = r.p[i],
        L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 6) continue;
      const t = rnd(),
        dx = (b[0] - a[0]) / L,
        dz = (b[1] - a[1]) / L,
        side = rnd() < 0.5 ? 1 : -1,
        off = (ROAD_W[r.c] / 2 + 1.35) * side;
      const o = { x: a[0] + (b[0] - a[0]) * t - dz * off, z: a[1] + (b[1] - a[1]) * t + dx * off };
      if (Math.abs(o.x) > HALF - 20 || Math.abs(o.z) > HALF - 20) continue;
      const ox = o.x,
        oz = o.z;
      if (buildings.collide(o, 2.6) || water.inWater(ox, oz)) continue;
      if (cars.some(c => Math.hypot(c.x - ox, c.z - oz) < 7)) continue;
      this.g.addCar(this.civType(), ox, oz, Math.atan2(dx, -dz) + (side < 0 ? Math.PI : 0), 'parked');
      count++;
    }
  }
  // traffic that follows the street network
  advance(c: OnRoad, graph?: Map<string, number[]>) {
    const {
      rnd,
      pick,
      roads: { lines: R, junctions: nodes },
    } = this.g;
    const b = c.a + c.dir,
      l = (graph || nodes).get(nodeKey(R[c.ri].p[b])) || [],
      opts: OnRoad[] = [];
    let straight: OnRoad | null = null;
    for (let i = 0; i < l.length; i += 2) {
      const ri = l[i],
        vi = l[i + 1],
        len = R[ri].p.length;
      for (const dir of [1, -1]) {
        if (dir > 0 ? vi >= len - 1 : vi <= 0) continue;
        if (ri === c.ri && vi === b && dir === -c.dir) continue;
        const o = { ri, a: vi, dir };
        opts.push(o);
        if (ri === c.ri && vi === b && dir === c.dir) straight = o;
      }
    }
    const o = straight && rnd() < 0.65 ? straight : opts.length ? pick(opts) : { ri: c.ri, a: b, dir: -c.dir };
    c.ri = o.ri;
    c.a = o.a;
    c.dir = o.dir;
  }
  spawnTraffic(farFrom: Point | null) {
    const {
      rnd,
      pick,
      roads: { lines: R, driveable },
    } = this.g;
    for (let t = 0; t < 40; t++) {
      const ri = pick(driveable),
        r = R[ri],
        a = Math.floor(rnd() * (r.p.length - 1)),
        p = r.p[a];
      if (farFrom && Math.hypot(p[0] - farFrom.x, p[1] - farFrom.z) < 260) continue;
      const type = rnd() < 0.5 ? 'volvo' : rnd() < 0.7 ? 'saab' : 'epa';
      return Object.assign(this.g.addCar(type, p[0], p[1], 0, 'ai'), { ri, a, dir: 1, t: 0, first: true });
    }
  }
  updateTraffic(c: TrafficCar, dt: number) {
    const {
        roads: { lines: R },
      } = this.g,
      cars = this.cars;
    const r = R[c.ri];
    let A = r.p[c.a],
      B = r.p[c.a + c.dir],
      L = Math.max(0.01, Math.hypot(B[0] - A[0], B[1] - A[1]));
    const fx = Math.sin(c.h),
      fz = -Math.cos(c.h);
    let blocked = false;
    if (c.ghost > 0) c.ghost -= dt;
    else {
      for (const o of cars) {
        if (o === c) continue;
        const dx = o.x - c.x,
          dz = o.z - c.z,
          fw = dx * fx + dz * fz;
        if (fw > 0 && fw < 11 && Math.abs(-dx * fz + dz * fx) < 1.7) {
          blocked = true;
          break;
        }
      }
      if (!blocked && !this.g.inCar) {
        const { player } = this.g, // getters: read only when this car can see the player
          dx = player.x - c.x,
          dz = player.z - c.z,
          fw = dx * fx + dz * fz;
        if (fw > 0 && fw < 9 && Math.abs(-dx * fz + dz * fx) < 1.8) blocked = true;
      }
    }
    c.blocked = blocked ? c.blocked + dt : 0;
    if (c.blocked > 6) {
      c.ghost = 3;
      c.blocked = 0;
    }
    const target = blocked || wrecked(c) ? 0 : Math.min(c.T.max * topSpeedShare(c.dmg), [13.9, 11, 8.3][R[c.ri].c]);
    c.v += clamp(target - c.v, -9 * dt, 3 * dt);
    c.t += c.v * dt;
    for (let g = 0; c.t >= L && g < 8; g++) {
      c.t -= L;
      this.advance(c);
      const q = R[c.ri];
      A = q.p[c.a];
      B = q.p[c.a + c.dir];
      L = Math.max(0.01, Math.hypot(B[0] - A[0], B[1] - A[1]));
    }
    const dx = (B[0] - A[0]) / L,
      dz = (B[1] - A[1]) / L,
      off = R[c.ri].c === 2 ? 1.4 : 2;
    const tx = A[0] + dx * c.t - dz * off,
      tz = A[1] + dz * c.t + dx * off,
      k = c.first ? 1 : Math.min(1, dt * 7);
    c.x += (tx - c.x) * k;
    c.z += (tz - c.z) * k;
    c.h = c.first ? Math.atan2(dx, -dz) : c.h + wrap(Math.atan2(dx, -dz) - c.h) * Math.min(1, dt * 5);
    c.first = false;
    this.g.placeCar(c);
  }
  // shared driving model for the player and the police; only the player passes canDrift
  drive(c: Car, thr: number, steer: number, brake: boolean, dt: number, canDrift = false) {
    const { roads, buildings, water, half: HALF, crash, rammed, placeCar } = this.g,
      cars = this.cars;
    c.thr = thr = Math.abs(thr - c.thr) < 0.02 ? thr : approach(c.thr, thr, c.T.handling.throttleResponseS, dt);
    c.st = approach(c.st, steer, c.T.handling.steerResponseS, dt); // weight: speed and heading answer a little late
    if (wrecked(c)) {
      thr = c.thr = 0;
      c.boost = 0;
    } // the engine is dead: it only rolls to a stop
    const road = roads.nearestRoad(c.x, c.z).d < 0.6;
    c.wet = water.inWater(c.x, c.z);
    if (c.drift) {
      if (!brake || c.v < DRIFT_KEEP_V || c.wet) {
        const t = c.charge > TURBO_AT[1] ? 1 : c.charge > TURBO_AT[0] ? 0 : -1;
        if (!brake && t >= 0) c.boost = TURBO_S[t];
        c.drift = 0;
        c.loose = RECOVER_S;
        c.spin = c.yr;
      }
    } else if (canDrift && brake && c.v > DRIFT_MIN_V && Math.abs(steer) > 0.3 && !c.wet) {
      c.drift = Math.sign(steer);
      c.charge = 0;
    }
    if (canDrift) {
      c.flickT += dt;
      if (Math.abs(steer) > 0.5) {
        const d = Math.sign(steer); // throwing the weight left-right-left breaks the rear loose a little more each time
        if (
          d !== c.flickDir &&
          c.flickT < FLICK_S &&
          c.flickHeld >= FLICK_LOAD_S &&
          c.v > DRIFT_MIN_V &&
          !c.drift &&
          !c.wet
        ) {
          c.loose = Math.min(RECOVER_S, c.loose + FLICK_LOOSE);
          c.spin = d * (Math.abs(c.yr) + (FLICK_SPIN * c.loose) / RECOVER_S);
        }
        c.flickHeld = d === c.flickDir && c.flickT < FLICK_S ? c.flickHeld + dt : 0;
        c.flickDir = d;
        c.flickT = 0;
      }
    }
    if (c.drift) {
      c.v += ((thr > 0 ? c.T.acc * DRIFT_THR * thr : 0) - DRIFT_DRAG) * dt;
      if (Math.abs(c.slip) > 0.25) c.charge += dt;
    } else if (brake) c.v -= Math.sign(c.v) * Math.min(Math.abs(c.v), BRAKE_MS2 * dt);
    else if (c.loose > 0 && Math.abs(c.slip) > 0.1 && c.v > DRIFT_KEEP_V)
      c.v += ((thr > 0 ? c.T.acc * DRIFT_THR * thr : 0) - DRIFT_DRAG) * dt; // still scrubbing sideways, or tapping Space would beat holding it
    else if (thr > 0) c.v += (c.v < 0 ? COUNTER_MS2 : c.T.acc * (1 - (0.6 * Math.max(0, c.v)) / c.T.max)) * thr * dt;
    else if (thr < 0) c.v += (c.v > 0.5 ? COUNTER_MS2 : c.T.acc * 0.6) * thr * dt;
    else c.v -= Math.sign(c.v) * Math.min(Math.abs(c.v), (road ? 2 : 5) * dt);
    if (c.boost > 0) {
      c.boost -= dt;
      if (c.wet) c.boost = 0;
    } // water puts the turbo out
    const max = (c.wet ? 2.5 : c.T.max * (road ? 1 : c.T.off)) * (c.boost > 0 ? TURBO_TOP : 1) * topSpeedShare(c.dmg);
    if (c.boost > 0 && c.v < max) c.v = Math.min(max, c.v + TURBO_ACC * dt); // only up to the limit, so it never cancels the overspeed braking below
    if (c.v > max) c.v = Math.max(max, c.v - 14 * dt);
    if (c.v < -7) c.v = -7;
    const s = c.drift ? c.drift * (0.6 + 0.4 * c.st * c.drift) : c.st; // in a drift the nose always swings the drift's way; steering tightens or widens it
    c.yr = yawRate(c.v, s, c.T.handling.wheelbaseM) * (c.drift ? DRIFT_YAW : 1); // rad/s
    const h0 = c.h;
    if (c.loose > 0) {
      c.loose -= dt;
      c.spin *= Math.exp(-SPIN_DECAY * dt);
    } else c.spin = 0;
    c.h = wrap(c.h + (c.yr * c.spin > 0 ? (Math.abs(c.yr) > Math.abs(c.spin) ? c.yr : c.spin) : c.yr + c.spin) * dt); // steering into the slide doesn't stack on the carried yaw; counter-steer cancels it
    const grip = c.drift
      ? DRIFT_GRIP
      : c.loose > 0
        ? DRIFT_GRIP + (GRIP - DRIFT_GRIP) * (1 - c.loose / RECOVER_S) ** 2
        : GRIP; // rear grip comes back slowly, so the slide carries on
    if (canDrift) {
      const fix = wrap(c.h - c.vh) * Math.min(1, grip * dt),
        k = c.loose > 0 ? CATCH * Math.max(0, -steer * Math.sign(c.slip)) : 0;
      c.h = wrap(c.h - fix * k);
      c.vh = wrap(c.vh + fix * (1 - k)); // counter-steer catches the slide: the car straightens along its line instead of carving on
      c.slip = clamp(wrap(c.h - c.vh), -DRIFT_MAX_SLIP, DRIFT_MAX_SLIP);
      c.vh = wrap(c.h - c.slip);
    } else {
      c.vh = c.h;
      c.slip = 0;
    }
    if (!c.drift && c.loose <= 0) {
      const p = rearPivotShift(h0, c.h, c.T.handling.rearAxleM, _pivot);
      c.x += p.dx;
      c.z += p.dz;
    } // gripping, the car turns about its rear axle; sliding, the rear swings out instead
    c.x += Math.sin(c.vh) * c.v * dt;
    c.z -= Math.cos(c.vh) * c.v * dt;
    c.x = clamp(c.x, -HALF + 4, HALF - 4);
    c.z = clamp(c.z, -HALF + 4, HALF - 4);
    const vx = Math.sin(c.vh) * c.v,
      vz = -Math.cos(c.vh) * c.v,
      bx = c.x,
      bz = c.z; // velocity and place before any hit: the push out gives the hit's normal
    if (buildings.collide(c, 1.5)) {
      const nx = c.x - bx,
        nz = c.z - bz,
        L = Math.hypot(nx, nz);
      if (L > 1e-6) crash(c, null, impactSpeed(vx, vz, nx / L, nz / L));
      c.v *= 0.02 ** dt;
      c.drift = c.loose = c.boost = 0;
    } // a wall ends the slide, and the turbo with it (charged or firing)
    for (const o of cars) {
      if (o === c) continue;
      const dx = c.x - o.x,
        dz = c.z - o.z,
        d = Math.hypot(dx, dz);
      if (d < 2.7 && d > 0.01) {
        const push = 2.7 - d,
          oh = o.mode === 'ai' ? o.h : o.vh; // traffic steers by h alone
        crash(c, o, impactSpeed(vx - Math.sin(oh) * o.v, vz + Math.cos(oh) * o.v, dx / d, dz / d));
        c.x += (dx / d) * push;
        c.z += (dz / d) * push;
        if (Math.abs(c.v) > 6 && o.mode === 'police') rammed(c, o);
        if (o.mode === 'parked' || o.mode === 'idle') {
          o.x -= (dx / d) * push * 0.4;
          o.z -= (dz / d) * push * 0.4;
          placeCar(o);
        }
        c.v *= 0.05 ** dt;
      }
    }
    placeCar(c);
  }
}
