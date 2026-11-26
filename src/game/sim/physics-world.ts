// The Rapier trial (#54, ?lab=rapier, docs/rapier-trial.md): one Rapier world beside the game's own collisions, which
// stay in charge. The ground and the buildings' walls are fixed shapes; the cars and the player are shapes the game
// moves, so driving and walking feel as they do; mailboxes and bins are bodies that a car knocks over. Pure: no
// three.js, no DOM. The Rapier module is passed in, so the page decides how it is loaded.
import type RAPIER from '@dimforge/rapier3d-compat';
import { type BuildingShape, forEachBuilding } from '../../world/buildings';
import type { WorldData } from '../../world/data';
import type { Heightfield } from '../../world/heightfield';
import type { CarBody } from './car-body';

export type Rapier = typeof RAPIER;
type Body = InstanceType<Rapier['RigidBody']>;

/** Rapier steps at this fixed time step, whatever the frame rate, catching up when a frame is long (s) */
export const PHYSICS_STEP_S = 1 / 60;
/** the most steps one frame catches up; a longer stall is dropped rather than run all at once */
const MAX_STEPS_PER_FRAME = 4;
/** the ground's grid, as Rapier sees it: a height every this many metres (m) */
const GROUND_CELL_M = 2;
/** the walls reach this far below the lowest corner, so nothing slips under one on a slope (m) */
const WALL_FOOT_M = 1;
/** the player as Rapier sees them: an upright capsule (m) */
const PLAYER_RADIUS_M = 0.4,
  PLAYER_HALF_HEIGHT_M = 0.5;
/**
 * A prop joins Rapier's world when a car or the player comes this close, and stays (m). Until then it is only data, so
 * the world holds the few dozen props near the action, not every one in the village.
 */
const PROP_JOIN_M = 12;
/** props are found by a grid of cells this size (m) */
const PROP_CELL_M = 16;
/** Something that falls over: a box of its size standing on the ground at (x, z), turned rotationY about the vertical. */
export interface PropSpec {
  x: number;
  z: number;
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
  heightfield: Pick<Heightfield, 'heightAt'>;
  /** half the playable square (m) */
  half: number;
  props: readonly PropSpec[];
}

/**
 * One Rapier world for the village. `follow` moves the cars and the player to where the game put them and brings the
 * props near them into the world, `step` runs the simulation for a frame, and `propPose` reads where a prop has gone.
 */
export class PhysicsWorld {
  /** the time the last frame's steps took (ms) */
  stepMs = 0;
  /** the props in Rapier's world, by index: the ones a car or the player has come near */
  readonly joined: number[] = [];
  private readonly R: Rapier;
  private readonly world: InstanceType<Rapier['World']>;
  private readonly heightAt: (x: number, z: number) => number;
  private readonly props: readonly PropSpec[];
  private readonly propBodies: (Body | null)[];
  /** whether each prop has been knocked loose: anchored where it stands until a car or the player touches it */
  private readonly loose: Uint8Array;
  /** which prop each joined prop's collider belongs to, by the collider's handle */
  private readonly propByCollider = new Map<number, number>();
  private readonly events: InstanceType<Rapier['EventQueue']>;
  private readonly propCells = new Map<string, number[]>();
  private readonly carBodies = new Map<CarBody, Body>();
  private readonly playerBody: Body;
  private readonly seen = new Set<CarBody>();
  private carry = 0;

  constructor(R: Rapier, { data, heightfield, half, props }: PhysicsWorldOptions) {
    this.R = R;
    this.heightAt = (x, z) => heightfield.heightAt(x, z);
    this.props = props;
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
    const fixed = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    const ground = groundHeights(this.heightAt, half, GROUND_CELL_M);
    this.world.createCollider(
      R.ColliderDesc.heightfield(ground.cells, ground.cells, ground.heights, { x: half * 2, y: 1, z: half * 2 }),
      fixed,
    );
    const walls = wallTriangles(data, heightfield);
    if (walls.indices.length) this.world.createCollider(R.ColliderDesc.trimesh(walls.vertices, walls.indices), fixed);
    this.playerBody = this.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -1000, 0), // out of the way until `follow` places it
    );
    this.world.createCollider(R.ColliderDesc.capsule(PLAYER_HALF_HEIGHT_M, PLAYER_RADIUS_M), this.playerBody);
    this.world.step(); // ray casts read the broad phase, which a step builds: one now, so they work before the first frame
  }

  /** Moves the cars and the player to where the game put them this frame, and brings the props near them into the world. */
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
      body.setNextKinematicTranslation({ x: car.x, y: this.heightAt(car.x, car.z) + r, z: car.z });
      // the game's heading h points the car at (sin h, -cos h); a turn of π - h about y takes z there
      body.setNextKinematicRotation(yaw(Math.PI - car.h));
      this.joinNear(car.x, car.z);
    }
    for (const [car, body] of this.carBodies)
      if (!seen.has(car)) {
        this.world.removeRigidBody(body);
        this.carBodies.delete(car);
      }
    if (player) {
      const y = this.heightAt(player.x, player.z) + PLAYER_RADIUS_M + PLAYER_HALF_HEIGHT_M;
      this.playerBody.setNextKinematicTranslation({ x: player.x, y, z: player.z });
      this.joinNear(player.x, player.z);
    } else this.playerBody.setNextKinematicTranslation({ x: 0, y: -1000, z: 0 }); // in a car: out of the way
  }

  /** Runs the steps this frame's time asks for; returns how many ran. */
  step(dt: number, now: () => number = () => 0) {
    const t0 = now();
    this.carry = Math.min(this.carry + dt, PHYSICS_STEP_S * MAX_STEPS_PER_FRAME);
    let steps = 0;
    while (this.carry >= PHYSICS_STEP_S) {
      this.world.step(this.events);
      this.events.drainCollisionEvents(this.loosen);
      this.carry -= PHYSICS_STEP_S;
      steps++;
    }
    this.stepMs = now() - t0;
    return steps;
  }

  /** How many props are awake: moving, or settling. */
  get awakeProps() {
    let n = 0;
    for (const i of this.joined) if (this.isAwake(i)) n++;
    return n;
  }

  /** Whether prop i is in the world and awake: moving, or settling. A sleeping prop stays where it last came to rest. */
  isAwake(i: number) {
    const body = this.propBodies[i];
    return !!body && this.loose[i] === 1 && !body.isSleeping(); // an anchored body never says it sleeps
  }

  /** Whether prop i has been knocked loose. Until then it stands, anchored, exactly where it is drawn. */
  isLoose(i: number) {
    return this.loose[i] === 1;
  }

  /** Writes where prop i is into `out`: where Rapier has it, or where it stands if it hasn't joined. */
  propPose(i: number, out: PropPose) {
    const body = this.propBodies[i];
    if (!body) {
      const p = this.props[i],
        q = yaw(p.rotationY);
      out.x = p.x;
      out.y = this.heightAt(p.x, p.z) + p.heightM / 2;
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
    const hit = this.world.castRay(new this.R.Ray({ x, y, z }, { x: dx, y: dy, z: dz }), maxM, true);
    return hit ? hit.timeOfImpact : null;
  }

  dispose() {
    this.world.free();
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
   * Puts prop i in the world, anchored where it stands on the game's ground, as a mailbox on its post: fixed, so it
   * neither settles nor tips on a slope, until a car or the player touches it (`loosen`).
   */
  private join(i: number) {
    const { R } = this,
      p = this.props[i];
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.fixed()
        .setTranslation(p.x, this.heightAt(p.x, p.z) + p.heightM / 2, p.z)
        .setRotation(yaw(p.rotationY)),
    );
    const collider = this.world.createCollider(
      R.ColliderDesc.cuboid(p.widthM / 2, p.heightM / 2, p.depthM / 2)
        .setMass(p.massKg)
        // a fixed body touching a car or the player, which Rapier skips by default: the touch that knocks it loose
        .setActiveCollisionTypes(R.ActiveCollisionTypes.DEFAULT | R.ActiveCollisionTypes.KINEMATIC_FIXED)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.propBodies[i] = body;
    this.propByCollider.set(collider.handle, i);
    this.joined.push(i);
  }

  /** A touch began: a prop it involves comes loose, and the next step lets whatever touched it push it over. */
  private readonly loosen = (a: number, b: number, started: boolean) => {
    if (!started) return;
    for (const handle of [a, b]) {
      const i = this.propByCollider.get(handle);
      if (i === undefined || this.loose[i]) continue;
      this.loose[i] = 1;
      this.propBodies[i]?.setBodyType(this.R.RigidBodyType.Dynamic, true);
    }
  };
}

const cellKey = (c: number, r: number) => `${c},${r}`;

/** A turn of `angle` about the vertical, as a quaternion. */
function yaw(angle: number) {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

/**
 * The ground as Rapier's heightfield wants it: `cells` + 1 heights a side over the square from -half to half, listed
 * column by column (Rapier's matrices are column-major), each column one x and its rows running along z.
 */
function groundHeights(heightAt: (x: number, z: number) => number, half: number, cellM: number) {
  const cells = Math.round((half * 2) / cellM),
    step = (half * 2) / cells,
    heights = new Float32Array((cells + 1) * (cells + 1));
  for (let col = 0; col <= cells; col++)
    for (let row = 0; row <= cells; row++)
      heights[col * (cells + 1) + row] = heightAt(-half + col * step, -half + row * step);
  return { cells, heights };
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
