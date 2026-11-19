// Ragdolls (?lab=ragdoll; part of #35): a pedestrian hit by your car at speed flies, tumbles and lies still for a moment, then gets up
// and runs back to where they were walking. The physics is in ./ragdoll.ts; this file draws it and hands people back to the crowd.
// No stars yet: the lab can't change the rules (DESIGN.md, "Lab"). That's for when it leaves the lab.
import * as THREE from 'three';
import { LOST_MAX_S, type Npc } from '../../game/pedestrians';
import { makeRnd } from '../../world/random';
import {
  HEAD, type HitCar, knockOver, L_FOOT, L_HAND, L_HIP, L_SHOULDER, type Pusher, R_FOOT, R_HAND, R_HIP, R_SHOULDER, type Ragdoll,
  ragdollCentre, type RagdollWorld, STEP_S, stepRagdoll,
} from './ragdoll';

const RAGDOLL_MAX = 6, RAGDOLL_MAX_COARSE = 3;   // at most this many at once (six draw calls each); on a touch screen. More hits just push people aside
const MAX_STEPS = 4;                             // physics steps per frame at most, so a slow frame doesn't snowball
const CAR_PUSH_M = 1.6;                          // your car shoves a lying body within this radius of its middle (m)
const SKIN = '#e2b796';                          // personParts' skin colour

type BoxPart = [number, number, number, number, number, number, string];   // [sx, sy, sz, x, y, z, colour], as boxGeo in main.ts takes it

/** What the ragdolls read from the rest of the game. The getters are read when used. */
export interface RagdollDeps {
  scene: THREE.Scene;
  world: RagdollWorld;
  crowd: { readonly npcs: readonly Npc[] };
  coarse: boolean;
  geoCache: Record<string, THREE.BufferGeometry>;
  boxGeo(parts: BoxPart[]): THREE.BufferGeometry;
  paintMat: THREE.Material;
  /** your car, when you drive one; only your car knocks people over */
  readonly pcar: HitCar | null;
}

/** One knocked-over pedestrian: its physics, and the six boxes that draw it while its own mesh is hidden. */
interface Body { npc: Npc; r: Ragdoll; group: THREE.Group; torso: THREE.Mesh; head: THREE.Mesh; arms: THREE.Mesh[]; legs: THREE.Mesh[] }

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
const at = (p: number[], i: number, v: THREE.Vector3) => v.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);

/** The pedestrians knocked over by your car. */
export class Ragdolls {
  private readonly g: RagdollDeps;
  private readonly bodies: Body[] = [];
  private readonly max: number;
  private readonly rnd = makeRnd(3535);   // own stream: how each one tumbles doesn't shift the game's rolls
  private readonly pushers: Pusher[] = [{ x: 0, z: 0, r: CAR_PUSH_M }];
  private acc = 0;                        // s of physics not stepped yet

  constructor(g: RagdollDeps) {
    this.g = g;
    this.max = g.coarse ? RAGDOLL_MAX_COARSE : RAGDOLL_MAX;
  }

  /** How many are down right now. */
  get count(): number {
    return this.bodies.length;
  }

  /** The crowd's hit hook: knocks n over if `car` is yours and fast enough, and there's room for one more. An arrow, so it can be passed on. */
  readonly hit = (n: Npc, car: { x: number; z: number }): boolean => {
    const pcar = this.g.pcar;
    if (car !== pcar || !pcar || this.bodies.length >= this.max) return false;
    const r = knockOver(n, pcar, this.g.world, this.rnd(), n.mesh.scale.x);
    if (!r) return false;
    n.mesh.visible = false;
    this.bodies.push(this.dress(n, r));
    return true;
  };

  /** Steps the physics on a fixed timestep, hands back the ones that are up again, and moves the boxes. */
  update(dt: number): void {
    const { world, crowd, pcar, scene } = this.g;
    this.acc += dt;
    const steps = Math.min(MAX_STEPS, Math.floor(this.acc / STEP_S));
    this.acc = steps === MAX_STEPS ? 0 : this.acc - steps * STEP_S;
    const pushers = pcar ? this.pushers : [];
    if (pcar) { this.pushers[0].x = pcar.x; this.pushers[0].z = pcar.z; }
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      if (!crowd.npcs.includes(b.npc)) { scene.remove(b.group); this.bodies.splice(i, 1); continue; }   // despawned while down
      for (let s = 0; s < steps; s++) stepRagdoll(b.r, world, pushers);
      if (b.r.state === 'done') {
        const { x, z } = ragdollCentre(b.r), n = b.npc;
        n.x = x; n.z = z; n.h = b.r.h; n.idle = 0; n.down = false; n.lost = LOST_MAX_S; n.mesh.visible = true;
        // the crowd moved on before this, so its mesh is still where it was hit: put it where they stand, or it shows there for a frame
        n.mesh.position.set(x, world.groundAt(x, z), z); n.mesh.rotation.y = -n.h;
        scene.remove(b.group); this.bodies.splice(i, 1); continue;
      }
      this.sync(b);
    }
  }

  // the same boxes as personParts, but each limb on its own, centred, so it can turn between two points
  private dress(npc: Npc, r: Ragdoll): Body {
    const { shirt, pants, hair } = npc.look, part = (key: string, parts: BoxPart[]) => {
      const m = new THREE.Mesh(this.g.geoCache[key] || (this.g.geoCache[key] = this.g.boxGeo(parts)), this.g.paintMat);
      m.castShadow = true; m.scale.setScalar(r.s); return m;
    };
    const torso = part('rag-torso' + shirt, [[0.5, 0.65, 0.28, 0, 0, 0, shirt]]);
    const head = part('rag-head' + hair, [[0.27, 0.27, 0.27, 0, 0, 0, SKIN], [0.29, 0.1, 0.29, 0, 0.16, 0, hair]]);
    const arms = [0, 1].map(() => part('rag-arm' + shirt, [[0.14, 0.6, 0.16, 0, 0, 0, shirt]]));
    const legs = [0, 1].map(() => part('rag-leg' + pants, [[0.19, 0.8, 0.21, 0, 0, 0, pants]]));
    const group = new THREE.Group();
    group.add(torso, head, ...arms, ...legs);
    const body = { npc, r, group, torso, head, arms, legs };
    this.sync(body);
    this.g.scene.add(group);
    return body;
  }

  private sync(b: Body) {
    const p = b.r.p, put = (m: THREE.Object3D, v: THREE.Vector3) => m.position.copy(v);
    // torso: right is from the left side to the right, up from the hips to the shoulders
    at(p, R_SHOULDER, _a).add(at(p, R_HIP, _b)); at(p, L_SHOULDER, _x).add(at(p, L_HIP, _y)); _x.subVectors(_a, _x);
    at(p, L_SHOULDER, _a).add(at(p, R_SHOULDER, _b)); at(p, L_HIP, _y).add(at(p, R_HIP, _z)); _y.subVectors(_a, _y).normalize();
    _x.addScaledVector(_y, -_x.dot(_y)).normalize(); _z.crossVectors(_x, _y);
    _m.makeBasis(_x, _y, _z); b.torso.quaternion.setFromRotationMatrix(_m); b.head.quaternion.copy(b.torso.quaternion);
    at(p, L_SHOULDER, _a).add(at(p, R_SHOULDER, _b)).add(at(p, L_HIP, _x)).add(at(p, R_HIP, _z)).multiplyScalar(0.25); put(b.torso, _a);
    put(b.head, at(p, HEAD, _a));
    this.limb(b.arms[0], L_SHOULDER, L_HAND, p, put); this.limb(b.arms[1], R_SHOULDER, R_HAND, p, put);
    this.limb(b.legs[0], L_HIP, L_FOOT, p, put); this.limb(b.legs[1], R_HIP, R_FOOT, p, put);
  }

  private limb(m: THREE.Mesh, from: number, to: number, p: number[], put: (m: THREE.Object3D, v: THREE.Vector3) => void) {
    at(p, from, _a); at(p, to, _b);
    _x.subVectors(_a, _b).normalize(); m.quaternion.setFromUnitVectors(UP, _x);
    put(m, _a.add(_b).multiplyScalar(0.5));
  }
}
