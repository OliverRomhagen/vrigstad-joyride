// Shots (#17, lab: pickadoll): what the weapons fire, how a shot flies and what it hits. A proof of concept for trying
// weapons and hits side by side: the weapon decides how a shot is delivered, the hit flavour what it does on landing.
// Plain data and functions: no three.js, no DOM.
import { bodyRadius, type CarBody, nearestOnSpine, PERSON_RADIUS_M } from './car-body';

/** How a weapon delivers its shots. */
export interface Weapon {
  id: string;
  name: string;
  speedMs: number; // muzzle speed
  coolS: number; // between shots
  auto: boolean; // fires for as long as the trigger is held
  pellets: number; // shots per pull
  spreadRad: number; // each shot leaves within this angle of the aim
  power: number; // how hard a hit lands; 1 is the pickadoll's
  splatM: number; // radius of the mark a hit leaves
  blastM: number; // a hit also reaches everyone within this radius; 0 for none
}

/** The pistol ladder from #17, a scatter gun, the village-built bazooka and a minigun. */
export const WEAPONS = [
  {
    id: 'artpuffra',
    name: 'Ärtpuffra',
    speedMs: 32,
    coolS: 0.22,
    auto: false,
    pellets: 1,
    spreadRad: 0.012,
    power: 0.25,
    splatM: 0.2,
    blastM: 0,
  },
  {
    id: 'pickadoll',
    name: 'Pickadoll',
    speedMs: 70,
    coolS: 0.3,
    auto: false,
    pellets: 1,
    spreadRad: 0.006,
    power: 1,
    splatM: 0.6,
    blastM: 0,
  },
  {
    id: 'pepprapuffra',
    name: 'Pepprapuffra',
    speedMs: 60,
    coolS: 0.07,
    auto: true,
    pellets: 1,
    spreadRad: 0.045,
    power: 0.5,
    splatM: 0.45,
    blastM: 0,
  },
  {
    id: 'hagelbossa',
    name: 'Hagelbössa',
    speedMs: 55,
    coolS: 0.8,
    auto: false,
    pellets: 8,
    spreadRad: 0.09,
    power: 0.6,
    splatM: 0.4,
    blastM: 0,
  },
  {
    id: 'potatiskanon',
    name: 'Potatiskanon',
    speedMs: 26,
    coolS: 1.2,
    auto: false,
    pellets: 1,
    spreadRad: 0.01,
    power: 4,
    splatM: 2.2,
    blastM: 4,
  },
  {
    id: 'minigun',
    name: 'Minigun',
    speedMs: 75,
    coolS: 0.03,
    auto: true,
    pellets: 1,
    spreadRad: 0.055,
    power: 0.4,
    splatM: 0.38,
    blastM: 0,
  },
] as const satisfies readonly Weapon[];

/** What a hit does: the answers to try side by side. */
export const HIT_FLAVOURS = [
  { id: 'gegga', name: 'Gegga' }, // a bright splat where it lands; nobody is hurt
  { id: 'pang', name: 'Pang' }, // people are thrown and cars shoved; no colour
  { id: 'dans', name: 'Dans' }, // a prank: who is hit dances for a while
] as const;
export type HitFlavour = (typeof HIT_FLAVOURS)[number]['id'];

export const GRAVITY_MS2 = 9.8;
export const MUZZLE_M = 1.35; // a shot leaves this far above the shooter's feet
const RANGE_S = 4; // a shot that has hit nothing by then is gone
const STEP_M = 0.25; // a shot is checked every this far along its path, so it can't skip through a person
const WALL_MAX_M = 9; // houses are taken to be this tall: a shot above it flies over
const PERSON_TALL_M = 1.85; // a standard person, to the top of the head
const CAR_TALL_M = 1.5;
const WALL_PROBE_M = 0.05; // the radius of the circle that feels for a wall

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
}

/** What a shot can hit. */
export interface ShotWorld {
  groundAt(x: number, z: number): number;
  /** pushes the circle `o` (radius r, m) out of any house it overlaps, true on contact: BuildingIndex.collide */
  collide(o: { x: number; z: number }, r: number): boolean;
  /** who stands in the way: `scale` is their size, 1 for the standard person; `down` ones lie on the ground and aren't hit */
  people: readonly { x: number; z: number; scale: number; down?: boolean }[];
  cars: readonly CarBody[];
}

export type HitKind = 'ground' | 'wall' | 'person' | 'car';

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
  /** index in world.people or world.cars for a person or a car, else -1 */
  target: number;
}

/**
 * The speed a shot leaves with: `yaw` is the heading (0 is north, as the camera's), `pitch` radians above the horizon,
 * and `spreadYaw` and `spreadPitch` what the weapon's spread adds, each -1..1 times its spreadRad.
 */
export function aimShot(weapon: Weapon, yaw: number, pitch: number, spreadYaw = 0, spreadPitch = 0) {
  const y = yaw + spreadYaw * weapon.spreadRad,
    p = pitch + spreadPitch * weapon.spreadRad,
    flat = Math.cos(p) * weapon.speedMs;
  return { vx: Math.sin(y) * flat, vy: Math.sin(p) * weapon.speedMs, vz: -Math.cos(y) * flat };
}

const _probe = { x: 0, z: 0 },
  _onCar = { x: 0, z: 0 };

/** Moves a shot on by dt seconds. Returns what it hit, 'gone' when it ran out of range, or null while it still flies. */
export function stepShot(s: Shot, dt: number, world: ShotWorld, out: ShotHit): ShotHit | 'gone' | null {
  const speed = Math.hypot(s.vx, s.vy, s.vz),
    steps = Math.max(1, Math.ceil((speed * dt) / STEP_M)),
    h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.vy -= GRAVITY_MS2 * h;
    s.x += s.vx * h;
    s.y += s.vy * h;
    s.z += s.vz * h;
    s.ageS += h;
    const hit = hitAt(s, world, out);
    if (hit) return hit;
    if (s.ageS > RANGE_S) return 'gone';
  }
  return null;
}

// what the shot touches where it is now, if anything
function hitAt(s: Shot, world: ShotWorld, out: ShotHit): ShotHit | null {
  const flat = Math.hypot(s.vx, s.vz) || 1;
  out.x = s.x;
  out.y = s.y;
  out.z = s.z;
  out.dx = s.vx / flat;
  out.dz = s.vz / flat;
  out.target = -1;
  const ground = world.groundAt(s.x, s.z),
    up = s.y - ground;
  for (let i = 0; i < world.people.length; i++) {
    const p = world.people[i];
    if (p.down || up > PERSON_TALL_M * p.scale) continue;
    if (Math.hypot(p.x - s.x, p.z - s.z) > PERSON_RADIUS_M * p.scale) continue;
    return surface(out, 'person', i, -out.dx, 0, -out.dz);
  }
  if (up < CAR_TALL_M)
    for (let i = 0; i < world.cars.length; i++) {
      const c = world.cars[i];
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
      return surface(out, 'car', i, nx, 0, nz);
    }
  if (up <= 0) {
    // back along its path to where it met the ground
    const pastS = s.vy < 0 ? Math.min(up / s.vy, STEP_M / (Math.hypot(s.vx, s.vy, s.vz) || 1)) : 0;
    out.x = s.x - s.vx * pastS;
    out.z = s.z - s.vz * pastS;
    out.y = world.groundAt(out.x, out.z);
    return surface(out, 'ground', -1, 0, 1, 0);
  }
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
      return surface(out, 'wall', -1, nx, 0, nz);
    }
  }
  return null;
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
  kind: 'ground',
  x: 0,
  y: 0,
  z: 0,
  nx: 0,
  ny: 1,
  nz: 0,
  dx: 0,
  dz: -1,
  target: -1,
});

const _sight: Shot = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ageS: 0, weapon: 0 };

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
  for (let d = fromM; d <= toM; d += STEP_M) {
    s.x = x + dx * d;
    s.y = y + dy * d;
    s.z = z + dz * d;
    if (hitAt(s, world, out)) return true;
  }
  surface(out, 'ground', -1, 0, 1, 0);
  out.x = x + dx * toM;
  out.y = y + dy * toM;
  out.z = z + dz * toM;
  return false;
}

/**
 * The yaw and pitch that send a shot at `speedMs` from (x, y, z) through (tx, ty, tz), allowing for its drop: the
 * flattest way there, or 45° up when the point is out of reach.
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
        ? Math.PI / 4
        : Math.atan((v2 - Math.sqrt(reach)) / (GRAVITY_MS2 * flat));
  return out;
}

/**
 * The soft lock: the nearest person or car within `coneRad` of the heading `yaw` and `rangeM` of (x, z), or null
 * when there is none.
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
