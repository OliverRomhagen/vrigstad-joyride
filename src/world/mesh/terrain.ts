import '../three-legacy';
import * as THREE from 'three';
import type { Heightfield } from '../heightfield';

export interface TerrainMeshOptions {
  material: THREE.Material;
  skirtMaterial: THREE.Material;
  /** how far below height 0 the skirt round the edge reaches (m) */
  skirtDepthM: number;
}

type Field = Pick<
  Heightfield,
  'samples' | 'sampleCoord' | 'sampleHeight' | 'cellDetail' | 'fineHeight' | 'heightAt' | 'normalAt'
>;

/** refined cells are batched in square blocks of this many grid cells, one mesh each, so the camera culls them */
const BLOCK_CELLS = 8;

/**
 * The terrain on the elevation grid, and a skirt that closes its edge down to a solid base. Adds nothing to a scene.
 * Cells a cut refined (river channels, lake shores) are drawn on their finer grid, in `refined`, so the mesh is
 * exactly the surface `heightAt` describes. `dispose()` frees the geometry it made; the materials stay the caller's.
 */
export class TerrainMesh {
  /** the plain grid cells */
  readonly surface: THREE.Mesh;
  /** the refined cells, one mesh per block of BLOCK_CELLS² grid cells, each placed at its block's corner */
  readonly refined: THREE.Mesh[] = [];
  readonly skirt: THREE.Mesh;

  constructor(heightfield: Field, { material, skirtMaterial, skirtDepthM }: TerrainMeshOptions) {
    const n = heightfield.samples;
    const at = (i: number) => heightfield.sampleCoord(i);
    const half = at(n - 1);
    const size = 2 * half;

    // the plain grid's vertices, shared by every plain cell
    const pos: number[] = [];
    const index: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pos.push(at(i), heightfield.sampleHeight(i, j), at(j));
    const blocks = new Map<string, { pos: number[]; index: number[]; x0: number; z0: number }>();
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const m = heightfield.cellDetail(i, j);
        if (m < 2) {
          const k = j * n + i;
          index.push(k, k + n, k + 1, k + 1, k + n, k + n + 1);
          continue;
        }
        // a refined cell: its own (m + 1)² vertices, split along the same diagonal as the grid
        const bi = Math.floor(i / BLOCK_CELLS);
        const bj = Math.floor(j / BLOCK_CELLS);
        const key = bi + ',' + bj;
        let block = blocks.get(key);
        if (!block) {
          block = { pos: [], index: [], x0: at(bi * BLOCK_CELLS), z0: at(bj * BLOCK_CELLS) };
          blocks.set(key, block);
        }
        const first = block.pos.length / 3;
        const x0 = at(i);
        const z0 = at(j);
        const side = at(i + 1) - x0;
        for (let b = 0; b <= m; b++)
          for (let a = 0; a <= m; a++)
            block.pos.push(x0 + (side * a) / m - block.x0, heightfield.fineHeight(i, j, a, b), z0 + (side * b) / m - block.z0);
        for (let b = 0; b < m; b++)
          for (let a = 0; a < m; a++) {
            const k = first + b * (m + 1) + a;
            block.index.push(k, k + m + 1, k + 1, k + 1, k + m + 1, k + m + 2);
          }
      }
    }
    const nv = { x: 0, y: 1, z: 0 };
    const geometry = (p: number[], idx: number[], ox: number, oz: number) => {
      const count = p.length / 3;
      const uv = new Float32Array(count * 2);
      const normal = new Float32Array(count * 3);
      for (let v = 0; v < count; v++) {
        const x = p[v * 3] + ox;
        const z = p[v * 3 + 2] + oz;
        uv[v * 2] = (x + half) / size;
        uv[v * 2 + 1] = 1 - (z + half) / size;
        // from the height lookup rather than per mesh face, so a refined cell's edge shades like its neighbour's
        heightfield.normalAt(x, z, nv);
        normal[v * 3] = nv.x;
        normal[v * 3 + 1] = nv.y;
        normal[v * 3 + 2] = nv.z;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      return g;
    };
    this.surface = new THREE.Mesh(geometry(pos, index, 0, 0), material);
    this.surface.receiveShadow = true;
    for (const b of blocks.values()) {
      const mesh = new THREE.Mesh(geometry(b.pos, b.index, b.x0, b.z0), material);
      mesh.position.set(b.x0, 0, b.z0);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.refined.push(mesh);
    }

    // one wall per grid step along each edge, from the terrain down to the base, split where a cell is refined
    const bottom = -skirtDepthM;
    const v: number[] = [];
    const last = n - 1;
    // the point t of the way along an edge's grid step i: [x, y, z]; along each edge in turn, by (i, t)
    const edge = (
      point: (i: number, s: number, m: number) => [number, number, number],
      cell: (i: number) => [number, number],
    ) => {
      for (let i = 0; i < last; i++) {
        const m = Math.max(1, heightfield.cellDetail(...cell(i)));
        for (let s = 0; s < m; s++) {
          const a = point(i, s, m);
          const b = point(i, s + 1, m);
          v.push(
            a[0],
            a[1],
            a[2],
            b[0],
            b[1],
            b[2],
            b[0],
            bottom,
            b[2],
            a[0],
            a[1],
            a[2],
            b[0],
            bottom,
            b[2],
            a[0],
            bottom,
            a[2],
          );
        }
      }
    };
    // a point on the edge of cell (ci, cj) at sub-sample (a, b) of m, from the plain grid at its corners
    const edgePoint = (ci: number, cj: number, a: number, b: number, m: number): [number, number, number] => {
      const x = a === 0 ? at(ci) : a === m ? at(ci + 1) : at(ci) + ((at(ci + 1) - at(ci)) * a) / m;
      const z = b === 0 ? at(cj) : b === m ? at(cj + 1) : at(cj) + ((at(cj + 1) - at(cj)) * b) / m;
      const corner = (a === 0 || a === m) && (b === 0 || b === m);
      const y =
        corner || m < 2
          ? heightfield.sampleHeight(ci + (a ? 1 : 0), cj + (b ? 1 : 0))
          : heightfield.fineHeight(ci, cj, a, b);
      return [x, y, z];
    };
    edge(
      (i, s, m) => edgePoint(i, last - 1, s, m, m),
      i => [i, last - 1],
    );
    edge(
      (i, s, m) => edgePoint(i, 0, s, 0, m),
      i => [i, 0],
    );
    edge(
      (i, s, m) => edgePoint(last - 1, i, m, s, m),
      i => [last - 1, i],
    );
    edge(
      (i, s, m) => edgePoint(0, i, 0, s, m),
      i => [0, i],
    );
    const skirt = new THREE.BufferGeometry();
    skirt.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    skirt.computeVertexNormals();
    this.skirt = new THREE.Mesh(skirt, skirtMaterial);
  }

  /** triangles in the surface, refined cells included */
  get triangles() {
    let n = 0;
    for (const m of [this.surface, ...this.refined]) n += (m.geometry.getIndex() as THREE.BufferAttribute).count / 3;
    return n;
  }

  dispose() {
    for (const m of [this.surface, ...this.refined, this.skirt]) m.geometry.dispose();
  }
}
