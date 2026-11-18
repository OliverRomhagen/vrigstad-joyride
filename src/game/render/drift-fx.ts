// Drift effects: sparks at the rear wheels (white, then blue and orange as the turbo charges), a flame while boosting, skid marks.
// Moved from src/game/main.ts (#177); main.ts passes in what the effects read from the rest of the game.
import * as THREE from 'three';
import '../../world/three-legacy';   // before SPARK_COLS: with colour management on, col() would convert twice
import { makeRnd } from '../../world/random';

const SKID_N = 600, SKID_STEP_M = 0.6;   // skid marks kept (the oldest goes first); length of one mark (m)
const col = (c: number) => new THREE.Color(c).convertSRGBToLinear();
const SPARK_COLS = [col(0xfff2c0), col(0x4aa8ff), col(0xff8a1f)];
const _sp = new THREE.Vector3(), _sq = new THREE.Quaternion(), _ss = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _m = new THREE.Matrix4();

/** A car as the drift effects see it. */
export interface DriftCar { x: number; z: number; h: number; type: string; wet?: boolean; drift: number; slip: number; charge: number; boost: number }

/** What the drift effects read from the rest of the game. */
export interface DriftFxDeps {
  scene: THREE.Scene;
  groundAt(x: number, z: number): number;
  profiles: Record<string, { wz: readonly number[] }>;   // by car type; wz[1] is the rear axle (m behind the middle)
  turboAt: readonly number[];                            // s of sliding for a blue / an orange spark
}

/** The sparks, boost flame and skid marks of the car the player drives. */
export class DriftFx {
  private readonly g: DriftFxDeps;
  private readonly rnd = makeRnd(4242);   // own stream: the flicker rolls every frame
  private readonly sparkMat = new THREE.MeshBasicMaterial({ color: SPARK_COLS[0].clone() });
  private readonly sparks: THREE.Mesh[];
  private readonly flame: THREE.Mesh;
  private readonly skids: THREE.InstancedMesh;
  private readonly skidLast: ({ x: number; z: number } | null)[] = [null, null];
  private skidI = 0;

  constructor(g: DriftFxDeps) {
    this.g = g;
    const { scene } = g, sparkGeo = new THREE.OctahedronGeometry(0.22);
    this.sparks = [0, 1].map(() => { const m = new THREE.Mesh(sparkGeo, this.sparkMat); m.visible = false; scene.add(m); return m; });
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5), new THREE.MeshBasicMaterial({ color: col(0xffb347) }));
    this.flame.visible = false; scene.add(this.flame);
    this.skids = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.24, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), SKID_N);
    this.skids.count = 0; this.skids.frustumCulled = false; scene.add(this.skids);
  }

  private laySkid(w: number, x: number, z: number) {
    const { skids, skidLast } = this, l = skidLast[w]; if (!l) { skidLast[w] = { x, z }; return; }
    const dx = x - l.x, dz = z - l.z, L = Math.hypot(dx, dz); if (L < SKID_STEP_M) return;
    _sp.set(l.x, this.g.groundAt(l.x, l.z) + 0.02, l.z); _sq.setFromAxisAngle(_up, Math.atan2(dx, dz)); _ss.set(1, 1, L);
    skids.setMatrixAt(this.skidI, _m.compose(_sp, _sq, _ss)); this.skidI = (this.skidI + 1) % SKID_N; skids.count = Math.min(SKID_N, skids.count + 1);   // a ring: the oldest mark goes first
    skids.instanceMatrix.needsUpdate = true; l.x = x; l.z = z;
  }

  /** c is the car the player drives, or null on foot. */
  update(c: DriftCar | null) {
    const { groundAt, profiles, turboAt } = this.g, { sparks, flame, rnd } = this;
    const on = !!c && !c.wet && (c.drift !== 0 || Math.abs(c.slip) > 0.3), back = c ? (c.type === 'traktor' ? 1.5 : profiles[c.type].wz[1]) : 0;
    const fx = c ? Math.sin(c.h) : 0, fz = c ? -Math.cos(c.h) : 0;
    for (let w = 0; w < 2; w++) {
      if (!on || !c) { sparks[w].visible = false; this.skidLast[w] = null; continue; }
      const side = w ? 0.8 : -0.8, x = c.x - fx * back - fz * side, z = c.z - fz * back + fx * side;
      this.laySkid(w, x, z);
      const sx = x - fx * 0.45, sz = z - fz * 0.45;                 // just behind the tyre, which would hide it
      const tier = c.charge > turboAt[1] ? 2 : c.charge > turboAt[0] ? 1 : 0, sp = sparks[w];
      sp.visible = c.drift !== 0; sp.position.set(sx, groundAt(sx, sz) + 0.18, sz); sp.scale.setScalar((0.6 + tier * 0.35) * (0.6 + rnd() * 0.8));
      sp.rotation.set(rnd() * 3, rnd() * 3, 0); if (!w) this.sparkMat.color.copy(SPARK_COLS[tier]);
    }
    flame.visible = !!c && c.boost > 0;
    if (c && flame.visible) { const x = c.x - fx * (back + 0.95), z = c.z - fz * (back + 0.95);
      flame.position.set(x, groundAt(x, z) + 0.45, z); flame.rotation.set(0, -c.h, 0); flame.scale.set(1, 1, 0.7 + rnd() * 0.8); }   // the cone's tip is local +Z, which -h turns to the car's rear
  }
}
