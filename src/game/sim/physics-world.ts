// The Rapier trial (#54, ?lab=rapier, docs/rapier-trial.md): one Rapier world beside the game's own collisions, which
// stay in charge. The ground and the buildings' walls are fixed shapes; the cars and the player are shapes the game
// moves, so driving and walking feel as they do; mailboxes and bins are bodies that a car knocks over. Pure: no
// three.js, no DOM. The Rapier module is passed in, so the page decides how it is loaded.
import type RAPIER from '@dimforge/rapier3d-compat';
import { type BuildingShape, forEachBuilding } from '../../world/buildings';
import type { WorldData } from '../../world/data';
import type { Heightfield } from '../../world/heightfield';
import { type CarBody, PERSON_RADIUS_M } from './car-body';

export type Rapier = typeof RAPIER;
type Body = InstanceType<Rapier['RigidBody']>;
/** the terrain as its mesh is built (src/world/mesh/terrain.ts), so Rapier's ground is the drawn ground */
type Ground = Pick<Heightfield, 'samples' | 'sampleCoord' | 'sampleHeight' | 'cellDetail' | 'fineHeight' | 'heightAt'>;

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
/**
 * A prop joins Rapier's world when a car comes this close, and stays (m). Until then it is only data, so the world
 * holds the props near the cars, not every one in the village.
 */
const PROP_JOIN_M = 12;
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
}

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
  /** the props knocked loose, by index, in the order they came loose */
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
  /** which prop each joined prop's collider belongs to, by the collider's handle */
  private readonly propByCollider = new Map<number, number>();
  private readonly events: InstanceType<Rapier['EventQueue']>;
  private readonly ray: InstanceType<Rapier['Ray']>;
  private readonly propCells = new Map<number, number[]>();
  private readonly carBodies = new Map<CarBody, Body>();
  private readonly playerBody: Body;
  private readonly seen = new Set<CarBody>();
  private readonly targets = new Map<Body, Target>();
  private carry = 0;
  private stepCount = 0;
  private lastStepMs = 0;

  constructor(R: Rapier, { data, heightfield, props }: PhysicsWorldOptions) {
    this.R = R;
    this.heightAt = (x, z) => heightfield.heightAt(x, z);
    this.props = props;
    this.propReach = Float64Array.from(props, p => Math.hypot(p.widthM, p.depthM) / 2);
    this.propBodies = props.map(() => null);
    this.loose = new Uint8Array(props.length);
    props.forEach((p, i) => {
      const key = cellKey(Math.floor(p.x / PROP_CELL_M), Math.floor(p.z / PROP_CELL_M)),
        cell = this.propCells.get(key);
      if (cell) cell.push(i);
      else this.propCells.set(key, [i]);
    });
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PHYSICS_STEP_S;
    this.events = new R.EventQueue(true);
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    const fixed = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    const ground = groundTriangles(heightfield);
    this.world.createCollider(R.ColliderDesc.trimesh(ground.vertices, ground.indices), fixed);
    const walls = wallTriangles(data, heightfield);
    if (walls.indices.length) this.world.createCollider(R.ColliderDesc.trimesh(walls.vertices, walls.indices), fixed);
    this.playerBody = this.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -1000, 0), // out of the way until `follow` places it
    );
    this.world.createCollider(R.ColliderDesc.capsule(PLAYER_HALF_HEIGHT_M, PERSON_RADIUS_M), this.playerBody);
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
  follow(cars: readonly CarBody[], player: { x: number; z: number } | null) {
    const { R, seen } = this;
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
        this.world.createCollider(
          R.ColliderDesc.capsule(half, r).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }),
          body,
        );
        this.carBodies.set(car, body);
      }
      // the game's heading h points the car at (sin h, -cos h); a turn of π - h about y takes z there
      const target = this.aim(body, car.x, this.heightAt(car.x, car.z) + r, car.z, Math.PI - car.h);
      target.radius = r;
      target.spine = half;
      if (target.moving) this.joinNear(car.x, car.z); // a parked car has joined what is near it already
    }
    for (const [car, body] of this.carBodies)
      if (!seen.has(car)) {
        this.world.removeRigidBody(body);
        this.carBodies.delete(car);
        this.targets.delete(body);
      }
    if (player) {
      const y = this.heightAt(player.x, player.z) + PERSON_RADIUS_M + PLAYER_HALF_HEIGHT_M;
      this.aim(this.playerBody, player.x, y, player.z, Number.NaN);
    } else this.aim(this.playerBody, 0, -1000, 0, Number.NaN); // in a car: out of the way
  }

  /** Runs the steps this frame's time asks for; returns how many ran. */
  step(dt: number, now: () => number = () => 0) {
    const t0 = now();
    this.carry = Math.min(this.carry + dt, PHYSICS_STEP_S * MAX_STEPS_PER_FRAME);
    const steps = Math.floor(this.carry / PHYSICS_STEP_S + 1e-9);
    this.carry -= steps * PHYSICS_STEP_S;
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
      this.world.step(this.events);
      this.events.drainCollisionEvents(this.loosenTouched);
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
    this.stepCount += steps;
    this.lastStepMs = now() - t0;
    return steps;
  }

  /** How many props are awake: moving, or settling. */
  get awakeProps() {
    let n = 0;
    for (const i of this.loosened) if (this.isAwake(i)) n++;
    return n;
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

  /** Brings every prop within PROP_JOIN_M of (x, z) into the world. */
  private joinNear(x: number, z: number) {
    const c0 = Math.floor((x - PROP_JOIN_M) / PROP_CELL_M),
      c1 = Math.floor((x + PROP_JOIN_M) / PROP_CELL_M),
      r0 = Math.floor((z - PROP_JOIN_M) / PROP_CELL_M),
      r1 = Math.floor((z + PROP_JOIN_M) / PROP_CELL_M);
    for (let c = c0; c <= c1; c++)
      for (let r = r0; r <= r1; r++) {
        const cell = this.propCells.get(cellKey(c, r));
        if (!cell) continue;
        for (const i of cell) {
          const p = this.props[i];
          if (!this.propBodies[i] && Math.hypot(p.x - x, p.z - z) < PROP_JOIN_M) this.join(i);
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
    this.propBodies[i] = body;
    this.propByCollider.set(collider.handle, i);
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

  private setLoose(i: number) {
    if (this.loose[i]) return;
    this.loose[i] = 1;
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
 * The terrain as one triangle mesh, built exactly as its drawn mesh is (src/world/mesh/terrain.ts): the elevation grid's
 * cells, and the refined cells by the water with their own finer grids, split along the same diagonal.
 */
function groundTriangles(field: Ground) {
  const n = field.samples,
    at = (i: number) => field.sampleCoord(i),
    vertices: number[] = [],
    indices: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) vertices.push(at(i), field.sampleHeight(i, j), at(j));
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const m = field.cellDetail(i, j);
      if (m < 2) {
        const k = j * n + i;
        indices.push(k, k + n, k + 1, k + 1, k + n, k + n + 1);
        continue;
      }
      const first = vertices.length / 3,
        x0 = at(i),
        z0 = at(j),
        side = at(i + 1) - x0;
      for (let b = 0; b <= m; b++)
        for (let a = 0; a <= m; a++)
          vertices.push(x0 + (side * a) / m, field.fineHeight(i, j, a, b), z0 + (side * b) / m);
      for (let b = 0; b < m; b++)
        for (let a = 0; a < m; a++) {
          const k = first + b * (m + 1) + a;
          indices.push(k, k + m + 1, k + 1, k + 1, k + m + 1, k + m + 2);
        }
    }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
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
