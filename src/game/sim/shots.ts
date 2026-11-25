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
  bounces: number; // how many times a shot bounces off the ground, a wall or a car before it stops
  thrown: boolean; // lobbed by hand, not fired
  fuseS: number; // it goes off this long after it leaves, wherever it is by then; until then it only bounces and lies. 0 for none
  zone: '' | 'spikes'; // what it leaves on the ground where it lands: spikes are fotanglar
  shotM: number; // the radius it is drawn with
}

/** The pistol ladder from #17, a scatter gun, the village-built bazooka, a minigun, a legendary and two throwables. */
export const WEAPONS = [
  {
    id: 'artpuffra',
    name: 'Ärtpuffra',
    speedMs: 32,
    coolS: 0.08,
    auto: false,
    pellets: 1,
    spreadRad: 0.012,
    power: 0.25,
    splatM: 0.2,
    blastM: 0,
    bounces: 0,
    thrown: false,
    fuseS: 0,
    zone: '',
    shotM: 0.07,
  },
  {
    id: 'pickadoll',
    name: 'Pickadoll',
    speedMs: 70,
    coolS: 0.1,
    auto: false,
    pellets: 1,
    spreadRad: 0.006,
    power: 1,
    splatM: 0.6,
    blastM: 0,
    bounces: 0,
    thrown: false,
    fuseS: 0,
    zone: '',
    shotM: 0.07,
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
    bounces: 0,
    thrown: false,
    fuseS: 0,
    zone: '',
    shotM: 0.07,
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
    bounces: 0,
    thrown: false,
    fuseS: 0,
    zone: '',
    shotM: 0.07,
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
    bounces: 0,
    thrown: false,
    fuseS: 0,
    zone: '',
    shotM: 0.07,
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
    bounces: 0,
    thrown: false,
    fuseS: 0,
    zone: '',
    shotM: 0.07,
  },
  // the legendary one from #17: the weakest gun, but its peas bounce
  {
    id: 'guldartpuffra',
    name: 'Guldärtpuffran',
    speedMs: 30,
    coolS: 0.08,
    auto: false,
    pellets: 1,
    spreadRad: 0.012,
    power: 0.3,
    splatM: 0.24,
    blastM: 0,
    bounces: 12,
    thrown: false,
    fuseS: 0,
    zone: '',
    shotM: 0.07,
  },
  // throwables (#17): lobbed by hand
  {
    id: 'granat',
    name: 'Granat',
    speedMs: 15,
    coolS: 0.9,
    auto: false,
    pellets: 1,
    spreadRad: 0.01,
    power: 3,
    splatM: 1.8,
    blastM: 5,
    bounces: 6,
    thrown: true,
    fuseS: 2.2,
    zone: '',
    shotM: 0.13,
  },
  {
    id: 'fotanglar',
    name: 'Fotanglar',
    speedMs: 11,
    coolS: 1,
    auto: false,
    pellets: 7,
    spreadRad: 0.16,
    power: 0,
    splatM: 0,
    blastM: 0,
    bounces: 0,
    thrown: true,
    fuseS: 0,
    zone: 'spikes',
    shotM: 0.1,
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
const RANGE_S = 4; // a shot that has hit nothing by then is gone; a bounce starts the count again
const BOUNCE_KEEP = 0.78, // the share of its speed a shot keeps in a bounce
  THROWN_BOUNCE_KEEP = 0.4, // and a thrown thing, which thuds: it lands near where it was thrown at
  BOUNCE_MIN_MS = 4, // slower than this after a bounce, it stops there
  BOUNCE_CLEAR_M = 0.08; // a bounced shot starts this far off the surface, so it isn't hit again at once
const STEP_M = 0.25; // a shot is checked every this far along its path, so it can't skip through a person
const WALL_MAX_M = 9; // houses are taken to be this tall: a shot above it flies over
const PERSON_TALL_M = 1.85; // a standard person, to the top of the head
const CAR_TALL_M = 1.5;
const WALL_PROBE_M = 0.05; // the radius of the circle that feels for a wall
const SLOPE_STEP_M = 0.5; // the ground's slope where a shot lands is read over this distance
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
  /** the shot bounced off and flies on; false when it stopped here */
  bounced: boolean;
  /** its fuse ran out here: it goes off, in the air or on the ground */
  burst: boolean;
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
  const fuseS = WEAPONS[s.weapon].fuseS;
  out.burst = false;
  if (s.lying) {
    s.lifeS += dt;
    return s.lifeS >= fuseS ? burst(s, world, out) : null;
  }
  const speed = Math.hypot(s.vx, s.vy, s.vz),
    steps = Math.max(1, Math.ceil((speed * dt) / STEP_M)),
    h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.lifeS += h;
    if (fuseS && s.lifeS >= fuseS) return burst(s, world, out);
    s.vy -= GRAVITY_MS2 * h;
    s.x += s.vx * h;
    s.y += s.vy * h;
    s.z += s.vz * h;
    s.ageS += h;
    const hit = hitAt(s, world, out);
    if (hit) {
      hit.bounced = bounce(s, hit);
      // a shot with a fuse that is out of bounces or speed lies where it stopped until the fuse runs out
      if (!hit.bounced && fuseS && hit.kind !== 'person') {
        s.x = hit.x + hit.nx * BOUNCE_CLEAR_M;
        s.z = hit.z + hit.nz * BOUNCE_CLEAR_M;
        s.y = world.groundAt(s.x, s.z);
        s.vx = s.vy = s.vz = 0;
        s.lying = true;
        hit.bounced = true;
      }
      return hit;
    }
    if (s.ageS > RANGE_S) return 'gone';
  }
  return null;
}

// the fuse ran out: it goes off where it is, and what it leaves lands on the ground below
function burst(s: Shot, world: ShotWorld, out: ShotHit): ShotHit {
  surface(out, 'ground', -1, 0, 1, 0);
  out.x = s.x;
  out.y = world.groundAt(s.x, s.z);
  out.z = s.z;
  out.dx = 0;
  out.dz = -1;
  out.bounced = false;
  out.burst = true;
  return out;
}

// off the ground, a wall or a car, if its weapon's shots bounce and it has bounces and speed left: the shot is turned
// back from the surface and flies on from it. People stop a shot.
function bounce(s: Shot, hit: ShotHit): boolean {
  if (hit.kind === 'person' || s.bounced >= WEAPONS[s.weapon].bounces) return false;
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
  const flat = Math.hypot(s.vx, s.vz) || 1;
  out.x = s.x;
  out.y = s.y;
  out.z = s.z;
  out.dx = s.vx / flat;
  out.dz = s.vz / flat;
  out.target = -1;
  const ground = world.groundAt(s.x, s.z),
    up = s.y - ground;
  for (let k = 0, n = people ? people.length : world.people.length; k < n; k++) {
    const i = people ? people[k] : k,
      p = world.people[i];
    if (p.down || up > PERSON_TALL_M * p.scale) continue;
    if (Math.hypot(p.x - s.x, p.z - s.z) > PERSON_RADIUS_M * p.scale) continue;
    return surface(out, 'person', i, -out.dx, 0, -out.dz);
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
      return surface(out, 'car', i, nx, 0, nz);
    }
  if (up <= 0) {
    // back along its path to where it met the ground
    const pastS = s.vy < 0 ? Math.min(up / s.vy, STEP_M / (Math.hypot(s.vx, s.vy, s.vz) || 1)) : 0;
    out.x = s.x - s.vx * pastS;
    out.z = s.z - s.vz * pastS;
    out.y = world.groundAt(out.x, out.z);
    // the way the ground faces there: on a slope a shot bounces off the slope, not off level ground
    const d = SLOPE_STEP_M,
      sx = world.groundAt(out.x - d, out.z) - world.groundAt(out.x + d, out.z),
      sz = world.groundAt(out.x, out.z - d) - world.groundAt(out.x, out.z + d),
      len = Math.hypot(sx, 2 * d, sz);
    return surface(out, 'ground', -1, sx / len, (2 * d) / len, sz / len);
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
  bounced: false,
  burst: false,
});

/**
 * The path a shot would fly: where it is every `stepS` seconds, as x, y, z after each other in `out`, at most `max`
 * points, until it stops, goes off or is out of range. `s` is flown there, so pass a shot made for it. Returns the
 * number of points; the last one is where it ends, which `end` also holds.
 */
export function flightPath(s: Shot, world: ShotWorld, stepS: number, max: number, out: number[], end: ShotHit): number {
  let n = 0;
  const put = (x: number, y: number, z: number) => {
    out[n * 3] = x;
    out[n * 3 + 1] = y;
    out[n * 3 + 2] = z;
    n++;
  };
  while (n < max - 1) {
    put(s.x, s.y, s.z);
    const hit = stepShot(s, stepS, world, end);
    if (hit === 'gone') return n;
    if (s.lying) {
      // where a shot with a fuse comes to rest is where it will go off
      end.x = s.x;
      end.y = s.y;
      end.z = s.z;
      break;
    }
    if (hit && !hit.bounced) break;
  }
  put(end.x, end.y, end.z);
  return n;
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
const AIM_ROUNDS = 4;

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
