// Shots (#17, lab: pickadoll): the weapons, how a shot flies and what it hits. A proof of concept for trying weapons
// and ammo side by side: the weapon decides how a shot is delivered, the ammo (./ammo.ts) what it does on landing.
// Plain data and functions: no three.js, no DOM.
import type { CarMode } from '../cars';
import { AmmoId, type AmmoRule } from './ammo';
import { bodyRadius, type CarBody, nearestOnSpine, PERSON_RADIUS_M } from './car-body';
import { SurfaceKind } from './physics-world';

/** The weapons, by the id the lab's `weapon` command and the test hook use. */
export const WeaponId = {
  ARTPUFFRA: 'artpuffra',
  PICKADOLL: 'pickadoll',
  PEPPRAPUFFRA: 'pepprapuffra',
  HAGELBOSSA: 'hagelbossa',
  MINIGUN: 'minigun',
  GULDARTPUFFRA: 'guldartpuffra',
  KNALLEN: 'knallen',
  LUFTGEVAR: 'luftgevar',
  ALGSTUDSARE: 'algstudsare',
  GRANAT: 'granat',
  FOTANGLAR: 'fotanglar',
} as const;
export type WeaponId = (typeof WeaponId)[keyof typeof WeaponId];

/** How a weapon delivers its shots, and which ammo it fires (AmmoRule: null for every ammo any weapon fires). */
export interface Weapon extends AmmoRule {
  id: WeaponId;
  name: string;
  speedMs: number; // muzzle speed
  coolS: number; // between shots
  auto: boolean; // fires for as long as the trigger is held
  pellets: number; // shots per pull
  spreadRad: number; // each shot leaves within this angle of the aim
  shotMassKg: number; // what a shot weighs, at the game's scale, not a real bullet's: times speedMs, the push its hit gives (knockbackOf)
  damage: number; // what a hit does to a car's damage, with an ammo that damages (EffectKind.DAMAGE)
  splatM: number; // radius of the mark a hit leaves
  blastM: number; // a hit also reaches everyone within this radius; 0 for none
  bounces: number; // how many times a shot bounces off the ground, a wall or a car before it stops
  thrown: boolean; // lobbed by hand, not fired
  fuseS: number; // it goes off this long after it leaves, wherever it is by then, or at once on a person; until then it only bounces and lies. 0 for none
  shotM: number; // the radius it is drawn with
  tracerM: number; // drawn as a streak this long behind it, not as a ball: for a shot too fast to see. 0 for a ball
  scope: number; // aiming looks through a scope that magnifies this many times; 0 for none
}

/**
 * The pistol ladder from #17, a scatter gun, the village-built bazooka, a minigun, a legendary, a pistol that fires as
 * fast as a real one, two rifles with a scope and two throwables.
 */
export const WEAPONS = [
  {
    id: WeaponId.ARTPUFFRA,
    name: 'Ärtpuffra',
    speedMs: 32,
    coolS: 0.08,
    auto: false,
    pellets: 1,
    spreadRad: 0.012,
    shotMassKg: 0.3125,
    damage: 0.5,
    splatM: 0.2,
    blastM: 0,
    bounces: 0,
    thrown: false,
    fuseS: 0,
    shotM: 0.07,
    tracerM: 0,
    scope: 0,
    ammo: null,
  },
  {
    id: WeaponId.PICKADOLL,
    name: 'Pickadoll',
    speedMs: 70,
    coolS: 0.1,
    auto: false,
    pellets: 1,
    spreadRad: 0.006,
    shotMassKg: 0.571,
    damage: 2,
    splatM: 0.6,
    blastM: 0,
    bounces: 0,
    thrown: false,
    fuseS: 0,
    shotM: 0.07,
    tracerM: 0,
    scope: 0,
    ammo: null,
  },
  {
    id: WeaponId.PEPPRAPUFFRA,
    name: 'Pepprapuffra',
    speedMs: 60,
    coolS: 0.07,
    auto: true,
    pellets: 1,
    spreadRad: 0.045,
    shotMassKg: 0.333,
    damage: 1,
    splatM: 0.45,
    blastM: 0,
    bounces: 0,
    thrown: false,
    fuseS: 0,
    shotM: 0.07,
    tracerM: 0,
    scope: 0,
    ammo: null,
  },
  {
    id: WeaponId.HAGELBOSSA,
    name: 'Hagelbössa',
    speedMs: 55,
    coolS: 0.8,
    auto: false,
    pellets: 8,
    spreadRad: 0.09,
    shotMassKg: 0.436,
    damage: 1.2,
    splatM: 0.4,
    blastM: 0,
    bounces: 0,
    thrown: false,
    fuseS: 0,
    shotM: 0.07,
    tracerM: 0,
    scope: 0,
    ammo: null,
  },
  {
    id: WeaponId.MINIGUN,
    name: 'Minigun',
    speedMs: 75,
    coolS: 0.03,
    auto: true,
    pellets: 1,
    spreadRad: 0.055,
    shotMassKg: 0.213,
    damage: 0.8,
    splatM: 0.38,
    blastM: 0,
    bounces: 0,
    thrown: false,
    fuseS: 0,
    shotM: 0.07,
    tracerM: 0,
    scope: 0,
    ammo: null,
  },
  // the legendary one from #17: the weakest gun, but its peas bounce
  {
    id: WeaponId.GULDARTPUFFRA,
    name: 'Guldärtpuffran',
    speedMs: 30,
    coolS: 0.08,
    auto: false,
    pellets: 1,
    spreadRad: 0.012,
    shotMassKg: 0.4,
    damage: 0.6,
    splatM: 0.24,
    blastM: 0,
    bounces: 12,
    thrown: false,
    fuseS: 0,
    shotM: 0.07,
    tracerM: 0,
    scope: 0,
    ammo: null,
  },
  // fast shots: they arrive nearly as you fire and are drawn as a streak. Knallen is the magnum: slow to fire, and
  // its push (120 N·s) knocks people flat and nudges a parked car, where the pickadoll's (40) only marks it
  {
    id: WeaponId.KNALLEN,
    name: 'Knallen',
    speedMs: 320,
    coolS: 0.6,
    auto: false,
    pellets: 1,
    spreadRad: 0.002,
    shotMassKg: 0.375,
    damage: 6,
    splatM: 0.35,
    blastM: 0,
    bounces: 0,
    thrown: false,
    fuseS: 0,
    shotM: 0.03,
    tracerM: 5,
    scope: 0,
    ammo: null,
  },
  // rifles with a scope: slow to fire, and they go where the cross is. The air rifle is the gentle one
  {
    id: WeaponId.LUFTGEVAR,
    name: 'Luftgevär',
    speedMs: 170,
    coolS: 0.7,
    auto: false,
    pellets: 1,
    spreadRad: 0.001,
    shotMassKg: 0.141,
    damage: 1.2,
    splatM: 0.15,
    blastM: 0,
    bounces: 0,
    thrown: false,
    fuseS: 0,
    shotM: 0.03,
    tracerM: 3,
    scope: 3,
    ammo: null,
  },
  // the sniper of #17: a moose rifle
  {
    id: WeaponId.ALGSTUDSARE,
    name: 'Älgstudsare',
    speedMs: 760,
    coolS: 1.4,
    auto: false,
    pellets: 1,
    spreadRad: 0,
    shotMassKg: 0.263,
    damage: 10,
    splatM: 0.5,
    blastM: 0,
    bounces: 0,
    thrown: false,
    fuseS: 0,
    shotM: 0.04,
    tracerM: 14,
    scope: 8,
    ammo: null,
  },
  // throwables (#17): lobbed by hand
  {
    id: WeaponId.GRANAT,
    name: 'Granat',
    speedMs: 15,
    coolS: 0.9,
    auto: false,
    pellets: 1,
    spreadRad: 0.01,
    shotMassKg: 8,
    damage: 6,
    splatM: 1.8,
    blastM: 5,
    bounces: 6,
    thrown: true,
    fuseS: 2.2,
    shotM: 0.13,
    tracerM: 0,
    scope: 0,
    ammo: null,
  },
  {
    id: WeaponId.FOTANGLAR,
    name: 'Fotanglar',
    speedMs: 11,
    coolS: 1,
    auto: false,
    pellets: 7,
    spreadRad: 0.16,
    shotMassKg: 0,
    damage: 0,
    splatM: 0,
    blastM: 0,
    bounces: 0,
    thrown: true,
    fuseS: 0,
    shotM: 0.1,
    tracerM: 0,
    scope: 0,
    ammo: [AmmoId.FOTANGLAR],
  },
] as const satisfies readonly Weapon[];

export const GRAVITY_MS2 = 9.8;
export const MUZZLE_M = 1.35; // a shot leaves this far above the shooter's feet
const RANGE_S = 4; // a shot that has hit nothing by then is gone; a bounce starts the count again
const BOUNCE_KEEP = 0.78, // the share of its speed a shot keeps in a bounce
  THROWN_BOUNCE_KEEP = 0.4, // and a thrown thing, which thuds: it lands near where it was thrown at
  BOUNCE_MIN_MS = 4, // slower than this after a bounce, it stops there
  BOUNCE_CLEAR_M = 0.08; // a bounced shot starts this far off the surface, so it isn't hit again at once
// These checks are a stand-in until the physics world's ray casts take over (#54, ?lab=rapier), so they are kept
// simple and their known limits left: a wall thinner than STEP_M minus twice WALL_PROBE_M, such as a bridge's railing
// (a line), can be passed between two checks; every check tests every person and car; and the line of sight
// (sight) checks every STEP_M, some 640 checks a frame and 1,680 through a scope.
const STEP_M = 0.25; // a shot is checked every this far along its path, so it can't skip through a person
const CAST_STEP_M = 2; // with a world's ray cast, a shot's path is cast in straight pieces this long: its arc bends little over one
const WALL_MAX_M = 9; // houses are taken to be this tall: a shot above it flies over
const PERSON_TALL_M = 1.85; // a standard person, to the top of the head
const CAR_TALL_M = 1.5;
const HEAD_FROM_K = 0.83, // a hit this share of a person's height up, or higher, is on the head: from 1.54 m on a 1.85 m person
  HEAD_SIDE_M = 0.15; // and no further than this from their middle, across the shot's way: past it is a shoulder
const WALL_PROBE_M = 0.05; // the radius of the circle that feels for a wall
const SLOPE_STEP_M = 0.5; // the ground's slope where a shot lands is read over this distance
const AIM_ROUNDS = 4; // aimAtMoving: the drift and the time in the air settle each other in this many rounds
export const SHOTS_MAX = 256; // in the air at once

/** One shot in the air. Metres and m/s; y is up. */
export interface Shot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ageS: number;
  weapon: number; // index in WEAPONS
  bounced: number; // times it has bounced so far
  lifeS: number; // s since it left, bounces and all: the fuse counts this
  lying: boolean; // a shot with a fuse that has come to rest, waiting for it
}

/** What a shot can hit. */
export interface ShotWorld {
  groundAt(x: number, z: number): number;
  /** pushes the circle `o` (radius r, m) out of any house it overlaps, true on contact: BuildingIndex.collide */
  collide(o: { x: number; z: number }, r: number): boolean;
  /** who stands in the way: `scale` is their size, 1 for the standard person; `down` ones lie on the ground and aren't hit */
  people: readonly { x: number; z: number; scale: number; down?: boolean }[];
  cars: readonly CarBody[];
  /**
   * What the straight line from (x0, y0, z0) to (x1, y1, z1) meets first, written to `out`, or null: a physics world's
   * ray cast (?lab=rapier, shot-physics.ts). With it, shots and the line of sight ask it instead of the checks below,
   * and the ground as drawn still stops a shot it would let through. Without it, those checks find the hit.
   */
  cast?(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, out: ShotHit): ShotHit | null;
}

/**
 * what a shot can land on, the kinds a physics world's ray cast meets: a prop is street furniture, which only a world
 * with a ray cast holds
 */
export const HitKind = SurfaceKind;
export type HitKind = SurfaceKind;

/** Where a shot landed, on what, and how it was flying. `n` is the surface's normal; `d` the way the shot flew along the ground. */
export interface ShotHit {
  kind: HitKind;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  dx: number;
  dz: number;
  /** index in world.people or world.cars for a person or a car, the prop's number for a prop, else -1 */
  target: number;
  /** the shot bounced off and flies on; false when it stopped here */
  fliesOn: boolean;
  /** its fuse ran out here: it goes off, in the air or on the ground */
  wentOff: boolean;
}

/**
 * The speed a shot leaves with: `yaw` is the heading (0 is north, as the camera's), `pitch` radians above the horizon,
 * and `spreadYaw` and `spreadPitch` what the weapon's spread adds, each -1..1 times its spreadRad. Written to `out`
 * when one is passed, so aiming every frame allocates nothing.
 */
export function aimShot(
  weapon: Weapon,
  yaw: number,
  pitch: number,
  spreadYaw = 0,
  spreadPitch = 0,
  out: { vx: number; vy: number; vz: number } = { vx: 0, vy: 0, vz: 0 },
) {
  const y = yaw + spreadYaw * weapon.spreadRad,
    p = pitch + spreadPitch * weapon.spreadRad,
    flat = Math.cos(p) * weapon.speedMs;
  out.vx = Math.sin(y) * flat;
  out.vy = Math.sin(p) * weapon.speedMs;
  out.vz = -Math.cos(y) * flat;
  return out;
}

const _probe = { x: 0, z: 0 },
  _onCar = { x: 0, z: 0 };

/** The push a weapon's hit gives, in N·s: what its shot weighs times the speed it leaves at. A faster weapon pushes harder. */
export const knockbackOf = (w: Pick<Weapon, 'shotMassKg' | 'speedMs'>) => w.shotMassKg * w.speedMs;

const CAR_HOLD_NS = 60, // a parked car's brakes hold against a smaller push: a light shot marks it, a magnum's or a rifle's shoves it
  CAR_SLIDE_M_PER_NS = 0.0035; // past that, it slides this far for each N·s of the push

/**
 * A hit `upM` above a person's feet, `sideM` to the side of their middle (across the shot's way), is on their head;
 * `scale` is their size, 1 for the standard person.
 */
export function onHead(upM: number, sideM: number, scale: number): boolean {
  return upM >= HEAD_FROM_K * PERSON_TALL_M * scale && Math.abs(sideM) <= HEAD_SIDE_M * scale;
}

/**
 * A parked car pushed along (dx, dz) by `knockbackNs`: it slides when the push beats its brakes. A car that drives stays
 * where its driving puts it. True when the car moved, so whoever draws it places it again.
 */
export function slideCar(
  c: { x: number; z: number; mode: CarMode },
  dx: number,
  dz: number,
  knockbackNs: number,
): boolean {
  if (c.mode !== 'parked' || knockbackNs < CAR_HOLD_NS) return false;
  c.x += dx * knockbackNs * CAR_SLIDE_M_PER_NS;
  c.z += dz * knockbackNs * CAR_SLIDE_M_PER_NS;
  return true;
}

/** What a step did to a shot (stepShot). */
export const ShotStep = { FLYING: 'flying', HIT: 'hit', GONE: 'gone' } as const;
export type ShotStep = (typeof ShotStep)[keyof typeof ShotStep];

/**
 * Moves a shot on by dt seconds: HIT when it hit something or went off, which `out` then describes, GONE when it
 * ran out of range, and FLYING while it still flies, or lies until its fuse runs out.
 */
export function stepShot(s: Shot, dt: number, world: ShotWorld, out: ShotHit): ShotStep {
  const fuseS = WEAPONS[s.weapon].fuseS;
  out.wentOff = false;
  if (s.lying) {
    s.lifeS += dt;
    if (s.lifeS < fuseS) return ShotStep.FLYING;
    burst(s, world, out);
    return ShotStep.HIT;
  }
  const { cast } = world,
    speed = Math.hypot(s.vx, s.vy, s.vz),
    steps = Math.max(1, Math.ceil((speed * dt) / (cast ? CAST_STEP_M : STEP_M))),
    h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.lifeS += h;
    if (fuseS && s.lifeS >= fuseS) {
      burst(s, world, out);
      return ShotStep.HIT;
    }
    const x0 = s.x,
      y0 = s.y,
      z0 = s.z;
    s.vy -= GRAVITY_MS2 * h;
    s.x += s.vx * h;
    s.y += s.vy * h;
    s.z += s.vz * h;
    s.ageS += h;
    const hit = cast ? (cast(x0, y0, z0, s.x, s.y, s.z, out) ?? groundBelow(s, world, out)) : hitAt(s, world, out);
    if (hit) {
      hit.fliesOn = bounce(s, hit);
      // a shot with a fuse that is out of bounces or speed lies where it stopped until the fuse runs out
      if (!hit.fliesOn && fuseS && hit.kind !== HitKind.PERSON) {
        s.x = hit.x + hit.nx * BOUNCE_CLEAR_M;
        s.z = hit.z + hit.nz * BOUNCE_CLEAR_M;
        s.y = world.groundAt(s.x, s.z);
        s.vx = s.vy = s.vz = 0;
        s.lying = true;
        hit.fliesOn = true;
      }
      return ShotStep.HIT;
    }
    if (s.ageS > RANGE_S) return ShotStep.GONE;
  }
  return ShotStep.FLYING;
}

// the fuse ran out: it goes off where it is, and what it leaves lands on the ground below
function burst(s: Shot, world: ShotWorld, out: ShotHit) {
  surface(out, HitKind.GROUND, -1, 0, 1, 0);
  out.x = s.x;
  out.y = world.groundAt(s.x, s.z);
  out.z = s.z;
  out.dx = 0;
  out.dz = -1;
  out.fliesOn = false;
  out.wentOff = true;
}

// off the ground, a wall or a car, if its weapon's shots bounce and it has bounces and speed left: the shot is turned
// back from the surface and flies on from it. People stop a shot.
function bounce(s: Shot, hit: ShotHit): boolean {
  if (hit.kind === HitKind.PERSON || s.bounced >= WEAPONS[s.weapon].bounces) return false;
  const into = s.vx * hit.nx + s.vy * hit.ny + s.vz * hit.nz;
  if (into >= 0) return false; // already leaving the surface
  const keep = WEAPONS[s.weapon].thrown ? THROWN_BOUNCE_KEEP : BOUNCE_KEEP;
  s.vx = (s.vx - 2 * into * hit.nx) * keep;
  s.vy = (s.vy - 2 * into * hit.ny) * keep;
  s.vz = (s.vz - 2 * into * hit.nz) * keep;
  if (Math.hypot(s.vx, s.vy, s.vz) < BOUNCE_MIN_MS) return false;
  s.x = hit.x + hit.nx * BOUNCE_CLEAR_M;
  s.y = hit.y + hit.ny * BOUNCE_CLEAR_M;
  s.z = hit.z + hit.nz * BOUNCE_CLEAR_M;
  s.bounced++;
  s.ageS = 0;
  return true;
}

// what the shot touches where it is now, if anything. `people` and `cars` narrow it to those indices in the world's lists
function hitAt(
  s: Shot,
  world: ShotWorld,
  out: ShotHit,
  people?: readonly number[],
  cars?: readonly number[],
): ShotHit | null {
  at(s, out);
  const up = s.y - world.groundAt(s.x, s.z);
  for (let k = 0, n = people ? people.length : world.people.length; k < n; k++) {
    const i = people ? people[k] : k,
      p = world.people[i];
    if (p.down || up > PERSON_TALL_M * p.scale) continue;
    if (Math.hypot(p.x - s.x, p.z - s.z) > PERSON_RADIUS_M * p.scale) continue;
    return surface(out, HitKind.PERSON, i, -out.dx, 0, -out.dz);
  }
  if (up < CAR_TALL_M)
    for (let k = 0, n = cars ? cars.length : world.cars.length; k < n; k++) {
      const i = cars ? cars[k] : k,
        c = world.cars[i];
      if (Math.abs(c.x - s.x) > c.T.lengthM || Math.abs(c.z - s.z) > c.T.lengthM) continue;
      nearestOnSpine(c, s.x, s.z, _onCar);
      const ex = s.x - _onCar.x,
        ez = s.z - _onCar.z,
        d = Math.hypot(ex, ez);
      if (d > bodyRadius(c)) continue;
      // on the body's side, not where the shot was noticed, up to a step inside it
      const nx = d > 0.01 ? ex / d : -out.dx,
        nz = d > 0.01 ? ez / d : -out.dz;
      out.x = _onCar.x + nx * bodyRadius(c);
      out.z = _onCar.z + nz * bodyRadius(c);
      return surface(out, HitKind.CAR, i, nx, 0, nz);
    }
  if (up <= 0) return onGround(s, world, out, up, STEP_M);
  if (up < WALL_MAX_M) {
    _probe.x = s.x;
    _probe.z = s.z;
    if (world.collide(_probe, WALL_PROBE_M)) {
      // the way the wall pushed the probe out is the way it faces
      const ex = _probe.x - s.x,
        ez = _probe.z - s.z,
        d = Math.hypot(ex, ez);
      const nx = d > 1e-4 ? ex / d : -out.dx,
        nz = d > 1e-4 ? ez / d : -out.dz;
      // on the wall's face: the probe ends its own radius outside it
      out.x = _probe.x - nx * WALL_PROBE_M;
      out.z = _probe.z - nz * WALL_PROBE_M;
      return surface(out, HitKind.WALL, -1, nx, 0, nz);
    }
  }
  return null;
}

// where the shot is now, and the way it flies along the ground, before what it met is known
function at(s: Shot, out: ShotHit) {
  const flat = Math.hypot(s.vx, s.vz) || 1;
  out.x = s.x;
  out.y = s.y;
  out.z = s.z;
  out.dx = s.vx / flat;
  out.dz = s.vz / flat;
  out.target = -1;
}

// the ground as drawn, for a shot a world's ray cast let through: that ground is coarser, and has no curbs
function groundBelow(s: Shot, world: ShotWorld, out: ShotHit): ShotHit | null {
  const up = s.y - world.groundAt(s.x, s.z);
  if (up > 0) return null;
  at(s, out);
  return onGround(s, world, out, up, CAST_STEP_M);
}

// a shot `up` metres above the ground, at or below it: back along its path, at most the `stepM` it last moved, to
// where it met the ground
function onGround(s: Shot, world: ShotWorld, out: ShotHit, up: number, stepM: number): ShotHit {
  const pastS = s.vy < 0 ? Math.min(up / s.vy, stepM / (Math.hypot(s.vx, s.vy, s.vz) || 1)) : 0;
  out.x = s.x - s.vx * pastS;
  out.z = s.z - s.vz * pastS;
  out.y = world.groundAt(out.x, out.z);
  // the way the ground faces there: on a slope a shot bounces off the slope, not off level ground
  const d = SLOPE_STEP_M,
    sx = world.groundAt(out.x - d, out.z) - world.groundAt(out.x + d, out.z),
    sz = world.groundAt(out.x, out.z - d) - world.groundAt(out.x, out.z + d),
    len = Math.hypot(sx, 2 * d, sz);
  return surface(out, HitKind.GROUND, -1, sx / len, (2 * d) / len, sz / len);
}

function surface(out: ShotHit, kind: HitKind, target: number, nx: number, ny: number, nz: number): ShotHit {
  out.kind = kind;
  out.target = target;
  out.nx = nx;
  out.ny = ny;
  out.nz = nz;
  return out;
}

export const newHit = (): ShotHit => ({
  kind: HitKind.GROUND,
  x: 0,
  y: 0,
  z: 0,
  nx: 0,
  ny: 1,
  nz: 0,
  dx: 0,
  dz: -1,
  target: -1,
  fliesOn: false,
  wentOff: false,
});

/**
 * The path a shot would fly: where it is every `stepS` seconds, as x, y, z after each other in `out`, at most `max`
 * points, until it stops, goes off or is out of range. `s` is flown there, so pass a shot made for it. Returns the
 * number of points; the last one is where it ends, which `end` also holds.
 */
export function flightPath(s: Shot, world: ShotWorld, stepS: number, max: number, out: number[], end: ShotHit): number {
  let n = 0;
  while (n < max - 1) {
    out[n * 3] = s.x;
    out[n * 3 + 1] = s.y;
    out[n * 3 + 2] = s.z;
    n++;
    const step = stepShot(s, stepS, world, end);
    if (step === ShotStep.GONE) return n;
    if (s.lying) {
      // where a shot with a fuse comes to rest is where it will go off
      end.x = s.x;
      end.y = s.y;
      end.z = s.z;
      break;
    }
    if (step === ShotStep.HIT && !end.fliesOn) break;
  }
  out[n * 3] = end.x;
  out[n * 3 + 1] = end.y;
  out[n * 3 + 2] = end.z;
  return n + 1;
}

/**
 * Whether a blast of `blastM` metres at (cx, cz) reaches (x, z), along the ground. Writes the way it pushes what stands
 * there to `out`, a unit vector away from the middle; at the very middle that is north, so nobody is left standing.
 */
export function blastPush(
  cx: number,
  cz: number,
  blastM: number,
  x: number,
  z: number,
  out: { dx: number; dz: number },
) {
  const ex = x - cx,
    ez = z - cz,
    d = Math.hypot(ex, ez);
  if (d > blastM) return false;
  out.dx = d > 0.01 ? ex / d : 0;
  out.dz = d > 0.01 ? ez / d : -1;
  return true;
}

const _nearPeople: number[] = [],
  _nearCars: number[] = [];
const SIGHT_CAR_REACH = 1.5; // a car can be met within this many of its lengths from its middle: hitAt's box, corner to corner

// how far (x, z) is from the line from (ax, az) to (bx, bz), along the ground
function offLine(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const ex = bx - ax,
    ez = bz - az,
    len2 = ex * ex + ez * ez,
    t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / len2)) : 0;
  return Math.hypot(x - ax - ex * t, z - az - ez * t);
}

const _sight: Shot = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ageS: 0, weapon: 0, bounced: 0, lifeS: 0, lying: false };

/**
 * What a straight line of sight meets: from (x, y, z) along the unit vector (dx, dy, dz), between `fromM` and `toM`
 * along it. The crosshair's target. Writes the point to `out` and returns true; when the line meets nothing, `out` is
 * its far end and the answer false.
 */
export function sight(
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  fromM: number,
  toM: number,
  world: ShotWorld,
  out: ShotHit,
): boolean {
  const s = _sight;
  s.vx = dx;
  s.vy = dy;
  s.vz = dz;
  if (world.cast) {
    // one straight line, which the ray cast follows to what it meets first
    if (world.cast(x + dx * fromM, y + dy * fromM, z + dz * fromM, x + dx * toM, y + dy * toM, z + dz * toM, out))
      return true;
    return miss(x, y, z, dx, dy, dz, toM, out);
  }
  // only who and what stands near the line can be met: found once, so each step along it tests a few, not everyone
  const ax = x + dx * fromM,
    az = z + dz * fromM,
    bx = x + dx * toM,
    bz = z + dz * toM;
  _nearPeople.length = _nearCars.length = 0;
  for (let i = 0; i < world.people.length; i++) {
    const p = world.people[i];
    if (!p.down && offLine(p.x, p.z, ax, az, bx, bz) <= PERSON_RADIUS_M * p.scale) _nearPeople.push(i);
  }
  for (let i = 0; i < world.cars.length; i++) {
    const c = world.cars[i];
    if (offLine(c.x, c.z, ax, az, bx, bz) <= c.T.lengthM * SIGHT_CAR_REACH) _nearCars.push(i);
  }
  for (let d = fromM; d <= toM; d += STEP_M) {
    s.x = x + dx * d;
    s.y = y + dy * d;
    s.z = z + dz * d;
    if (hitAt(s, world, out, _nearPeople, _nearCars)) return true;
  }
  return miss(x, y, z, dx, dy, dz, toM, out);
}

// the line of sight met nothing: `out` is its far end
function miss(x: number, y: number, z: number, dx: number, dy: number, dz: number, toM: number, out: ShotHit) {
  surface(out, HitKind.GROUND, -1, 0, 1, 0);
  out.x = x + dx * toM;
  out.y = y + dy * toM;
  out.z = z + dz * toM;
  return false;
}

/**
 * The yaw and pitch that send a shot at `speedMs` from (x, y, z) through (tx, ty, tz), allowing for its drop: the
 * flattest way there. Out of reach it goes no higher than it must: along the line to the point, or, where that is
 * lower, as high as just reaches that far on level ground. The second meets the flattest way at the edge of reach,
 * so the aim doesn't jump as the crosshair crosses it, and the sky gets the line's own pitch, not a 45° lob.
 */
export function aimAt(
  speedMs: number,
  x: number,
  y: number,
  z: number,
  tx: number,
  ty: number,
  tz: number,
  out: { yaw: number; pitch: number },
) {
  const fx = tx - x,
    fz = tz - z,
    flat = Math.hypot(fx, fz),
    up = ty - y,
    v2 = speedMs * speedMs,
    reach = v2 * v2 - GRAVITY_MS2 * (GRAVITY_MS2 * flat * flat + 2 * up * v2);
  out.yaw = Math.atan2(fx, -fz);
  out.pitch =
    flat < 0.01
      ? Math.sign(up) * (Math.PI / 2)
      : reach < 0
        ? Math.max(Math.atan2(up, flat), Math.atan(v2 / (GRAVITY_MS2 * flat)))
        : Math.atan((v2 - Math.sqrt(reach)) / (GRAVITY_MS2 * flat));
  return out;
}

/**
 * `aimAt` for a shooter that moves along the ground at (vx, vz) m/s, as from a car: the shot keeps that speed on top of
 * its own, so it is aimed at where the point is once the drift is taken off. Out of reach when the shooter drives away
 * from the point faster than the shot flies.
 */
export function aimAtMoving(
  speedMs: number,
  x: number,
  y: number,
  z: number,
  tx: number,
  ty: number,
  tz: number,
  vx: number,
  vz: number,
  out: { yaw: number; pitch: number },
) {
  let ax = tx,
    az = tz;
  // the drift depends on the time in the air, which depends on the aim: a few rounds settle it
  for (let i = 0; (vx || vz) && i < AIM_ROUNDS; i++) {
    aimAt(speedMs, x, y, z, ax, ty, az, out);
    const airS = Math.hypot(ax - x, az - z) / Math.max(0.01, Math.cos(out.pitch) * speedMs);
    ax = tx - vx * airS;
    az = tz - vz * airS;
  }
  return aimAt(speedMs, x, y, z, ax, ty, az, out);
}

/**
 * The soft lock: the person or car nearest to where you look, by the angle from the heading `yaw`, within `coneRad`
 * of it and `rangeM` of (x, z), or null when there is none.
 */
export function assistTarget(
  x: number,
  z: number,
  yaw: number,
  world: Pick<ShotWorld, 'people' | 'cars'>,
  coneRad: number,
  rangeM: number,
): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null,
    bestOff = coneRad;
  for (let pass = 0; pass < 2; pass++) {
    const list: readonly { x: number; z: number; down?: boolean }[] = pass ? world.cars : world.people;
    for (const t of list) {
      if (t.down) continue;
      const d = Math.hypot(t.x - x, t.z - z);
      if (d > rangeM || d < 1) continue;
      const to = Math.atan2(t.x - x, -(t.z - z)),
        off = Math.abs(Math.atan2(Math.sin(to - yaw), Math.cos(to - yaw)));
      if (off < bestOff) {
        bestOff = off;
        best = t;
      }
    }
  }
  return best;
}
