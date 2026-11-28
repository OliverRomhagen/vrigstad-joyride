// The Rapier trial's props, drawn (#54, ?lab=rapier): a mailbox, bin or lamp stays in its batch of street furniture
// until it's knocked, then is drawn as an object of its own that follows its body, until it is put back on its stand.
// Reads the physics world, never writes it.
import * as THREE from 'three';
import type { FurniturePlacement } from '../../world/furniture/placement';
import type { StreetFurniture } from '../../world/mesh/street-furniture';
import type { PhysicsWorld, PropPose } from '../sim/physics-world';

const _v = new THREE.Vector3();
const _pose: PropPose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

export interface PhysicsPropsDeps {
  scene: THREE.Scene;
  furniture: Pick<StreetFurniture, 'detach' | 'reattach'>;
  world: Pick<PhysicsWorld, 'loosened' | 'isLoose' | 'isAwake' | 'propPose'>;
  /** the placement behind each of the world's props, in the same order */
  placements: readonly FurniturePlacement[];
  /** each prop's height (m): the body's middle is this far above the model's foot */
  heights: readonly number[];
}

export class PhysicsProps {
  private readonly g: PhysicsPropsDeps;
  private readonly drawn: (THREE.Object3D | null)[];
  /** the props drawn on their own, by index */
  private readonly detached: number[] = [];

  constructor(g: PhysicsPropsDeps) {
    this.g = g;
    this.drawn = g.placements.map(() => null);
  }

  /** Moves every knocked prop's model to its body, taking it out of its batch the first time it leaves its stand. */
  update() {
    const { scene, furniture, world, placements, heights } = this.g;
    // back on its stand: back in its batch
    for (let k = this.detached.length - 1; k >= 0; k--) {
      const i = this.detached[k];
      if (world.isLoose(i)) continue;
      furniture.reattach(placements[i]);
      this.drawn[i] = null;
      this.detached.splice(k, 1);
    }
    for (const i of world.loosened) {
      let model = this.drawn[i];
      if (!model) {
        model = furniture.detach(placements[i]);
        if (!model) continue;
        scene.add(model);
        this.drawn[i] = model;
        this.detached.push(i);
      } else if (!world.isAwake(i)) continue;
      const p = world.propPose(i, _pose);
      model.quaternion.set(p.qx, p.qy, p.qz, p.qw);
      _v.set(0, -heights[i] / 2, 0).applyQuaternion(model.quaternion);
      model.position.set(p.x + _v.x, p.y + _v.y, p.z + _v.z);
    }
  }
}
