// Ragdoll physics for a person knocked over by a car (?lab=ragdoll; part of #35). Plain data and functions, no three.js:
// a person is nine points joined by sticks of fixed length (Verlet integration on a fixed timestep), so it tumbles,
// bounces off the ground and the house walls, lies still for a moment, and then gets back up.

/** The points, by index into `Ragdoll.p` (three numbers each: x, y, z in metres). */
export const HEAD = 0, L_SHOULDER = 1, R_SHOULDER = 2, L_HIP = 3, R_HIP = 4, L_HAND = 5, R_HAND = 6, L_FOOT = 7, R_FOOT = 8;
export const POINTS = 9;

// Standing, in the person's frame (x to their right, y up, z behind them; m): the same proportions as personParts in src/game/main.ts.
const POSE: readonly (readonly [number, number, number])[] = [
  [0, 1.62, 0],
  [-0.33, 1.42, 0], [0.33, 1.42, 0],
  [-0.13, 0.8, 0], [0.13, 0.8, 0],
  [-0.33, 0.82, 0], [0.33, 0.82, 0],
  [-0.13, 0.02, 0], [0.13, 0.02, 0],
];

// The torso is a braced box (both diagonals), the head is held to it from all four corners, and each limb is one stick.
const STICKS: readonly (readonly [number, number])[] = [
  [L_SHOULDER, R_SHOULDER], [L_HIP, R_HIP], [L_SHOULDER, L_HIP], [R_SHOULDER, R_HIP], [L_SHOULDER, R_HIP], [R_SHOULDER, L_HIP],
  [HEAD, L_SHOULDER], [HEAD, R_SHOULDER], [HEAD, L_HIP], [HEAD, R_HIP],
  [L_SHOULDER, L_HAND], [R_SHOULDER, R_HAND], [L_HIP, L_FOOT], [R_HIP, R_FOOT],
];
const REST = STICKS.map(([a, b]) => Math.hypot(POSE[a][0] - POSE[b][0], POSE[a][1] - POSE[b][1], POSE[a][2] - POSE[b][2]));

export const STEP_S = 1 / 60;               // fixed physics step (s)
export const HIT_MIN_MS = 15 / 3.6;         // slower than this (m/s) a car only pushes people aside, as before (#35: ~15 km/h)
const LAUNCH_MAX_MS = 22;                   // the launch stops growing with the car's speed here (m/s), so nobody leaves the map
const GRAVITY_MS2 = 16;                     // the player's jump gravity in main.ts, so a ragdoll falls as a hop does
const AIR_KEEP = 0.998;                     // share of its speed a point keeps per step in the air
const GROUND_KEEP = 0.86;                   // share of its sliding speed a point on the ground keeps per step
const BOUNCE = 0.3;                         // share of its falling speed a point keeps as it bounces up
const POINT_R_M = 0.1;                      // how far a point stays above the ground and out of walls (m)
const ITERATIONS = 8;                       // stick passes per step: more is stiffer
const SETTLE_MS = 0.6, SETTLE_S = 0.4;      // lying down: every point slower than SETTLE_MS (m/s) for SETTLE_S (s)
const FLY_MAX_S = 6;                        // lies down after this long (s) even if still sliding
const LIE_S = 2.5;                          // lies still for this long (s) before getting up
const GETUP_S = 0.9;                        // getting up takes this long (s)
const PUSH_HEIGHT_M = 1.6;                  // a car shoves points lower than this above the ground (m)
const PUSH_KICK_MS = 10;                    // a shove gives a point at most this much speed (m/s); a faster car drives over them
const HIT_SIDE_M = 1.25;                    // further than this to the side of the car's middle (m) the bumper misses: half the car (0.9) and a person (0.35)
// the throw, as shares of the launch speed: the feet go fastest and the head lags, so they tip back over the bonnet
const HEAD_KEEP = 0.65, FEET_KEEP = 1.05;   // forward
const LIFT_MS = 1.5, HEAD_LIFT = 0.18, FEET_LIFT = 0.3;   // up: LIFT_MS (m/s) plus a share
const AWAY_SPREAD_M = 1.5;                  // standing this far to one side of the car's middle (m) throws them furthest that way
const AWAY_KEEP = 0.25, AWAY_JITTER = 0.3;  // sideways: the share at AWAY_SPREAD_M, and the most the jitter adds or takes

export type RagdollState = 'fly' | 'lie' | 'up' | 'done';

/** One knocked-over person. Plain data: `p` and `q` are this step's and the last step's positions, POINTS × (x, y, z). */
export interface Ragdoll {
  p: number[];
  q: number[];
  state: RagdollState;
  t: number;          // s in this state ('up': 0..1 of the way up)
  still: number;      // s every point has been slower than SETTLE_MS
  h: number;          // the way they face when they stand again (rad, as a pedestrian's h)
  from: number[];     // where the points were when they started to get up
  s: number;          // their size, as the pedestrian mesh's scale: every stick is this times its standing length
}

/** What a ragdoll touches. */
export interface RagdollWorld {
  groundAt(x: number, z: number): number;
  /** pushes the circle `o` (radius r, m) out of any house it overlaps; BuildingIndex.collide */
  collide(o: { x: number; z: number }, r: number): boolean;
}

/** A car that shoves the points it drives into: a circle (m). */
export interface Pusher { x: number; z: number; r: number }

/** The car that hits: where it is, its speed along its heading (m/s) and the heading it moves in (rad; forward is (sin vh, -cos vh)). */
export interface HitCar { x: number; z: number; v: number; vh: number }

/** Where the points of a person standing at (x, z), facing h, `scale` times the standard size, are in the world. */
export function standingPose(x: number, z: number, h: number, ground: number, scale = 1, out: number[] = new Array(POINTS * 3)): number[] {
  const c = Math.cos(h), s = Math.sin(h);
  for (let i = 0; i < POINTS; i++) {
    const lx = POSE[i][0] * scale, ly = POSE[i][1] * scale, lz = POSE[i][2] * scale;
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
 * `jitter` (0..1, from a seeded stream) varies the tumble, so two hits don't look the same.
 */
export function knockOver(person: { x: number; z: number; h: number }, car: HitCar, world: RagdollWorld, jitter: number, scale = 1): Ragdoll | null {
  const speed = Math.abs(car.v);
  if (speed < HIT_MIN_MS) return null;
  const sign = Math.sign(car.v), fx = Math.sin(car.vh) * sign, fz = -Math.cos(car.vh) * sign;
  const ox = person.x - car.x, oz = person.z - car.z, side = ox * fz - oz * fx, sx = fz, sz = -fx;
  if (Math.abs(side) > HIT_SIDE_M || ox * fx + oz * fz < 0) return null;
  const launch = Math.min(speed, LAUNCH_MAX_MS);
  // thrown away from the side of the car they were on, a little more the further out they stood
  const away = Math.max(-1, Math.min(1, side / AWAY_SPREAD_M)) * AWAY_KEEP + (jitter - 0.5) * AWAY_JITTER;
  const p = standingPose(person.x, person.z, person.h, world.groundAt(person.x, person.z), scale);
  const q = p.slice();
  for (let i = 0; i < POINTS; i++) {
    // the bumper takes the legs: low is 0 at the head, 1 at the feet
    const low = 1 - POSE[i][1] / POSE[HEAD][1], k = HEAD_KEEP + (FEET_KEEP - HEAD_KEEP) * low;
    const vx = (fx * k + sx * away) * launch, vz = (fz * k + sz * away) * launch;
    const vy = LIFT_MS + launch * (HEAD_LIFT + (FEET_LIFT - HEAD_LIFT) * low);
    q[i * 3] -= vx * STEP_S; q[i * 3 + 1] -= vy * STEP_S; q[i * 3 + 2] -= vz * STEP_S;
  }
  return { p, q, state: 'fly', t: 0, still: 0, h: person.h, from: [], s: scale };
}

const _o = { x: 0, z: 0 };
const _g: number[] = new Array(POINTS);   // the ground under each point this step (m); looked up once, as the points move little within a step

/** Moves a ragdoll on by one STEP_S: physics while it flies and lies, then a blend back to standing. */
export function stepRagdoll(r: Ragdoll, world: RagdollWorld, pushers: readonly Pusher[] = []): void {
  if (r.state === 'done') return;
  r.t += STEP_S;
  if (r.state === 'up') { blendUp(r, world); return; }
  const { p, q } = r;
  let fastest = 0;
  for (let i = 0; i < POINTS * 3; i += 3) {
    const vx = (p[i] - q[i]) * AIR_KEEP, vy = (p[i + 1] - q[i + 1]) * AIR_KEEP, vz = (p[i + 2] - q[i + 2]) * AIR_KEEP;
    fastest = Math.max(fastest, Math.hypot(vx, vy, vz) / STEP_S);
    q[i] = p[i]; q[i + 1] = p[i + 1]; q[i + 2] = p[i + 2];
    p[i] += vx; p[i + 1] += vy - GRAVITY_MS2 * STEP_S * STEP_S; p[i + 2] += vz;
  }
  let pushed = false;
  for (let i = 0; i < POINTS * 3; i += 3) {
    const g = pushers.length ? world.groundAt(p[i], p[i + 2]) : 0;
    for (const c of pushers) {
      const ex = p[i] - c.x, ez = p[i + 2] - c.z, d = Math.hypot(ex, ez);
      if (d < c.r && d > 0.01 && p[i + 1] < g + PUSH_HEIGHT_M) {
        // moving p is speed to Verlet, and it carries over: push only until the point moves out at PUSH_KICK_MS, so one the car
        // lands on is moved out over a few steps rather than fired out in one
        const ux = ex / d, uz = ez / d, out = (p[i] - q[i]) * ux + (p[i + 2] - q[i + 2]) * uz;
        const m = Math.min(c.r - d, Math.max(0, PUSH_KICK_MS * STEP_S - out));
        p[i] += ux * m; p[i + 2] += uz * m; pushed = true;
      }
    }
    _o.x = p[i]; _o.z = p[i + 2];
    if (world.collide(_o, POINT_R_M)) {
      // a wall: stop the point against it, so it slides down instead of passing through
      p[i] = q[i] = _o.x; p[i + 2] = q[i + 2] = _o.z;
    }
    _g[i / 3] = world.groundAt(p[i], p[i + 2]) + POINT_R_M;
  }
  for (let n = 0; n < ITERATIONS; n++) {
    for (let s = 0; s < STICKS.length; s++) {
      const a = STICKS[s][0] * 3, b = STICKS[s][1] * 3;
      const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2], d = Math.hypot(dx, dy, dz) || 1e-6;
      const k = (d - REST[s] * r.s) / d / 2;
      p[a] += dx * k; p[a + 1] += dy * k; p[a + 2] += dz * k;
      p[b] -= dx * k; p[b + 1] -= dy * k; p[b + 2] -= dz * k;
    }
    for (let i = 0; i < POINTS * 3; i += 3) if (p[i + 1] < _g[i / 3]) p[i + 1] = _g[i / 3];
  }
  // once per step, for the points on the ground: bounce up a little and lose some of the slide
  for (let i = 0; i < POINTS * 3; i += 3) {
    if (p[i + 1] > _g[i / 3] + 1e-4) continue;
    const vy = p[i + 1] - q[i + 1];
    if (vy < 0) q[i + 1] = p[i + 1] + vy * BOUNCE;
    q[i] = p[i] - (p[i] - q[i]) * GROUND_KEEP; q[i + 2] = p[i + 2] - (p[i + 2] - q[i + 2]) * GROUND_KEEP;
  }
  if (r.state === 'fly') {
    r.still = fastest < SETTLE_MS ? r.still + STEP_S : 0;
    if (r.still >= SETTLE_S || r.t >= FLY_MAX_S) { r.state = 'lie'; r.t = 0; }
  } else if (pushed) r.t = 0;   // nobody gets up while the car is still shoving them: they'd stand up inside it
  else if (r.t >= LIE_S) { r.state = 'up'; r.t = 0; r.from = p.slice(); r.h = facing(r); }
}

/** Where a ragdoll is, from its hips (m). */
export function ragdollCentre(r: Ragdoll): { x: number; z: number } {
  const p = r.state === 'up' ? r.from : r.p;
  return { x: (p[L_HIP * 3] + p[R_HIP * 3]) / 2, z: (p[L_HIP * 3 + 2] + p[R_HIP * 3 + 2]) / 2 };
}

// stands up facing the way their head points from their hips, as you would get up from lying down
function facing(r: Ragdoll): number {
  const p = r.p, hx = (p[L_HIP * 3] + p[R_HIP * 3]) / 2, hz = (p[L_HIP * 3 + 2] + p[R_HIP * 3 + 2]) / 2;
  const dx = p[HEAD * 3] - hx, dz = p[HEAD * 3 + 2] - hz;
  return Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, -dz) : r.h;
}

const _pose: number[] = new Array(POINTS * 3);

function blendUp(r: Ragdoll, world: RagdollWorld) {
  const u = Math.min(1, r.t / GETUP_S), e = u * u * (3 - 2 * u);   // smoothstep
  const { x, z } = ragdollCentre(r);
  standingPose(x, z, r.h, world.groundAt(x, z), r.s, _pose);
  for (let i = 0; i < POINTS * 3; i++) r.p[i] = r.q[i] = r.from[i] + (_pose[i] - r.from[i]) * e;
  if (u >= 1) r.state = 'done';
}

/** How far apart points a and b are (m); the sticks keep these at their standing length. */
export function pointGap(r: Ragdoll, a: number, b: number): number {
  return Math.hypot(r.p[b * 3] - r.p[a * 3], r.p[b * 3 + 1] - r.p[a * 3 + 1], r.p[b * 3 + 2] - r.p[a * 3 + 2]);
}

/** The sticks, and the length each one keeps at the standard size (m), for tests and the renderer. */
export const RAGDOLL_STICKS: readonly { a: number; b: number; length: number }[] = STICKS.map(([a, b], i) => ({ a, b, length: REST[i] }));
