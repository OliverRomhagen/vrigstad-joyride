// The shooting range by Stockarydsvägen, drawn (#545, ?lab=rapier): the pavilion, the bank, the firing line and the
// targets, which follow their bodies in the physics world as they fall and stand up again. Reads the physics world,
// never writes it. The layout is in ../sim/shooting-range.ts.
import * as THREE from 'three';
import type { BoxPart } from '../box-part';
import type { PhysicsWorld, PropPose } from '../sim/physics-world';
import { BANK, LANE_M, PAVILION, RANGE_X, RANGE_Z, roofBox, TARGET, TARGET_DISTANCES_M } from '../sim/shooting-range';

const FALU = '#8b2a1e', // the red of a Swedish timbered house
  TRIM = '#ece5d3',
  ROOF = '#2e2b29',
  BOARDS = '#a07a4e', // the floor and the shooting bench, untreated pine
  BANNER = '#1f3a6b', // the club's banner from 1904, kept in Gröndal now: its blue, on the back wall
  EARTH = '#74804a', // grassed over
  WHITE = '#f4f1e8',
  BLACK = '#1d1d1d',
  RED = '#c4372b';

const _pose: PropPose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

export interface ShootingRangeMeshDeps {
  scene: THREE.Scene;
  groundAt(x: number, z: number): number;
  boxGeo(parts: BoxPart[]): THREE.BufferGeometry;
  paintMat: THREE.Material;
  world: Pick<PhysicsWorld, 'drawnPose' | 'isLoose' | 'isAwake'>;
  /** the targets' indices in the physics world's props, in the order of rangeTargets() */
  targets: readonly number[];
}

export class ShootingRangeMeshes {
  private readonly g: ShootingRangeMeshDeps;
  private readonly targetMeshes: THREE.Mesh[] = [];
  /** whether each target was loose when it was last drawn, null before the first time */
  private readonly targetLooseWhenDrawn: (boolean | null)[] = [];
  private readonly targetAwakeWhenDrawn: boolean[] = [];

  constructor(g: ShootingRangeMeshDeps) {
    this.g = g;
    const { scene, groundAt, boxGeo, paintMat } = g;
    const place = (parts: BoxPart[], x: number, z: number, shadow: boolean) => {
      const m = new THREE.Mesh(boxGeo(parts), paintMat);
      m.position.set(x, groundAt(x, z), z);
      m.castShadow = shadow;
      m.receiveShadow = true;
      scene.add(m);
    };
    place(pavilion(), PAVILION.x, PAVILION.z, true);
    const b = BANK;
    place([[b.widthM, b.heightM + b.sinkM, b.depthM, 0, (b.heightM - b.sinkM) / 2, 0, EARTH]], b.x, b.z, true);
    // the firing line, as one mesh in 2 m pieces that follow the ground: one strip across the lanes would sink into a
    // slope at one end
    const lineY = groundAt(RANGE_X, RANGE_Z),
      lineHalf = ((TARGET_DISTANCES_M.length - 1) / 2) * LANE_M + 1,
      line: BoxPart[] = [];
    for (let dx = -lineHalf + 1; dx < lineHalf; dx += 2)
      line.push([2, 0.04, 0.12, dx, groundAt(RANGE_X + dx, RANGE_Z) - lineY + 0.02, 0, WHITE]);
    place(line, RANGE_X, RANGE_Z, false);
    const geo = boxGeo(target());
    for (const _ of g.targets) {
      const m = new THREE.Mesh(geo, paintMat);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      this.targetMeshes.push(m);
      this.targetLooseWhenDrawn.push(null);
      this.targetAwakeWhenDrawn.push(false);
    }
  }

  /**
   * Puts each target's model where its body is, while it falls or settles, and once when it's knocked or back on its
   * stand. One that stands, or lies still, keeps its place.
   */
  update() {
    const { world, targets } = this.g;
    for (let k = 0; k < targets.length; k++) {
      const loose = world.isLoose(targets[k]);
      const awake = world.isAwake(targets[k]);
      // drawn while it moves, once when it's knocked or back on its stand, and once more as it falls asleep: the last
      // frame drew it blended, a little short of where it rests
      if (loose === this.targetLooseWhenDrawn[k] && !awake && !this.targetAwakeWhenDrawn[k]) continue;
      this.targetLooseWhenDrawn[k] = loose;
      this.targetAwakeWhenDrawn[k] = awake;
      const p = world.drawnPose(targets[k], _pose),
        m = this.targetMeshes[k];
      m.position.set(p.x, p.y, p.z);
      m.quaternion.set(p.qx, p.qy, p.qz, p.qw);
    }
  }
}

/** A target about its middle, as its body is: a post with a board at the top, square rings on both faces. */
function target(): BoxPart[] {
  const t = TARGET,
    half = t.heightM / 2,
    postH = t.heightM - t.boardM,
    boardY = half - t.boardM / 2,
    face = t.boardThickM / 2;
  const parts: BoxPart[] = [
    [t.postM, postH, t.postM, 0, -half + postH / 2, 0, BOARDS],
    [t.boardM, t.boardM, t.boardThickM, 0, boardY, 0, WHITE],
  ];
  // the rings, each a square laid a few mm proud of the one under it, on both faces
  const rings: [number, string][] = [
    [0.52, BLACK],
    [0.36, WHITE],
    [0.22, BLACK],
    [0.09, RED],
  ];
  rings.forEach(([size, colour], n) => {
    const z = face + 0.002 * (n + 1);
    parts.push([size, size, 0.002, 0, boardY, z, colour], [size, size, 0.002, 0, boardY, -z, colour]);
  });
  return parts;
}

/** The pavilion about its middle at ground level: a floor, three walls and a roof, open to the south, with a bench. */
function pavilion(): BoxPart[] {
  const p = PAVILION,
    w = p.widthM,
    d = p.depthM,
    h = p.heightM,
    wall = p.wallM,
    roof = roofBox();
  return [
    [w, 0.15, d, 0, 0.075, 0, BOARDS],
    [w, h, wall, 0, h / 2, -d / 2, FALU],
    [wall, h, d, -w / 2, h / 2, 0, FALU],
    [wall, h, d, w / 2, h / 2, 0, FALU],
    // white corner boards, as on any falu-red house
    [0.2, h, 0.2, -w / 2, h / 2, d / 2, TRIM],
    [0.2, h, 0.2, w / 2, h / 2, d / 2, TRIM],
    [0.2, h, 0.2, -w / 2, h / 2, -d / 2, TRIM],
    [0.2, h, 0.2, w / 2, h / 2, -d / 2, TRIM],
    [roof.widthM, roof.thickM, roof.depthM, 0, roof.y, roof.z, ROOF],
    // the shooting bench along the open side, on two legs
    [w - 1, 0.08, 0.6, 0, 0.85, d / 2 - 0.4, BOARDS],
    [0.1, 0.8, 0.5, -w / 2 + 1, 0.4, d / 2 - 0.4, BOARDS],
    [0.1, 0.8, 0.5, w / 2 - 1, 0.4, d / 2 - 0.4, BOARDS],
    [0.9, 1.1, 0.04, 0, 1.6, -d / 2 + wall / 2 + 0.02, BANNER],
  ];
}
