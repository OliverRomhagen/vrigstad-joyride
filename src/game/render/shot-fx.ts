// Draws the shots (#17, lab: pickadoll): the shots in the air, the splats they leave on the ground, on walls, on cars
// and on people, and the mark where the next shot would land. The rules are in ../sim/shots.ts.
import * as THREE from 'three';
import type { Shot, ShotHit } from '../sim/shots';

const SHOTS_MAX = 128; // shots drawn at once
const SPLATS_MAX = 600,
  SPLATS_MAX_COARSE = 220; // splats on the ground and the walls; the oldest is painted over first. On a touch screen
const STUCK_MAX = 80,
  STUCK_MAX_COARSE = 36; // splats on cars and people, each its own mesh
const LIFT_M = 0.03; // a splat sits this far off its surface, so the two don't flicker
const SHOT_R_M = 0.07;
const AIM_MARK_PER_M = 0.09; // the aim mark grows this much per metre from the camera, so it stays as big on screen
const SLOPE_STEP_M = 0.5; // the ground's slope under a splat is read over this distance
const TEX_PX = 128;
// where a splat lands on a person: on the front, the back or a side of the body's box (m, as personParts builds it)
const BODY_HALF_DEPTH_M = 0.15,
  BODY_HALF_WIDTH_M = 0.26,
  BODY_LOW_M = 0.9,
  BODY_HIGH_M = 1.4,
  BODY_SPLAT_MAX_M = 0.2;

/** The gegga's colours. */
export const GEGGA = ['#ff3b6b', '#ffd400', '#22d3a0', '#2e9bff', '#b45cff', '#ff7a1a'] as const;

export interface ShotFxDeps {
  scene: THREE.Scene;
  camera: THREE.Object3D; // the aim mark keeps its size on screen
  coarse: boolean;
  groundAt(x: number, z: number): number;
  rnd(): number; // its own stream: the shape of the splat
}

const _m = new THREE.Matrix4(),
  _q = new THREE.Quaternion(),
  _spin = new THREE.Quaternion(),
  _p = new THREE.Vector3(),
  _n = new THREE.Vector3(),
  _s = new THREE.Vector3(),
  _c = new THREE.Color(),
  Z = new THREE.Vector3(0, 0, 1);

/** Shots, splats and the aim mark. */
export class ShotFx {
  private readonly g: ShotFxDeps;
  private readonly shots: THREE.InstancedMesh;
  private readonly splats: THREE.InstancedMesh;
  private readonly aimMark: THREE.Mesh;
  private readonly quad = new THREE.PlaneGeometry(1, 1);
  private readonly texture: THREE.CanvasTexture;
  private readonly stuckMats = new Map<string, THREE.Material>();
  private readonly stuck: THREE.Mesh[] = [];
  private readonly stuckMax: number;
  private next = 0; // the splat painted over next
  /** splats left so far, the painted-over ones included */
  splatted = 0;

  constructor(g: ShotFxDeps) {
    this.g = g;
    this.texture = splatTexture(g.rnd);
    const max = g.coarse ? SPLATS_MAX_COARSE : SPLATS_MAX;
    this.stuckMax = g.coarse ? STUCK_MAX_COARSE : STUCK_MAX;
    this.shots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(SHOT_R_M, 8, 6),
      new THREE.MeshBasicMaterial(),
      SHOTS_MAX,
    );
    this.splats = new THREE.InstancedMesh(this.quad, this.splatMaterial(), max);
    for (const mesh of [this.shots, this.splats]) {
      mesh.setColorAt(0, _c.set('#ffffff')); // makes the colour buffer before the first frame compiles the material
      mesh.count = 0;
      mesh.frustumCulled = false; // the instances are all over the village
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      g.scene.add(mesh);
    }
    // a white ring over a dark one, so it shows against a pale wall and a dark road alike; drawn over everything
    const ring = (inner: number, outer: number, color: string, opacity: number, order: number) => {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, 24),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false }),
      );
      mesh.renderOrder = order;
      return mesh;
    };
    this.aimMark = ring(0.12, 0.18, '#ffffff', 0.9, 11);
    this.aimMark.add(ring(0.09, 0.21, '#10140f', 0.45, 10));
    this.aimMark.visible = false;
    g.scene.add(this.aimMark);
  }

  // cut out, not blended: crisp edges, and no sorting against the glass and the water
  private splatMaterial(colour?: string) {
    return new THREE.MeshLambertMaterial({
      map: this.texture,
      color: colour ?? '#ffffff',
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  /** Draws the shots in the air; `colour` gives each its colour. */
  drawShots<S extends Shot>(shots: readonly S[], colour: (s: S) => string) {
    const n = Math.min(shots.length, SHOTS_MAX);
    for (let i = 0; i < n; i++) {
      const s = shots[i];
      this.shots.setMatrixAt(i, _m.makeTranslation(s.x, s.y, s.z));
      this.shots.setColorAt(i, _c.set(colour(s)));
    }
    this.shots.count = n;
    this.shots.instanceMatrix.needsUpdate = true;
    if (this.shots.instanceColor) this.shots.instanceColor.needsUpdate = true;
  }

  /** Leaves a splat of radius `r` (m) where a shot hit the ground or a wall; `turn` (0..1) turns it, so no two look the same. */
  splat(hit: Pick<ShotHit, 'kind' | 'x' | 'y' | 'z' | 'nx' | 'ny' | 'nz'>, r: number, colour: string, turn: number) {
    _n.set(hit.nx, hit.ny, hit.nz);
    if (hit.kind === 'ground') {
      const { groundAt } = this.g,
        d = SLOPE_STEP_M;
      _n.set(
        groundAt(hit.x - d, hit.z) - groundAt(hit.x + d, hit.z),
        2 * d,
        groundAt(hit.x, hit.z - d) - groundAt(hit.x, hit.z + d),
      ).normalize();
    }
    this.place(hit, r, turn);
    const i = this.next;
    this.next = (this.next + 1) % this.splats.instanceMatrix.count;
    this.splats.setMatrixAt(i, _m);
    this.splats.setColorAt(i, _c.set(colour));
    this.splats.count = Math.min(this.splats.count + 1, this.splats.instanceMatrix.count);
    this.splats.instanceMatrix.needsUpdate = true;
    if (this.splats.instanceColor) this.splats.instanceColor.needsUpdate = true;
    this.splatted++;
  }

  // _m: a quad of radius r at the hit, facing along _n and turned about it
  private place(at: { x: number; y: number; z: number }, r: number, turn: number) {
    _q.setFromUnitVectors(Z, _n).multiply(_spin.setFromAxisAngle(Z, turn * Math.PI * 2));
    _p.set(at.x, at.y, at.z).addScaledVector(_n, LIFT_M);
    _m.compose(_p, _q, _s.set(r * 2, r * 2, 1));
  }

  /** Leaves a splat on something that moves, a car's mesh: it goes where the car goes. */
  splatOn(
    target: THREE.Object3D,
    hit: Pick<ShotHit, 'x' | 'y' | 'z' | 'nx' | 'ny' | 'nz'>,
    r: number,
    colour: string,
    turn: number,
  ) {
    _n.set(hit.nx, hit.ny, hit.nz);
    this.place(hit, r, turn);
    const mesh = this.stick(colour);
    _m.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.updateMatrixWorld();
    target.updateWorldMatrix(true, false);
    target.attach(mesh); // keeps it where it is in the world, as the target's child
  }

  /** Leaves a splat on a person's body, on the side the shot came from: (dx, dz) is the way the shot flew, `y` its height. */
  splatOnPerson(person: THREE.Object3D, dx: number, dz: number, y: number, r: number, colour: string, turn: number) {
    person.updateWorldMatrix(true, false);
    // the way back to the shooter, in the person's own axes
    _n.set(-dx, 0, -dz).transformDirection(_m.copy(person.matrixWorld).invert());
    const up = THREE.MathUtils.clamp(
      _p.set(person.position.x, y, person.position.z).applyMatrix4(_m).y,
      BODY_LOW_M,
      BODY_HIGH_M,
    );
    const mesh = this.stick(colour);
    if (Math.abs(_n.z) >= Math.abs(_n.x)) {
      mesh.position.set(0, up, Math.sign(_n.z) * BODY_HALF_DEPTH_M);
      _n.set(0, 0, Math.sign(_n.z) || 1);
    } else {
      mesh.position.set(Math.sign(_n.x) * BODY_HALF_WIDTH_M, up, 0);
      _n.set(Math.sign(_n.x), 0, 0);
    }
    mesh.quaternion.setFromUnitVectors(Z, _n).multiply(_spin.setFromAxisAngle(Z, turn * Math.PI * 2));
    mesh.scale.setScalar(Math.min(r, BODY_SPLAT_MAX_M) * 2);
    person.add(mesh);
  }

  // a splat mesh of its own, taking the oldest one's place when there are too many
  private stick(colour: string) {
    let material = this.stuckMats.get(colour);
    if (!material) {
      material = this.splatMaterial(colour);
      this.stuckMats.set(colour, material);
    }
    if (this.stuck.length >= this.stuckMax) this.stuck.shift()!.removeFromParent();
    const mesh = new THREE.Mesh(this.quad, material);
    this.stuck.push(mesh);
    this.splatted++;
    return mesh;
  }

  /** Shows where the next shot would land, or hides the mark with null. */
  aim(hit: Pick<ShotHit, 'x' | 'y' | 'z' | 'nx' | 'ny' | 'nz'> | null) {
    this.aimMark.visible = !!hit;
    if (!hit) return;
    this.aimMark.quaternion.copy(this.g.camera.quaternion); // faces you, wherever it lands
    this.aimMark.position.set(hit.x, hit.y, hit.z);
    this.aimMark.scale.setScalar(
      Math.max(1, this.aimMark.position.distanceTo(this.g.camera.position) * AIM_MARK_PER_M),
    );
  }
}

// one splat shape, white on clear: a blob with lobes around it and a few drops flung further out
function splatTexture(rnd: () => number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEX_PX;
  const ctx = canvas.getContext('2d')!,
    mid = TEX_PX / 2;
  ctx.fillStyle = '#fff';
  const dot = (x: number, y: number, r: number) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  dot(mid, mid, TEX_PX * 0.24);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rnd() * 0.4,
      reach = TEX_PX * (0.2 + rnd() * 0.13);
    dot(mid + Math.cos(a) * reach, mid + Math.sin(a) * reach, TEX_PX * (0.05 + rnd() * 0.07));
  }
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2,
      reach = TEX_PX * (0.36 + rnd() * 0.1);
    dot(mid + Math.cos(a) * reach, mid + Math.sin(a) * reach, TEX_PX * (0.012 + rnd() * 0.025));
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
