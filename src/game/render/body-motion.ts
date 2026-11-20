import type * as THREE from 'three';
import { type BodyForces, type BodyState, restingBody, type Suspension, stepBody } from './suspension';

// Reads only what the simulation already has: position, heading and speed. The ride height comes from the
// mesh, which placeCar puts on the ground.
type Car = { mesh: THREE.Object3D; x: number; z: number; h: number; v: number };
type Entry = {
  suspension: Suspension;
  state: BodyState;
  nodes: THREE.Object3D[]; // the sprung parts: they tilt, the wheels and blob shadow stay put
  x: number;
  z: number;
  h: number;
  v: number;
  y: number;
  vy: number;
  fresh: boolean;
};
const ACTIVE_RANGE_M = 150, // further away, bodies rest level: nobody sees them rock
  TELEPORT_M = 20, // a jump this far in one frame is a respawn or a reset, not a drive
  MAX_FORCE_MS2 = 40; // a wall stops a car in one frame; don't let that one frame fling the body

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clampForce = (a: number) => Math.max(-MAX_FORCE_MS2, Math.min(MAX_FORCE_MS2, a));
const _forces: BodyForces = { lateral: 0, longitudinal: 0, vertical: 0 };

// Rendering only: tilts each car's sprung nodes from how the car moved since the last frame.
export class BodyMotion {
  private readonly entries = new Map<Car, Entry>();
  add(car: Car, suspension: Suspension, ...nodes: THREE.Object3D[]) {
    this.entries.set(car, {
      suspension,
      state: restingBody(),
      nodes,
      x: car.x,
      z: car.z,
      h: car.h,
      v: car.v,
      y: 0,
      vy: 0,
      fresh: true,
    });
  }
  /** Adds a part that loads later, such as the detailed model's body. */
  addNode(car: Car, node: THREE.Object3D) {
    const e = this.entries.get(car);
    if (!e) return;
    e.nodes.push(node);
    this.apply(e);
  }
  remove(car: Car) {
    this.entries.delete(car);
  }
  update(focus: { x: number; z: number }, dt: number) {
    if (dt <= 0) return;
    for (const [car, e] of this.entries) {
      const y = car.mesh.position.y,
        vy = (y - e.y) / dt;
      if (
        e.fresh ||
        Math.hypot(car.x - e.x, car.z - e.z) > TELEPORT_M ||
        Math.hypot(car.x - focus.x, car.z - focus.z) > ACTIVE_RANGE_M
      ) {
        Object.assign(e.state, restingBody());
        e.vy = 0;
      } else {
        _forces.lateral = clampForce((car.v * wrap(car.h - e.h)) / dt); // centripetal: v × yaw rate
        _forces.longitudinal = clampForce((car.v - e.v) / dt);
        _forces.vertical = clampForce((vy - e.vy) / dt);
        stepBody(e.state, _forces, e.suspension, dt);
        e.vy = vy;
      }
      e.fresh = false;
      e.x = car.x;
      e.z = car.z;
      e.h = car.h;
      e.v = car.v;
      e.y = y;
      this.apply(e);
    }
  }
  private apply(e: Entry) {
    // The car's frame is −Z forward, +X right: +x rotation lifts the nose, +z rotation leans the roof left.
    for (const node of e.nodes) {
      node.rotation.set(e.state.pitch, 0, e.state.roll);
      node.position.y = e.state.heave;
    }
  }
  state(car: Car) {
    const e = this.entries.get(car);
    return e ? { roll: e.state.roll, pitch: e.state.pitch, heave: e.state.heave } : null;
  }
}
