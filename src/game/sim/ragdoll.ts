// Ragdoll physics for a person knocked over by a car (#35). Plain data and functions, no three.js:
// a person is nine points joined by sticks of fixed length (Verlet integration on a fixed timestep), so it tumbles,
// bounces off the ground and the house walls, lies still for a moment, and then gets back up.

/** The points, by index into `Ragdoll.pos` (three numbers each: x, y, z in metres). */
export const HEAD = 0,
  L_SHOULDER = 1,
  R_SHOULDER = 2,
  L_HIP = 3,
  R_HIP = 4,
  L_HAND = 5,
  R_HAND = 6,
  L_FOOT = 7,
  R_FOOT = 8;
export const POINTS = 9;

// Standing, in the person's frame (x to their right, y up, z behind them; m): the same proportions as personParts in src/game/render/models.ts.
const POSE: readonly (readonly [number, number, number])[] = [
  [0, 1.62, 0],
  [-0.33, 1.42, 0],
  [0.33, 1.42, 0],
  [-0.13, 0.8, 0],
  [0.13, 0.8, 0],
  [-0.33, 0.82, 0],
  [0.33, 0.82, 0],
  [-0.13, 0.02, 0],
  [0.13, 0.02, 0],
];

// The torso is a braced box (both diagonals), the head is held to it from all four corners, and each limb is one stick.
const STICKS: readonly (readonly [number, number])[] = [
  [L_SHOULDER, R_SHOULDER],
  [L_HIP, R_HIP],
  [L_SHOULDER, L_HIP],
  [R_SHOULDER, R_HIP],
  [L_SHOULDER, R_HIP],
  [R_SHOULDER, L_HIP],
  [HEAD, L_SHOULDER],
  [HEAD, R_SHOULDER],
  [HEAD, L_HIP],
  [HEAD, R_HIP],
  [L_SHOULDER, L_HAND],
  [R_SHOULDER, R_HAND],
  [L_HIP, L_FOOT],
  [R_HIP, R_FOOT],
];
const REST = STICKS.map(([a, b]) =>
  Math.hypot(POSE[a][0] - POSE[b][0], POSE[a][1] - POSE[b][1], POSE[a][2] - POSE[b][2]),
);

export const STEP_S = 1 / 60; // fixed physics step (s)
export const HIT_MIN_MS = 15 / 3.6; // slower than this (m/s) a car only pushes people aside, as before (#35: ~15 km/h)
const LAUNCH_MAX_MS = 22; // the launch stops growing with the car's speed here (m/s), so nobody leaves the map
const GRAVITY_MS2 = 16; // the player's jump gravity (GRAVITY_MS2 in src/game/player.ts), so a ragdoll falls as a hop does
const AIR_KEEP = 0.998; // share of its speed a point keeps per step in the air
const GROUND_KEEP = 0.86; // share of its sliding speed a point on the ground keeps per step
const BOUNCE = 0.3; // share of its falling speed a point keeps as it bounces up
const POINT_R_M = 0.1; // how far a point stays above the ground and out of walls (m)
const ITERATIONS = 8; // stick passes per step: more is stiffer
const SETTLE_MS = 0.6,
  SETTLE_S = 0.4; // lying down: every point slower than SETTLE_MS (m/s) for SETTLE_S (s)
const FLY_MAX_S = 6; // lies down after this long (s) even if still sliding
const LIE_S = 2.5; // lies still for this long (s) before getting up
const GETUP_S = 0.9; // getting up takes this long (s)
const PUSH_HEIGHT_M = 1.6; // a car shoves points lower than this above the ground (m)
const PUSH_KICK_MS = 10; // a shove gives a point at most this much speed (m/s); a faster car drives over them
const HIT_SIDE_M = 1.25; // further than this to the side of the car's middle (m) the bumper misses: half the car (0.9) and a person (0.35)
// the throw, as shares of the launch speed: the feet go fastest and the head lags, so they tip back over the bonnet
const HEAD_KEEP = 0.65,
  FEET_KEEP = 1.05; // forward
const LIFT_MS = 1.5,
  HEAD_LIFT = 0.18,
  FEET_LIFT = 0.3; // up: LIFT_MS (m/s) plus a share
const AWAY_SPREAD_M = 1.5; // standing this far to one side of the car's middle (m) throws them furthest that way
const AWAY_KEEP = 0.25,
  AWAY_JITTER = 0.15; // sideways: the share at AWAY_SPREAD_M, and the most the jitter adds or takes
// how one throw differs from the next, each from its own roll: the most each adds or takes
const SPIN_MAX_RADS = 6; // turning about the up axis as they fly (rad/s), so they twist as well as flip
const CARTWHEEL_MAX_RADS = 5; // turning about the way they are thrown (rad/s)
const FLIP_SPREAD = 0.5; // share of the head-to-feet speed gap: a slow topple at -, a fast backflip at +
const LIFT_SPREAD = 0.3; // share of the lift: some skid low, some fly high
const LIMB_KICK_MS = 2.5; // a hand or foot's own kick (m/s, each way), so the limbs flail differently
const HANDS_AND_FEET = [L_HAND, R_HAND, L_FOOT, R_FOOT];

export type RagdollState = 'fly' | 'lie' | 'up' | 'done';

/** One knocked-over person. Plain data: `pos` and `prev` are this step's and the last step's positions, POINTS × (x, y, z). */
export interface Ragdoll {
  pos: number[];
  prev: number[];
  state: RagdollState;
  t: number; // s in this state ('up': 0..1 of the way up)
  still: number; // s every point has been slower than SETTLE_MS
  h: number; // the way they face when they stand again (rad, as a pedestrian's h)
  from: number[]; // where the points were when they started to get up
  scale: number; // their size, as the pedestrian mesh's scale: every stick is this times its standing length
}

/** What a ragdoll touches. */
export interface RagdollWorld {
  groundAt(x: number, z: number): number;
  /** pushes the circle `o` (radius r, m) out of any house it overlaps; BuildingIndex.collide */
  collide(o: { x: number; z: number }, r: number): boolean;
}

/** A car that shoves the points it drives into: a circle (m). */
export interface Pusher {
  x: number;
  z: number;
  r: number;
}

/** The car that hits: where it is, its speed along its heading (m/s) and the heading it moves in (rad; forward is (sin vh, -cos vh)). */
export interface HitCar {
  x: number;
  z: number;
  v: number;
  vh: number;
}

/** Where the points of a person standing at (x, z), facing h, `scale` times the standard size, are in the world. */
export function standingPose(
  x: number,
  z: number,
  h: number,
  ground: number,
  scale = 1,
  out: number[] = new Array(POINTS * 3),
): number[] {
  const c = Math.cos(h),
    s = Math.sin(h);
  for (let i = 0; i < POINTS; i++) {
    const lx = POSE[i][0] * scale,
      ly = POSE[i][1] * scale,
      lz = POSE[i][2] * scale;
    // the pedestrian mesh is turned by rotation.y = -h
    out[i * 3] = x + lx * c - lz * s;
    out[i * 3 + 1] = ground + ly;
    out[i * 3 + 2] = z + lx * s + lz * c;
  }
  return out;
}

/**
 * Knocks over the person standing at (x, z), facing h, `scale` times the standard size, hit by `car`; null if the car is too slow to
 * knock anyone over, or only brushes past them (beside or behind its middle), so they are pushed aside as before.
 * `roll` (a seeded stream of 0..1) varies the tumble, so two hits don't look the same; one that always gives 0.5 throws the
 * average throw.
 */
export function knockOver(
  person: { x: number; z: number; h: number },
  car: HitCar,
  world: RagdollWorld,
  roll: () => number,
  scale = 1,
): Ragdoll | null {
  const hit = bumperHit(person, car);
  if (!hit) return null;
  const spread = () => roll() * 2 - 1; // -1..1, 0 for the average throw
  const thrown = rollThrow(hit, spread);
  const pos = standingPose(person.x, person.z, person.h, world.groundAt(person.x, person.z), scale);
  const prev = pos.slice(); // a step back along the throw: that gap is their speed
  const midY = pos[HEAD * 3 + 1] / 2 + pos[L_FOOT * 3 + 1] / 2; // half way up them: the cartwheel turns about this height
  for (let point = 0; point < POINTS; point++) {
    const i = point * 3;
    pointSpeed(thrown, point, pos[i] - person.x, pos[i + 1] - midY, pos[i + 2] - person.z, _speed);
    prev[i] -= _speed.x * STEP_S;
    prev[i + 1] -= _speed.y * STEP_S;
    prev[i + 2] -= _speed.z * STEP_S;
  }
  kickLimbs(prev, spread);
  return { pos, prev, state: 'fly', t: 0, still: 0, h: person.h, from: [], scale };
}

/** How the bumper meets a person: the way the car moves (a unit vector along the ground), its speed (m/s) and how far
 * to the left of its middle they stand (m). */
interface BumperHit {
  fx: number;
  fz: number;
  speed: number;
  left: number;
}

/** How a person is thrown. Plain data, rolled once per hit. */
interface Throw {
  fx: number; // the way they are thrown: the car's (a unit vector along the ground)
  fz: number;
  launch: number; // m/s
  away: number; // share of the launch that goes to the left of the throw (negative: to the right)
  spin: number; // rad/s about the up axis
  cartwheel: number; // rad/s about the way they are thrown
  flip: number; // times the average gap between the feet's speed and the head's
  lift: number; // times the average lift
}

// null if the car is too slow, or the person is beside or behind its middle
function bumperHit(person: { x: number; z: number }, car: HitCar): BumperHit | null {
  const speed = Math.abs(car.v);
  if (speed < HIT_MIN_MS) return null;
  const sign = Math.sign(car.v),
    fx = Math.sin(car.vh) * sign,
    fz = -Math.cos(car.vh) * sign;
  const ox = person.x - car.x,
    oz = person.z - car.z,
    left = ox * fz - oz * fx;
  if (Math.abs(left) > HIT_SIDE_M || ox * fx + oz * fz < 0) return null;
  return { fx, fz, speed, left };
}

/** Takes the throw's rolls, always in this order, so the same stream throws the same way. */
function rollThrow({ fx, fz, speed, left }: BumperHit, spread: () => number): Throw {
  // thrown away from the side of the car they were on, a little more the further out they stood
  const away = Math.max(-1, Math.min(1, left / AWAY_SPREAD_M)) * AWAY_KEEP + spread() * AWAY_JITTER;
  return {
    fx,
    fz,
    launch: Math.min(speed, LAUNCH_MAX_MS),
    away,
    spin: spread() * SPIN_MAX_RADS,
    cartwheel: spread() * CARTWHEEL_MAX_RADS,
    flip: 1 + spread() * FLIP_SPREAD,
    lift: 1 + spread() * LIFT_SPREAD,
  };
}

const _speed = { x: 0, y: 0, z: 0 };

/**
 * The speed a point leaves at (m/s), into `out`: the throw, plus the turns. (dx, dy, dz) is the point from their middle
 * (m); a turn moves a point at its rate times how far it is from the turn's axis, across the line to it.
 */
function pointSpeed(
  t: Throw,
  point: number,
  dx: number,
  dy: number,
  dz: number,
  out: { x: number; y: number; z: number },
): void {
  const sx = t.fz,
    sz = -t.fx; // to the left of the throw
  const front = dx * t.fx + dz * t.fz,
    left = dx * sx + dz * sz;
  // the bumper takes the legs: low is 0 at the head, 1 at the feet, and the feet go fastest
  const low = 1 - POSE[point][1] / POSE[HEAD][1],
    keep = (HEAD_KEEP + FEET_KEEP) / 2 + (FEET_KEEP - HEAD_KEEP) * (low - 0.5) * t.flip;
  const ahead = keep * t.launch + t.spin * left,
    aside = t.away * t.launch - t.spin * front - t.cartwheel * dy;
  out.x = t.fx * ahead + sx * aside;
  out.y = (LIFT_MS + t.launch * (HEAD_LIFT + (FEET_LIFT - HEAD_LIFT) * low)) * t.lift + t.cartwheel * left;
  out.z = t.fz * ahead + sz * aside;
}

/** Gives each hand and foot a kick of its own, so the limbs flail differently from one throw to the next. */
function kickLimbs(prev: number[], spread: () => number): void {
  for (const point of HANDS_AND_FEET)
    for (let axis = 0; axis < 3; axis++) prev[point * 3 + axis] -= spread() * LIMB_KICK_MS * STEP_S;
}

const _o = { x: 0, z: 0 };
const _floor: number[] = new Array(POINTS); // how low each point may go this step (m): the ground under it plus POINT_R_M; looked up once, as the points move little within a step

/** Moves a ragdoll on by one STEP_S: physics while it flies and lies, then a blend back to standing. */
export function stepRagdoll(r: Ragdoll, world: RagdollWorld, pushers: readonly Pusher[] = []): void {
  if (r.state === 'done') return;
  r.t += STEP_S;
  if (r.state === 'up') {
    blendUp(r, world);
    return;
  }
  const fastest = fall(r);
  let pushed = false;
  for (let point = 0; point < POINTS; point++) {
    if (pushOutOfCars(r, point, world, pushers)) pushed = true;
    stopAtWalls(r, point, world);
    const i = point * 3;
    _floor[point] = world.groundAt(r.pos[i], r.pos[i + 2]) + POINT_R_M;
  }
  for (let n = 0; n < ITERATIONS; n++) {
    keepStickLengths(r);
    keepAboveFloor(r);
  }
  bounceAndSlide(r);
  advanceState(r, fastest, pushed);
}

// Verlet: a point's speed is how far it moved last step (pos - prev), so moving pos also changes its speed.

/** Moves every point on by its speed, slowed by the air, and pulled down; returns how fast the fastest point was going (m/s). */
function fall(r: Ragdoll): number {
  const { pos, prev } = r;
  let fastest = 0;
  for (let point = 0; point < POINTS; point++) {
    const i = point * 3;
    const stepX = (pos[i] - prev[i]) * AIR_KEEP,
      stepY = (pos[i + 1] - prev[i + 1]) * AIR_KEEP,
      stepZ = (pos[i + 2] - prev[i + 2]) * AIR_KEEP;
    fastest = Math.max(fastest, Math.hypot(stepX, stepY, stepZ) / STEP_S);
    prev[i] = pos[i];
    prev[i + 1] = pos[i + 1];
    prev[i + 2] = pos[i + 2];
    pos[i] += stepX;
    pos[i + 1] += stepY - GRAVITY_MS2 * STEP_S * STEP_S;
    pos[i + 2] += stepZ;
  }
  return fastest;
}

/** Shoves a point out of every car it is inside, if it is low enough for the car to reach; true if any car did. */
function pushOutOfCars(r: Ragdoll, point: number, world: RagdollWorld, pushers: readonly Pusher[]): boolean {
  if (!pushers.length) return false;
  const { pos, prev } = r,
    i = point * 3;
  const ground = world.groundAt(pos[i], pos[i + 2]);
  let pushed = false;
  for (const car of pushers) {
    const awayX = pos[i] - car.x,
      awayZ = pos[i + 2] - car.z,
      gap = Math.hypot(awayX, awayZ);
    if (gap >= car.r || gap <= 0.01 || pos[i + 1] >= ground + PUSH_HEIGHT_M) continue;
    // push only until the point moves out at PUSH_KICK_MS, as the push carries over into its speed: one the car
    // lands on is moved out over a few steps rather than fired out in one
    const outX = awayX / gap,
      outZ = awayZ / gap,
      outStep = (pos[i] - prev[i]) * outX + (pos[i + 2] - prev[i + 2]) * outZ;
    const push = Math.min(car.r - gap, Math.max(0, PUSH_KICK_MS * STEP_S - outStep));
    pos[i] += outX * push;
    pos[i + 2] += outZ * push;
    pushed = true;
  }
  return pushed;
}

/** Stops a point dead against a house wall, so it slides down the wall instead of passing through. */
function stopAtWalls(r: Ragdoll, point: number, world: RagdollWorld): void {
  const { pos, prev } = r,
    i = point * 3;
  _o.x = pos[i];
  _o.z = pos[i + 2];
  if (!world.collide(_o, POINT_R_M)) return;
  pos[i] = prev[i] = _o.x;
  pos[i + 2] = prev[i + 2] = _o.z;
}

/** Moves the two ends of every stick towards or away from each other, half each, until it has its standing length. */
function keepStickLengths(r: Ragdoll): void {
  const { pos } = r;
  for (let stick = 0; stick < STICKS.length; stick++) {
    const a = STICKS[stick][0] * 3,
      b = STICKS[stick][1] * 3;
    const dx = pos[b] - pos[a],
      dy = pos[b + 1] - pos[a + 1],
      dz = pos[b + 2] - pos[a + 2],
      length = Math.hypot(dx, dy, dz) || 1e-6;
    const half = (length - REST[stick] * r.scale) / length / 2; // each end moves this share of the gap between them, which closes half the error
    pos[a] += dx * half;
    pos[a + 1] += dy * half;
    pos[a + 2] += dz * half;
    pos[b] -= dx * half;
    pos[b + 1] -= dy * half;
    pos[b + 2] -= dz * half;
  }
}

/** Lifts any point below its floor (_floor) back up onto it. */
function keepAboveFloor(r: Ragdoll): void {
  for (let point = 0; point < POINTS; point++) {
    const y = point * 3 + 1;
    if (r.pos[y] < _floor[point]) r.pos[y] = _floor[point];
  }
}

/** Once per step, for the points on the ground: they bounce up a little and lose some of their slide. */
function bounceAndSlide(r: Ragdoll): void {
  const { pos, prev } = r;
  for (let point = 0; point < POINTS; point++) {
    const i = point * 3;
    if (pos[i + 1] > _floor[point] + 1e-4) continue;
    const stepY = pos[i + 1] - prev[i + 1];
    if (stepY < 0) prev[i + 1] = pos[i + 1] + stepY * BOUNCE;
    prev[i] = pos[i] - (pos[i] - prev[i]) * GROUND_KEEP;
    prev[i + 2] = pos[i + 2] - (pos[i + 2] - prev[i + 2]) * GROUND_KEEP;
  }
}

/** Flying, they lie down once they have come to rest; lying, they get up once left alone for LIE_S. */
function advanceState(r: Ragdoll, fastest: number, pushed: boolean): void {
  switch (r.state) {
    case 'fly':
      r.still = fastest < SETTLE_MS ? r.still + STEP_S : 0;
      if (r.still >= SETTLE_S || r.t >= FLY_MAX_S) {
        r.state = 'lie';
        r.t = 0;
      }
      break;
    case 'lie':
      if (pushed)
        r.t = 0; // nobody gets up while the car is still shoving them: they'd stand up inside it
      else if (r.t >= LIE_S) {
        r.state = 'up';
        r.t = 0;
        r.from = r.pos.slice();
        r.h = facing(r);
      }
      break;
  }
}

/** Where a ragdoll is, from its hips (m); into `out` when given, so a step makes no new object. */
export function ragdollCentre(r: Ragdoll, out: { x: number; z: number } = { x: 0, z: 0 }): { x: number; z: number } {
  const p = r.state === 'up' ? r.from : r.pos;
  out.x = (p[L_HIP * 3] + p[R_HIP * 3]) / 2;
  out.z = (p[L_HIP * 3 + 2] + p[R_HIP * 3 + 2]) / 2;
  return out;
}

// stands up facing the way their head points from their hips, as you would get up from lying down
function facing(r: Ragdoll): number {
  const p = r.pos,
    hx = (p[L_HIP * 3] + p[R_HIP * 3]) / 2,
    hz = (p[L_HIP * 3 + 2] + p[R_HIP * 3 + 2]) / 2;
  const dx = p[HEAD * 3] - hx,
    dz = p[HEAD * 3 + 2] - hz;
  return Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, -dz) : r.h;
}

const _pose: number[] = new Array(POINTS * 3);
const _centre = { x: 0, z: 0 };

function blendUp(r: Ragdoll, world: RagdollWorld) {
  const u = Math.min(1, r.t / GETUP_S),
    e = u * u * (3 - 2 * u); // smoothstep
  const { x, z } = ragdollCentre(r, _centre);
  standingPose(x, z, r.h, world.groundAt(x, z), r.scale, _pose);
  for (let i = 0; i < POINTS * 3; i++) r.pos[i] = r.prev[i] = r.from[i] + (_pose[i] - r.from[i]) * e;
  if (u >= 1) r.state = 'done';
}

/** How far apart points a and b are (m); the sticks keep these at their standing length. */
export function pointGap(r: Ragdoll, a: number, b: number): number {
  return Math.hypot(
    r.pos[b * 3] - r.pos[a * 3],
    r.pos[b * 3 + 1] - r.pos[a * 3 + 1],
    r.pos[b * 3 + 2] - r.pos[a * 3 + 2],
  );
}

/** The sticks, and the length each one keeps at the standard size (m), for tests and the renderer. */
export const RAGDOLL_STICKS: readonly { a: number; b: number; length: number }[] = STICKS.map(([a, b], i) => ({
  a,
  b,
  length: REST[i],
}));
