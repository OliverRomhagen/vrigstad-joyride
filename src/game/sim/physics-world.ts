// The Rapier trial (#54, ?lab=rapier, docs/rapier-trial.md): one Rapier world beside the game's own collisions, which
// stay in charge. The ground and the buildings' walls are fixed shapes; the cars, the player and the people near the
// player are shapes the game moves, so driving and walking feel as they do; street furniture is bodies that a car
// knocks over. Shots find what they hit by its ray casts (castSegment). Pure: no three.js, no DOM. The Rapier module
// is passed in, so the page decides how it is loaded.
import type RAPIER from '@dimforge/rapier3d-compat';
import { type BuildingShape, forEachBuilding } from '../../world/buildings';
import type { WorldData } from '../../world/data';
import type { Heightfield } from '../../world/heightfield';
import { type CarBody, PERSON_RADIUS_M } from './car-body';
import { PHYSICS } from './physics-tunables';

export type Rapier = typeof RAPIER;
type Body = InstanceType<Rapier['RigidBody']>;
/** the terrain's elevation grid, which its drawn mesh is built from (src/world/mesh/terrain.ts) */
type Ground = Pick<Heightfield, 'samples' | 'sampleCoord' | 'sampleHeight' | 'heightAt'>;

/** Rapier steps at this fixed time step, whatever the frame rate, catching up when a frame is long (s) */
export const PHYSICS_STEP_S = 1 / 60;
/** the most steps one frame catches up; a longer stall is dropped rather than run all at once */
const MAX_STEPS_PER_FRAME = 4;
/** the walls reach this far below the lowest corner, so nothing slips under one on a slope (m) */
const WALL_FOOT_M = 1;
/** half the height of the player's capsule's straight part: with PERSON_RADIUS_M, a person 1.8 m tall (m) */
const PLAYER_HALF_HEIGHT_M = 0.5;
/** a car or the player that moves further than this in one frame was put there, not driven: it jumps, unswept (m) */
const TELEPORT_M = 8;
/** people further than this from the player aren't in the world: as far as the weapons' line of sight reaches (m) */
const PERSON_JOIN_M = 160;
/**
 * the props this near the player join the world, anchored, so a shot meets them: a shot further off passes through one
 * no car has been near. Short of the line of sight, as each one joined stays (m)
 */
const PROP_SHOT_JOIN_M = 40;
/** and they are looked for again once the player has gone this far (m) */
const PROP_SHOT_JOIN_EVERY_M = 5;
// gravity, and how near and how far for the props, are in PHYSICS (physics-tunables.ts), so the console can change them
/**
 * a knocked target stands up only once nothing is this near its stand: a car's capsule reaches 2.4 m from its middle,
 * and one put back inside something is thrown out of it (m)
 */
const TARGET_CLEAR_M = 3;
/** nor while another loose prop lies this near (m) */
const TARGET_CLEAR_PROP_M = 1;
/** the knocked props are checked for respawning once every this many steps: a second */
const RESPAWN_CHECK_STEPS = 60;
/**
 * an anchored prop leaves the world again once nothing has been within its join distance and this much more of it:
 * traffic otherwise brings hundreds into the world over a session, and the step grows with them. The margin keeps one
 * at the edge from leaving and joining over and over (m)
 */
const PROP_LEAVE_MARGIN_M = 20;
/** props are found by a grid of cells this size (m) */
const PROP_CELL_M = 16;
/** cell keys are numbers: (column + offset) * stride + row + offset, for any column and row within ±offset */
const CELL_OFFSET = 1024,
  CELL_STRIDE = 2048;

/** Something that falls over: a box of its size standing on the ground at (x, z), turned rotationY about the vertical. */
export interface PropSpec {
  x: number;
  z: number;
  /** the height of the ground it stands on, as it is drawn: curbs and road lifts included (m) */
  baseY: number;
  rotationY: number;
  widthM: number;
  depthM: number;
  heightM: number;
  massKg: number;
  /**
   * More boxes on the same body, beside the main one: a lamp's arm. Each is centred (x, y, z) from the main box's middle,
   * in the prop's own frame (z its front, as the model's), half `hx` by `hy` by `hz` across, and weighs `massKg`.
   */
  parts?: readonly { x: number; y: number; z: number; hx: number; hy: number; hz: number; massKg: number }[];
  /**
   * A target at the shooting range (shooting-range.ts): in the world from the start, wherever the cars are, and back on
   * its stand PHYSICS.TARGET_RESET_S after it's knocked, however near the player is.
   */
  isTarget?: boolean;
}

/** A person the world holds while they're near the player, standing: `scale` is their size, 1 the standard person. */
export interface PersonBody {
  x: number;
  z: number;
  scale: number;
  /** lying on the ground, knocked over: not in the world, as the ragdolls have them */
  down?: boolean;
}

/** What a ray cast can meet: the weapons' hits are the same kinds (HitKind in shots.ts). */
export const SurfaceKind = { GROUND: 'ground', WALL: 'wall', CAR: 'car', PERSON: 'person', PROP: 'prop' } as const;
export type SurfaceKind = (typeof SurfaceKind)[keyof typeof SurfaceKind];

/** What a line met: the point, the surface's normal there, and what it belongs to. */
export interface SegmentHit {
  kind: SurfaceKind;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  car: CarBody | null;
  person: PersonBody | null;
  /** the prop's index in the world's props, or -1 */
  prop: number;
}

export const newSegmentHit = (): SegmentHit => ({
  kind: SurfaceKind.GROUND,
  x: 0,
  y: 0,
  z: 0,
  nx: 0,
  ny: 1,
  nz: 0,
  car: null,
  person: null,
  prop: -1,
});

/** Where a prop is: its middle and its rotation as a quaternion. */
export interface PropPose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface PhysicsWorldOptions {
  data: WorldData;
  heightfield: Ground;
  props: readonly PropSpec[];
  /** more fixed boxes, such as the shooting range's bank: each its middle and half its size (m) */
  blocks?: readonly { x: number; y: number; z: number; hx: number; hy: number; hz: number }[];
}

/** Where a car or the player is to be at the end of this frame's steps, and where it was at the end of the last. */
interface Target {
  x: number;
  y: number;
  z: number;
  /** the turn about the vertical; NaN for the player, who isn't turned */
  angle: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  fromAngle: number;
  /** whether it is to move this frame */
  moving: boolean;
  /** a car's capsule: its radius and half its straight part, for finding the props it is about to hit (m); 0 for the player */
  radius: number;
  spine: number;
}

const _v = { x: 0, y: 0, z: 0 };

/**
 * One Rapier world for the village. `follow` moves the cars and the player to where the game put them and brings the
 * props near the cars into the world, `step` runs the simulation for a frame, and `propPose` reads where a prop has gone.
 */
export class PhysicsWorld {
  /** the props in Rapier's world, by index: the ones a car has come near */
  readonly joined: number[] = [];
  /** the props knocked loose and not yet back on their stands, by index, in the order they came loose */
  readonly loosened: number[] = [];
  private readonly R: Rapier;
  private readonly world: InstanceType<Rapier['World']>;
  private readonly heightAt: (x: number, z: number) => number;
  private readonly props: readonly PropSpec[];
  /** each prop's reach from its middle across the ground: half its footprint's diagonal (m) */
  private readonly propReach: Float64Array;
  private readonly propBodies: (Body | null)[];
  /** whether each prop has been knocked loose: anchored where it stands until a car touches it */
  private readonly loose: Uint8Array;
  /** the step each loose prop was knocked at */
  private readonly looseAtStep: Uint32Array;
  /** each loose prop's pose before the last step, 7 numbers a prop (x, y, z, qx, qy, qz, qw), for drawnPose */
  private readonly prevPose: Float64Array;
  private readonly hasPrev: Uint8Array;
  /** where the player is, on foot or in a car: a prop in sight of it isn't put back */
  private viewerX = 0;
  private viewerZ = 0;
  /** which prop each joined prop's collider belongs to, by the collider's handle */
  private readonly propByCollider = new Map<number, number>();
  private readonly events: InstanceType<Rapier['EventQueue']>;
  private readonly ray: InstanceType<Rapier['Ray']>;
  private readonly propCells = new Map<number, number[]>();
  private readonly carBodies = new Map<CarBody, Body>();
  private readonly carByCollider = new Map<number, CarBody>();
  private readonly personBodies = new Map<PersonBody, Body>();
  private readonly personByCollider = new Map<number, PersonBody>();
  private readonly playerBody: Body;
  private readonly groundCollider: number;
  private readonly seen = new Set<object>();
  /** the collider a ray cast passes through: the car the shot was fired from */
  private skipCollider = -1;
  // what a ray cast can meet: not the car fired from, nor someone knocked down this frame, whose capsule only leaves at
  // the next followPeople: the second pellet of a shotgun's spread would stop at it
  private readonly castable = (c: { handle: number }) =>
    c.handle !== this.skipCollider && !this.personByCollider.get(c.handle)?.down;
  /** where the props near the player were last looked for */
  private joinedAtX = Number.NaN;
  /** the player is in a car, their body parked under the origin: not near anything there */
  private playerAway = false;
  private joinedAtZ = Number.NaN;
  private readonly targets = new Map<Body, Target>();
  private carry = 0;
  private stepCount = 0;
  private lastStepMs = 0;

  constructor(R: Rapier, { data, heightfield, props, blocks = [] }: PhysicsWorldOptions) {
    this.R = R;
    this.heightAt = (x, z) => heightfield.heightAt(x, z);
    this.props = props;
    this.propReach = Float64Array.from(props, p => Math.hypot(p.widthM, p.depthM) / 2);
    this.propBodies = props.map(() => null);
    this.loose = new Uint8Array(props.length);
    this.prevPose = new Float64Array(props.length * 7);
    this.hasPrev = new Uint8Array(props.length);
    this.looseAtStep = new Uint32Array(props.length);
    props.forEach((p, i) => {
      const key = cellKey(Math.floor(p.x / PROP_CELL_M), Math.floor(p.z / PROP_CELL_M)),
        cell = this.propCells.get(key);
      if (cell) cell.push(i);
      else this.propCells.set(key, [i]);
    });
    this.world = new R.World({ x: 0, y: -PHYSICS.GRAVITY, z: 0 });
    this.world.timestep = PHYSICS_STEP_S;
    this.events = new R.EventQueue(true);
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    const fixed = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    const ground = groundTriangles(heightfield);
    this.groundCollider = this.world.createCollider(
      R.ColliderDesc.trimesh(ground.vertices, ground.indices),
      fixed,
    ).handle;
    const walls = wallTriangles(data, heightfield);
    if (walls.indices.length) this.world.createCollider(R.ColliderDesc.trimesh(walls.vertices, walls.indices), fixed);
    this.playerBody = this.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -1000, 0), // out of the way until `follow` places it
    );
    this.world.createCollider(R.ColliderDesc.capsule(PLAYER_HALF_HEIGHT_M, PERSON_RADIUS_M), this.playerBody);
    for (const b of blocks)
      this.world.createCollider(R.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.x, b.y, b.z), fixed);
    props.forEach((p, i) => {
      if (p.isTarget) this.join(i);
    });
    this.world.step(); // ray casts read the broad phase, which a step builds: one now, so they work before the first frame
  }

  /** the time the last frame's steps took (ms) */
  get stepMs() {
    return this.lastStepMs;
  }

  /** how many steps have run since the world was built */
  get steps() {
    return this.stepCount;
  }

  /**
   * Moves the cars and the player to where the game put them this frame, and brings the props near the cars into the
   * world. The player pushes what is loose but knocks nothing loose: walking past a mailbox leaves it standing.
   */
  follow(cars: readonly CarBody[], player: { x: number; z: number } | null, viewer: { x: number; z: number }) {
    const { R, seen } = this;
    this.viewerX = viewer.x;
    this.viewerZ = viewer.z;
    seen.clear();
    for (const car of cars) {
      seen.add(car);
      let body = this.carBodies.get(car);
      const r = car.T.widthM / 2,
        half = Math.max(0.01, car.T.lengthM / 2 - r);
      if (!body) {
        body = this.world.createRigidBody(
          R.RigidBodyDesc.kinematicPositionBased().setTranslation(car.x, this.heightAt(car.x, car.z) + r, car.z),
        );
        // a capsule lies along the body's z, and the body turns so that z points where the car does
        const collider = this.world.createCollider(
          R.ColliderDesc.capsule(half, r).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }),
          body,
        );
        this.carBodies.set(car, body);
        this.carByCollider.set(collider.handle, car);
      }
      // the game's heading h points the car at (sin h, -cos h); a turn of π - h about y takes z there
      const target = this.aim(body, car.x, this.heightAt(car.x, car.z) + r, car.z, Math.PI - car.h);
      target.radius = r;
      target.spine = half;
      if (target.moving) this.joinNear(car.x, car.z); // a parked car has joined what is near it already
    }
    for (const [car, body] of this.carBodies)
      if (!seen.has(car)) {
        this.carByCollider.delete(body.collider(0).handle);
        this.world.removeRigidBody(body);
        this.carBodies.delete(car);
        this.targets.delete(body);
      }
    if (player) {
      const y = this.heightAt(player.x, player.z) + PERSON_RADIUS_M + PLAYER_HALF_HEIGHT_M;
      this.aim(this.playerBody, player.x, y, player.z, Number.NaN);
    } else this.aim(this.playerBody, 0, -1000, 0, Number.NaN); // in a car: out of the way
    this.playerAway = !player;
  }

  /**
   * Moves the people within PERSON_JOIN_M of `near` (the player) to where the game put them, as capsules of their size,
   * so a shot can hit them. Like the player, they push what is loose but knock nothing loose. One knocked down leaves.
   * The props within PROP_SHOT_JOIN_M of `near` join the world too, for the shots.
   */
  followPeople(people: readonly PersonBody[], near: { x: number; z: number }) {
    const { R, seen } = this;
    // the first time, joinedAt is NaN, and a NaN distance is never near: they're looked for
    if (!(Math.hypot(near.x - this.joinedAtX, near.z - this.joinedAtZ) < PROP_SHOT_JOIN_EVERY_M)) {
      this.joinNear(near.x, near.z, PROP_SHOT_JOIN_M);
      this.joinedAtX = near.x;
      this.joinedAtZ = near.z;
    }
    seen.clear();
    for (const p of people) {
      if (p.down || Math.hypot(p.x - near.x, p.z - near.z) > PERSON_JOIN_M) continue;
      seen.add(p);
      const y = this.heightAt(p.x, p.z) + (PERSON_RADIUS_M + PLAYER_HALF_HEIGHT_M) * p.scale;
      let body = this.personBodies.get(p);
      if (!body) {
        body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, y, p.z));
        const collider = this.world.createCollider(
          R.ColliderDesc.capsule(PLAYER_HALF_HEIGHT_M * p.scale, PERSON_RADIUS_M * p.scale),
          body,
        );
        this.personBodies.set(p, body);
        this.personByCollider.set(collider.handle, p);
      }
      this.aim(body, p.x, y, p.z, Number.NaN);
    }
    for (const [p, body] of this.personBodies)
      if (!seen.has(p)) {
        this.personByCollider.delete(body.collider(0).handle);
        this.world.removeRigidBody(body);
        this.personBodies.delete(p);
        this.targets.delete(body);
      }
  }

  /** how many people the world holds */
  get people() {
    return this.personBodies.size;
  }

  /** Runs the steps this frame's time asks for; returns how many ran. */
  step(dt: number, now: () => number = () => 0) {
    const t0 = now();
    this.carry = Math.min(this.carry + dt, PHYSICS_STEP_S * MAX_STEPS_PER_FRAME);
    const steps = Math.floor(this.carry / PHYSICS_STEP_S + 1e-9);
    this.carry -= steps * PHYSICS_STEP_S;
    if (this.world.gravity.y !== -PHYSICS.GRAVITY) {
      this.world.gravity = { x: 0, y: -PHYSICS.GRAVITY, z: 0 };
      // a change of gravity wakes nothing by itself: a prop asleep in mid-air at zero gravity would stay there
      for (const i of this.loosened) this.propBodies[i]?.wakeUp();
    }
    // Each car and the player cover this frame's move evenly over its steps: Rapier gives a kinematic body the whole
    // move in the first step it's told of, so at 30 fps a car would hit a mailbox at twice its speed, then stand still.
    for (let k = 1; k <= steps; k++) {
      const f = k / steps;
      for (const [body, t] of this.targets) {
        if (!t.moving) continue;
        _v.x = t.fromX + (t.x - t.fromX) * f;
        _v.y = t.fromY + (t.y - t.fromY) * f;
        _v.z = t.fromZ + (t.z - t.fromZ) * f;
        body.setNextKinematicTranslation(_v);
        if (Number.isNaN(t.angle)) continue;
        const turn = Math.atan2(Math.sin(t.angle - t.fromAngle), Math.cos(t.angle - t.fromAngle)), // the short way round
          angle = t.fromAngle + turn * f;
        body.setNextKinematicRotation(yaw(angle));
        // a prop this step's move takes the car into comes loose first, so the car pushes it rather than meeting an
        // anchored box it is already inside of, which Rapier pushes out sideways: at speed, or a glancing hit, it passed through
        this.loosenAhead(_v.x, _v.z, angle, t, Math.hypot(t.x - t.fromX, t.z - t.fromZ) / steps);
      }
      for (const i of this.loosened) this.keepPrev(i);
      this.world.step(this.events);
      this.events.drainCollisionEvents(this.loosenTouched);
      if (++this.stepCount % RESPAWN_CHECK_STEPS === 0) {
        this.respawnFarAway();
        this.leaveFar();
      }
    }
    if (steps > 0)
      for (const t of this.targets.values())
        if (t.moving) {
          t.moving = false;
          t.fromX = t.x;
          t.fromY = t.y;
          t.fromZ = t.z;
          t.fromAngle = t.angle;
        }
    this.lastStepMs = now() - t0;
    return steps;
  }

  /** How many props are awake: moving, or settling. */
  get awakeProps() {
    let n = 0;
    for (const i of this.loosened) if (this.isAwake(i)) n++;
    return n;
  }

  /** Whether prop i has been knocked loose and isn't back on its stand. Until then it stands, anchored, where it is drawn. */
  isLoose(i: number) {
    return this.loose[i] === 1;
  }

  /** Whether prop i is loose and awake: moving, or settling. A sleeping prop stays where it last came to rest. */
  isAwake(i: number) {
    const body = this.propBodies[i];
    return !!body && this.loose[i] === 1 && !body.isSleeping(); // an anchored body never says it sleeps
  }

  /** Writes where prop i is into `out`: where Rapier has it, or where it stands if it hasn't joined. */
  propPose(i: number, out: PropPose) {
    const body = this.propBodies[i];
    if (!body) {
      const p = this.props[i],
        q = yaw(p.rotationY);
      out.x = p.x;
      out.y = p.baseY + p.heightM / 2;
      out.z = p.z;
      out.qx = q.x;
      out.qy = q.y;
      out.qz = q.z;
      out.qw = q.w;
      return out;
    }
    const t = body.translation(),
      q = body.rotation();
    out.x = t.x;
    out.y = t.y;
    out.z = t.z;
    out.qx = q.x;
    out.qy = q.y;
    out.qz = q.z;
    out.qw = q.w;
    return out;
  }

  /**
   * Where to draw prop i this frame: for a loose one, between its pose before the last step and its pose now, as far
   * as this frame is into the next step. Physics steps at 60 Hz; on a 120 Hz screen a falling prop would otherwise move
   * every other frame. It is drawn up to one step behind Rapier.
   */
  drawnPose(i: number, out: PropPose) {
    this.propPose(i, out);
    if (!this.loose[i] || !this.hasPrev[i]) return out;
    const a = this.carry / PHYSICS_STEP_S,
      b = 1 - a,
      p = this.prevPose,
      k = i * 7;
    out.x = p[k] * b + out.x * a;
    out.y = p[k + 1] * b + out.y * a;
    out.z = p[k + 2] * b + out.z * a;
    // the short way round: q and -q are the same turn
    const s = p[k + 3] * out.qx + p[k + 4] * out.qy + p[k + 5] * out.qz + p[k + 6] * out.qw < 0 ? -1 : 1;
    let qx = p[k + 3] * b + out.qx * a * s,
      qy = p[k + 4] * b + out.qy * a * s,
      qz = p[k + 5] * b + out.qz * a * s,
      qw = p[k + 6] * b + out.qw * a * s;
    const n = Math.hypot(qx, qy, qz, qw) || 1;
    qx /= n;
    qy /= n;
    qz /= n;
    qw /= n;
    out.qx = qx;
    out.qy = qy;
    out.qz = qz;
    out.qw = qw;
    return out;
  }

  /** The first thing along a line from (x, y, z) in direction (dx, dy, dz), up to `maxM`: how far along it is (m), or null. */
  castRay(x: number, y: number, z: number, dx: number, dy: number, dz: number, maxM: number) {
    const { ray } = this;
    ray.origin.x = x;
    ray.origin.y = y;
    ray.origin.z = z;
    ray.dir.x = dx;
    ray.dir.y = dy;
    ray.dir.z = dz;
    const hit = this.world.castRay(ray, maxM, true);
    return hit ? hit.timeOfImpact : null;
  }

  /**
   * What the line from (x0, y0, z0) to (x1, y1, z1) meets first, written to `out`; false when it meets nothing. The
   * player is passed through, and so is `skip`, the car a shot is fired from. Reads the world as the last step left it.
   */
  castSegment(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    skip: CarBody | null,
    out: SegmentHit,
  ) {
    const dx = x1 - x0,
      dy = y1 - y0,
      dz = z1 - z0,
      len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return false;
    const { ray } = this;
    ray.origin.x = x0;
    ray.origin.y = y0;
    ray.origin.z = z0;
    ray.dir.x = dx / len;
    ray.dir.y = dy / len;
    ray.dir.z = dz / len;
    const skipBody = skip && this.carBodies.get(skip);
    this.skipCollider = skipBody ? skipBody.collider(0).handle : -1;
    const hit = this.world.castRayAndGetNormal(
      ray,
      len,
      true,
      undefined,
      undefined,
      undefined,
      this.playerBody,
      this.castable,
    );
    if (!hit) return false;
    const t = hit.timeOfImpact,
      h = hit.collider.handle;
    out.x = x0 + ray.dir.x * t;
    out.y = y0 + ray.dir.y * t;
    out.z = z0 + ray.dir.z * t;
    out.nx = hit.normal.x;
    out.ny = hit.normal.y;
    out.nz = hit.normal.z;
    out.car = this.carByCollider.get(h) ?? null;
    out.person = this.personByCollider.get(h) ?? null;
    out.prop = this.propByCollider.get(h) ?? -1;
    out.kind = out.car
      ? SurfaceKind.CAR
      : out.person
        ? SurfaceKind.PERSON
        : out.prop >= 0
          ? SurfaceKind.PROP
          : h === this.groundCollider
            ? SurfaceKind.GROUND
            : SurfaceKind.WALL;
    return true;
  }

  /** Knocks prop i loose, if it isn't, and gives it the impulse (ix, iy, iz) at (x, y, z): a shot's hit (N·s). */
  knockProp(i: number, x: number, y: number, z: number, ix: number, iy: number, iz: number) {
    const body = this.propBodies[i];
    if (!body) return;
    this.setLoose(i);
    body.applyImpulseAtPoint({ x: ix, y: iy, z: iz }, { x, y, z }, true);
  }

  dispose() {
    this.world.free();
  }

  /**
   * Where `body` is to be at the end of this frame's steps; `angle` about the vertical, NaN to leave it unturned. One
   * that hasn't moved stays still, and one moved further than TELEPORT_M jumps there at once: swept over the steps, a
   * respawn would cross the village at thousands of m/s and launch whatever it touched.
   */
  private aim(body: Body, x: number, y: number, z: number, angle: number) {
    let t = this.targets.get(body);
    if (!t) {
      t = { x, y, z, angle, fromX: x, fromY: y, fromZ: z, fromAngle: angle, moving: false, radius: 0, spine: 0 };
      this.targets.set(body, t);
      return t;
    }
    if (Math.hypot(x - t.fromX, y - t.fromY, z - t.fromZ) > TELEPORT_M) {
      _v.x = x;
      _v.y = y;
      _v.z = z;
      body.setTranslation(_v, true);
      if (!Number.isNaN(angle)) body.setRotation(yaw(angle), true);
      t.fromX = t.x = x;
      t.fromY = t.y = y;
      t.fromZ = t.z = z;
      t.fromAngle = t.angle = angle;
      t.moving = false;
      return t;
    }
    t.moving = x !== t.fromX || y !== t.fromY || z !== t.fromZ || (!Number.isNaN(angle) && angle !== t.fromAngle);
    t.x = x;
    t.y = y;
    t.z = z;
    t.angle = angle;
    return t;
  }

  /** Brings every prop within PHYSICS.PROP_JOIN_M of (x, z) into the world. */
  private joinNear(x: number, z: number, join = PHYSICS.PROP_JOIN_M) {
    const c0 = Math.floor((x - join) / PROP_CELL_M),
      c1 = Math.floor((x + join) / PROP_CELL_M),
      r0 = Math.floor((z - join) / PROP_CELL_M),
      r1 = Math.floor((z + join) / PROP_CELL_M);
    for (let c = c0; c <= c1; c++)
      for (let r = r0; r <= r1; r++) {
        const cell = this.propCells.get(cellKey(c, r));
        if (!cell) continue;
        for (const i of cell) {
          const p = this.props[i];
          if (!this.propBodies[i] && Math.hypot(p.x - x, p.z - z) < join) this.join(i);
        }
      }
  }

  /**
   * Knocks loose every anchored prop the car's capsule, at (x, z) turned `angle`, comes within `margin` of: the car's
   * move in one step, so the prop is loose the step before the car reaches it.
   */
  private loosenAhead(x: number, z: number, angle: number, car: Target, margin: number) {
    // the capsule's z axis, turned by `angle` about the vertical, is (sin angle, cos angle)
    const ux = Math.sin(angle),
      uz = Math.cos(angle),
      reach = car.spine + car.radius + margin,
      c0 = Math.floor((x - reach - 2) / PROP_CELL_M),
      c1 = Math.floor((x + reach + 2) / PROP_CELL_M),
      r0 = Math.floor((z - reach - 2) / PROP_CELL_M),
      r1 = Math.floor((z + reach + 2) / PROP_CELL_M);
    for (let c = c0; c <= c1; c++)
      for (let r = r0; r <= r1; r++) {
        const cell = this.propCells.get(cellKey(c, r));
        if (!cell) continue;
        for (const i of cell) {
          if (!this.propBodies[i] || this.loose[i]) continue;
          const p = this.props[i],
            along = Math.max(-car.spine, Math.min(car.spine, (p.x - x) * ux + (p.z - z) * uz)),
            gap = Math.hypot(p.x - (x + ux * along), p.z - (z + uz * along)) - car.radius - this.propReach[i];
          if (gap < margin) this.setLoose(i);
        }
      }
  }

  /**
   * Puts prop i in the world, anchored exactly where it is drawn, as a mailbox on its post: fixed, so it neither settles
   * nor tips on a slope, until a car reaches it (`loosenAhead`) or a loose prop touches it (`loosenTouched`).
   */
  private join(i: number) {
    const { R } = this,
      p = this.props[i];
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.fixed()
        .setTranslation(p.x, p.baseY + p.heightM / 2, p.z)
        .setRotation(yaw(p.rotationY)),
    );
    const collider = this.world.createCollider(
      R.ColliderDesc.cuboid(p.widthM / 2, p.heightM / 2, p.depthM / 2)
        .setMass(p.massKg)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.propByCollider.set(collider.handle, i);
    for (const part of p.parts ?? []) {
      const extra = this.world.createCollider(
        R.ColliderDesc.cuboid(part.hx, part.hy, part.hz)
          .setTranslation(part.x, part.y, part.z)
          .setMass(part.massKg)
          .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
        body,
      );
      this.propByCollider.set(extra.handle, i);
    }
    this.propBodies[i] = body;
    this.joined.push(i);
  }

  /** A touch began between two colliders: an anchored prop among them that a loose prop knocked comes loose too. */
  private readonly loosenTouched = (a: number, b: number, started: boolean) => {
    if (!started) return;
    const i = this.propByCollider.get(a),
      j = this.propByCollider.get(b);
    if (i !== undefined && j !== undefined) {
      if (this.loose[i]) this.setLoose(j);
      else if (this.loose[j]) this.setLoose(i);
    }
  };

  /**
   * Puts back on its stand, anchored, every prop knocked PHYSICS.PROP_RESPAWN_S ago that the player is far from, and
   * every target knocked PHYSICS.TARGET_RESET_S ago.
   */
  private respawnFarAway() {
    const { R, loosened } = this,
      due = this.stepCount - PHYSICS.PROP_RESPAWN_S / PHYSICS_STEP_S,
      targetDue = this.stepCount - PHYSICS.TARGET_RESET_S / PHYSICS_STEP_S,
      far = PHYSICS.PROP_RESPAWN_M;
    for (let k = loosened.length - 1; k >= 0; k--) {
      const i = loosened[k],
        body = this.propBodies[i],
        p = this.props[i];
      if (!body || this.looseAtStep[i] > (p.isTarget ? targetDue : due)) continue;
      if (p.isTarget) {
        if (!this.standClear(i)) continue; // tried again a second later
      } else {
        const t = body.translation();
        if (Math.hypot(t.x - this.viewerX, t.z - this.viewerZ) < far) continue;
        if (Math.hypot(p.x - this.viewerX, p.z - this.viewerZ) < far) continue; // nor where it reappears
      }
      body.setBodyType(R.RigidBodyType.Fixed, false);
      _v.x = p.x;
      _v.y = p.baseY + p.heightM / 2;
      _v.z = p.z;
      body.setTranslation(_v, false);
      body.setRotation(yaw(p.rotationY), false);
      this.loose[i] = 0;
      this.hasPrev[i] = 0;
      loosened.splice(k, 1);
    }
  }

  /** Whether prop i's stand is free of the cars, the player, the people and the other loose props. */
  private standClear(i: number) {
    const p = this.props[i];
    for (const [body, t] of this.targets) {
      if (body === this.playerBody && this.playerAway) continue;
      if (Math.hypot(t.x - p.x, t.z - p.z) < TARGET_CLEAR_M) return false;
    }
    for (const j of this.loosened) {
      const body = this.propBodies[j];
      if (j === i || !body) continue;
      const at = body.translation();
      if (Math.hypot(at.x - p.x, at.z - p.z) < TARGET_CLEAR_PROP_M) return false;
    }
    return true;
  }

  /** Keeps prop i's pose before the step about to run, for drawnPose. */
  private keepPrev(i: number) {
    const body = this.propBodies[i];
    if (!body) return;
    if (body.isSleeping()) {
      this.hasPrev[i] = 0; // at rest: drawn where it lies, and nothing read from Rapier for it
      return;
    }
    const t = body.translation(),
      q = body.rotation(),
      k = i * 7,
      p = this.prevPose;
    p[k] = t.x;
    p[k + 1] = t.y;
    p[k + 2] = t.z;
    p[k + 3] = q.x;
    p[k + 4] = q.y;
    p[k + 5] = q.z;
    p[k + 6] = q.w;
    this.hasPrev[i] = 1;
  }

  /**
   * Takes out of the world every anchored prop that nothing is near any more: back to data, standing where it is drawn,
   * until a car comes near again. Knocked ones stay until they're back on their stand, and the targets always.
   */
  private leaveFar() {
    const { joined, props } = this,
      keepM = PHYSICS.PROP_JOIN_M + PROP_LEAVE_MARGIN_M,
      shotKeepM = PROP_SHOT_JOIN_M + PROP_LEAVE_MARGIN_M,
      forShots = !Number.isNaN(this.joinedAtX); // the weapons lab keeps the props near the player in the world
    for (let k = joined.length - 1; k >= 0; k--) {
      const i = joined[k],
        p = props[i],
        body = this.propBodies[i];
      if (!body || p.isTarget || this.loose[i]) continue;
      if (this.looseNear(p.x, p.z)) continue; // a knocked prop beside it would slide through where it stood
      if (forShots && Math.hypot(p.x - this.viewerX, p.z - this.viewerZ) < shotKeepM) continue;
      let near = false;
      for (const [b, t] of this.targets)
        if (!(b === this.playerBody && this.playerAway) && Math.hypot(t.x - p.x, t.z - p.z) < keepM) {
          near = true;
          break;
        }
      if (near) continue;
      for (let c = 0; c < body.numColliders(); c++) this.propByCollider.delete(body.collider(c).handle);
      this.world.removeRigidBody(body);
      this.propBodies[i] = null;
      this.hasPrev[i] = 0;
      joined[k] = joined[joined.length - 1];
      joined.pop();
    }
  }

  /** Whether a knocked prop lies within PHYSICS.PROP_JOIN_M of (x, z). */
  private looseNear(x: number, z: number) {
    for (const j of this.loosened) {
      const body = this.propBodies[j];
      if (!body) continue;
      const at = body.translation();
      if (Math.hypot(at.x - x, at.z - z) < PHYSICS.PROP_JOIN_M) return true;
    }
    return false;
  }

  private setLoose(i: number) {
    if (this.loose[i]) return;
    this.loose[i] = 1;
    this.hasPrev[i] = 0; // its first step starts from where it stood
    this.looseAtStep[i] = this.stepCount;
    this.loosened.push(i);
    const body = this.propBodies[i];
    if (!body) return;
    body.setBodyType(this.R.RigidBodyType.Dynamic, true);
    body.enableCcd(true); // thrown at 20 to 40 m/s, it would pass through a wall, which is one triangle thick
  }
}

const cellKey = (c: number, r: number) => (c + CELL_OFFSET) * CELL_STRIDE + r + CELL_OFFSET;

/** A turn of `angle` about the vertical, as a quaternion. */
function yaw(angle: number) {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

/**
 * The terrain as one triangle mesh, from the elevation grid alone, split along the same diagonal as its drawn mesh
 * (src/world/mesh/terrain.ts): about 15,000 triangles. The drawn mesh also refines the cells by the water, which would
 * take it to 230,000 triangles and Rapier's memory from 10 MB to 48 MB, so by the water Rapier's ground is the coarser one.
 */
function groundTriangles(field: Ground) {
  const n = field.samples,
    vertices = new Float32Array(n * n * 3),
    indices = new Uint32Array((n - 1) * (n - 1) * 6);
  for (let j = 0, v = 0; j < n; j++)
    for (let i = 0; i < n; i++, v += 3) {
      vertices[v] = field.sampleCoord(i);
      vertices[v + 1] = field.sampleHeight(i, j);
      vertices[v + 2] = field.sampleCoord(j);
    }
  for (let j = 0, t = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++, t += 6) {
      const k = j * n + i;
      indices.set([k, k + n, k + 1, k + 1, k + n, k + n + 1], t);
    }
  return { vertices, indices };
}

/** Every building's walls as one triangle mesh, from below its lowest corner up to its roof's edge. */
function wallTriangles(data: WorldData, heightfield: Pick<Heightfield, 'heightAt'>) {
  const vertices: number[] = [],
    indices: number[] = [];
  forEachBuilding(data, heightfield, ({ ring, yAt, base }: BuildingShape) => {
    const m = ring.length;
    for (let i = 0; i < m; i++) {
      const a = ring[i],
        d = ring[(i + 1) % m],
        k = vertices.length / 3;
      vertices.push(a.x, base - WALL_FOOT_M, a.z, d.x, base - WALL_FOOT_M, d.z, d.x, yAt(d), d.z, a.x, yAt(a), a.z);
      indices.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
  });
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
