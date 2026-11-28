// Draws the people your car knocked over (src/game/ragdolls.ts): the same boxes as personParts, but each limb on its own,
// while the pedestrian's own mesh is hidden; once they are up, their own mesh comes back where they stand.
import * as THREE from 'three';
import type { BoxPart } from '../box-part';
import type { KnockedDown } from '../ragdolls';
import { HEAD, L_FOOT, L_HAND, L_HIP, L_SHOULDER, R_FOOT, R_HAND, R_HIP, R_SHOULDER } from '../sim/ragdoll';

/** What the ragdoll meshes read from the rest of the game. */
export interface RagdollMeshDeps {
  scene: THREE.Scene;
  groundAt(x: number, z: number): number;
  geoCache: Record<string, THREE.BufferGeometry>;
  boxGeo(parts: BoxPart[]): THREE.BufferGeometry;
  paintMat: THREE.Material;
  blob(parent: THREE.Object3D, w: number, l: number): THREE.Object3D;
  ragdolls: { readonly bodies: readonly KnockedDown[] };
}

/** The six boxes that draw one knocked-over person. */
interface Drawn {
  body: KnockedDown;
  group: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Mesh;
  arms: THREE.Mesh[];
  legs: THREE.Mesh[];
  shadow: THREE.Object3D; // a blob on the ground under the torso, as the person had standing
}

const _a = new THREE.Vector3(),
  _b = new THREE.Vector3(),
  _x = new THREE.Vector3(),
  _y = new THREE.Vector3(),
  _z = new THREE.Vector3();
const _m = new THREE.Matrix4(),
  UP = new THREE.Vector3(0, 1, 0);
const at = (p: number[], i: number, v: THREE.Vector3) => v.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);

/** Keeps a set of boxes for each person who is down, and moves them to where the physics has them. */
export class RagdollMeshes {
  private readonly g: RagdollMeshDeps;
  private readonly drawn: Drawn[] = [];

  constructor(g: RagdollMeshDeps) {
    this.g = g;
  }

  /** Call after the ragdolls' update: draws the new ones, puts back the ones who got up, and moves the rest. */
  update(): void {
    const { scene, groundAt, ragdolls } = this.g,
      { drawn } = this;
    for (let i = drawn.length - 1; i >= 0; i--) {
      if (ragdolls.bodies.includes(drawn[i].body)) continue;
      // up again (or despawned): the crowd moved on before this, so their mesh is still where they were hit
      const n = drawn[i].body.npc;
      n.mesh.visible = true;
      n.mesh.position.set(n.x, groundAt(n.x, n.z), n.z);
      n.mesh.rotation.y = -n.h;
      scene.remove(drawn[i].group);
      drawn.splice(i, 1);
    }
    for (const body of ragdolls.bodies) if (!this.isDrawn(body)) drawn.push(this.dress(body));
    for (const d of drawn) this.sync(d);
  }

  private isDrawn(body: KnockedDown): boolean {
    for (const d of this.drawn) if (d.body === body) return true;
    return false;
  }

  private dress(body: KnockedDown): Drawn {
    const { shirt, pants, hair, skin } = body.npc.look,
      part = (key: string, parts: BoxPart[]) => {
        this.g.geoCache[key] ??= this.g.boxGeo(parts);
        const m = new THREE.Mesh(this.g.geoCache[key], this.g.paintMat); // no real shadow, as when they stood (#425)
        m.scale.setScalar(body.r.scale);
        return m;
      };
    const torso = part('rag-torso' + shirt, [[0.5, 0.65, 0.28, 0, 0, 0, shirt]]);
    const head = part('rag-head' + skin + hair, [
      [0.27, 0.27, 0.27, 0, 0, 0, skin],
      [0.29, 0.1, 0.29, 0, 0.16, 0, hair],
    ]);
    const arms = [0, 1].map(() => part('rag-arm' + shirt, [[0.14, 0.6, 0.16, 0, 0, 0, shirt]]));
    const legs = [0, 1].map(() => part('rag-leg' + pants, [[0.19, 0.8, 0.21, 0, 0, 0, pants]]));
    const group = new THREE.Group();
    group.add(torso, head, ...arms, ...legs);
    const shadow = this.g.blob(group, 1.1, 1.1);
    body.npc.mesh.visible = false;
    this.g.scene.add(group);
    return { body, group, torso, head, arms, legs, shadow };
  }

  private sync(d: Drawn) {
    const p = d.body.shown;
    // torso: right is from the left side to the right, up from the hips to the shoulders
    at(p, R_SHOULDER, _a).add(at(p, R_HIP, _b));
    at(p, L_SHOULDER, _x).add(at(p, L_HIP, _y));
    _x.subVectors(_a, _x);
    at(p, L_SHOULDER, _a).add(at(p, R_SHOULDER, _b));
    at(p, L_HIP, _y).add(at(p, R_HIP, _z));
    _y.subVectors(_a, _y).normalize();
    _x.addScaledVector(_y, -_x.dot(_y)).normalize();
    _z.crossVectors(_x, _y);
    _m.makeBasis(_x, _y, _z);
    d.torso.quaternion.setFromRotationMatrix(_m);
    d.head.quaternion.copy(d.torso.quaternion);
    at(p, L_SHOULDER, _a)
      .add(at(p, R_SHOULDER, _b))
      .add(at(p, L_HIP, _x))
      .add(at(p, R_HIP, _z))
      .multiplyScalar(0.25);
    d.torso.position.copy(_a);
    d.shadow.position.set(_a.x, this.g.groundAt(_a.x, _a.z) + 0.06, _a.z);
    d.head.position.copy(at(p, HEAD, _a));
    limb(d.arms[0], L_SHOULDER, L_HAND, p);
    limb(d.arms[1], R_SHOULDER, R_HAND, p);
    limb(d.legs[0], L_HIP, L_FOOT, p);
    limb(d.legs[1], R_HIP, R_FOOT, p);
  }
}

// a limb is a box centred between its two points, its long side along the line from one to the other
function limb(m: THREE.Mesh, from: number, to: number, p: number[]) {
  at(p, from, _a);
  at(p, to, _b);
  _x.subVectors(_a, _b).normalize();
  m.quaternion.setFromUnitVectors(UP, _x);
  m.position.copy(_a.add(_b).multiplyScalar(0.5));
}
