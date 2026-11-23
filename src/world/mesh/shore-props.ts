import '../three-legacy';
import * as THREE from 'three';
import { hash01 } from '../random';
import type { ShoreLayout } from '../shore';

export interface ShorePropsOptions {
  /** the page's ground height, so each prop stands on the cut bank or the bed under the water */
  heightAt: (x: number, z: number) => number;
  /** reed and stone colours, linear; each prop picks one by a hash of its position */
  reedColours: readonly THREE.Color[];
  stoneColours: readonly THREE.Color[];
}

/** props are batched into square cells this big, so the camera culls whole cells (m), as the trees are */
const CELL_M = 400;
/** blades in a reed clump, and their height (m); a few carry a seed head */
const BLADES = 7;
const REED_H_M = 1.6;

/** A clump of tapering blades, leaning out from its foot: one triangle each, plus two seed heads. */
function reedClump() {
  const pos: number[] = [];
  for (let b = 0; b < BLADES; b++) {
    const a = (b / BLADES) * Math.PI * 2 + hash01('reed', b) * 0.6;
    const r = 0.12 + hash01('reed-r', b) * 0.16;
    const h = REED_H_M * (0.65 + hash01('reed-h', b) * 0.45);
    const lean = 0.25 + hash01('reed-l', b) * 0.35;
    const [cx, cz] = [Math.cos(a), Math.sin(a)];
    const w = 0.05;
    pos.push(
      cx * r - cz * w,
      0,
      cz * r + cx * w,
      cx * r + cz * w,
      0,
      cz * r - cx * w,
      cx * (r + lean),
      h,
      cz * (r + lean),
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const heads = [0, 3].map(b => {
    const a = (b / BLADES) * Math.PI * 2 + hash01('reed', b) * 0.6;
    const lean = 0.25 + hash01('reed-l', b) * 0.35;
    const r = 0.12 + hash01('reed-r', b) * 0.16 + lean * 0.85;
    const y = REED_H_M * (0.65 + hash01('reed-h', b) * 0.45) * 0.82;
    return new THREE.CylinderGeometry(0.045, 0.045, 0.28, 4, 1, true)
      .translate(Math.cos(a) * r, y, Math.sin(a) * r)
      .toNonIndexed();
  });
  const merged = mergePositions([geo, ...heads]);
  for (const g of [geo, ...heads]) g.dispose();
  return merged;
}

function mergePositions(geos: THREE.BufferGeometry[]) {
  const all: number[] = [];
  for (const g of geos) all.push(...(g.getAttribute('position').array as Float32Array));
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(all, 3));
  out.computeVertexNormals();
  return out;
}

/**
 * The shore's reeds and stones, instanced per 400 m cell. Adds nothing to a scene. `dispose()` frees the geometry and
 * the two materials it made.
 */
export class ShoreProps {
  readonly meshes: THREE.InstancedMesh[] = [];
  readonly triangles: number;
  private readonly geometries: THREE.BufferGeometry[];
  private readonly materials: THREE.Material[];

  constructor(
    layout: Pick<ShoreLayout, 'reeds' | 'stones'>,
    { heightAt, reedColours, stoneColours }: ShorePropsOptions,
  ) {
    const reed = reedClump();
    const stone = new THREE.IcosahedronGeometry(0.5, 0).scale(1, 0.55, 0.8);
    const reedMat = new THREE.MeshLambertMaterial({ name: 'shore-reed', side: THREE.DoubleSide });
    const stoneMat = new THREE.MeshLambertMaterial({ name: 'shore-stone', flatShading: true });
    this.geometries = [reed, stone];
    this.materials = [reedMat, stoneMat];
    let triangles = 0;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const place = (
      props: number[],
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      colours: readonly THREE.Color[],
      sink: number,
      name: string,
    ) => {
      const cells = new Map<string, number[]>();
      for (let i = 0; i < props.length; i += 4) {
        const k = Math.floor(props[i] / CELL_M) + ',' + Math.floor(props[i + 1] / CELL_M);
        const list = cells.get(k);
        if (list) list.push(i);
        else cells.set(k, [i]);
      }
      const perProp = geo.getAttribute('position').count / 3;
      for (const list of cells.values()) {
        const mesh = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach((i, j) => {
          const [x, z, sc, turn] = [props[i], props[i + 1], props[i + 2], props[i + 3]];
          q.setFromAxisAngle(up, turn);
          m4.compose(v.set(x, heightAt(x, z) - sink * sc, z), q, s.set(sc, sc * (0.8 + hash01(name, i) * 0.4), sc));
          mesh.setMatrixAt(j, m4);
          mesh.setColorAt(j, colours[Math.floor(hash01(name, i, 'c') * colours.length)]);
        });
        mesh.name = name;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        this.meshes.push(mesh);
        triangles += perProp * list.length;
      }
    };
    place(layout.reeds, reed, reedMat, reedColours, 0.05, 'shore-reeds');
    place(layout.stones, stone, stoneMat, stoneColours, 0.12, 'shore-stones');
    this.triangles = triangles;
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const m of this.meshes) m.dispose();
  }
}
