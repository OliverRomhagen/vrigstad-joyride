// The shooting range by Stockarydsvägen, drawn (#545, ?lab=rapier): the pavilion, the bank, the firing line and the
// targets, which follow their bodies in the physics world as they fall and stand up again. Reads the physics world,
// never writes it. The layout is in ../sim/shooting-range.ts.
import * as THREE from 'three';
import type { BoxPart } from '../box-part';
import type { PhysicsWorld, PropPose } from '../sim/physics-world';
import { BANK, PAVILION, RANGE_X, RANGE_Z, TARGET } from '../sim/shooting-range';

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
  world: Pick<PhysicsWorld, 'propPose' | 'isLoose'>;
  /** the targets' indices in the physics world's props, in the order of rangeTargets() */
  targets: readonly number[];
}

export class ShootingRangeMeshes {
  private readonly g: ShootingRangeMeshDeps;
  private readonly targetMeshes: THREE.Mesh[] = [];
  /** whether each target was lying or in the air last frame: one standing still needs no update */
  private readonly moving: boolean[] = [];

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
    // the bank, sunk half a metre so it meets the ground on a slope
    place([[BANK.widthM, BANK.heightM + 0.5, BANK.depthM, 0, BANK.heightM / 2 - 0.25, 0, EARTH]], BANK.x, BANK.z, true);
    // the firing line, in pieces that follow the ground: one strip across 22 m would sink into a slope at one end
    for (let x = RANGE_X - 10; x <= RANGE_X + 10; x += 2)
      place([[2, 0.04, 0.12, 0, 0.02, 0, WHITE]], x, RANGE_Z, false);
    const geo = boxGeo(target());
    for (const _ of g.targets) {
      const m = new THREE.Mesh(geo, paintMat);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      this.targetMeshes.push(m);
      this.moving.push(true); // placed on the first update
    }
  }

  /** Puts each target's model where its body is: standing, falling, lying or back on its stand. */
  update() {
    const { world, targets } = this.g;
    for (let k = 0; k < targets.length; k++) {
      const loose = world.isLoose(targets[k]);
      if (!loose && !this.moving[k]) continue;
      this.moving[k] = loose; // once back on its stand, one more update puts it there
      const p = world.propPose(targets[k], _pose),
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
    wall = 0.15;
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
    [w + 0.8, 0.2, d + 1.2, 0, h + 0.1, 0.3, ROOF],
    // the shooting bench along the open side, on two legs
    [w - 1, 0.08, 0.6, 0, 0.85, d / 2 - 0.4, BOARDS],
    [0.1, 0.8, 0.5, -w / 2 + 1, 0.4, d / 2 - 0.4, BOARDS],
    [0.1, 0.8, 0.5, w / 2 - 1, 0.4, d / 2 - 0.4, BOARDS],
    [0.9, 1.1, 0.04, 0, 1.6, -d / 2 + wall / 2 + 0.02, BANNER],
  ];
}
