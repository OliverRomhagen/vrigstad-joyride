import '../three-legacy';
import * as THREE from 'three';
import { mitreAt } from '../polyline';
import type { Point } from '../roads';
import type { WaterBodies } from '../water-shapes';

export interface WaterSurfaceOptions {
  lakeMaterial: THREE.Material;
  riverMaterial: THREE.Material;
  /** the page's heightfield exaggeration: the levels are unexaggerated */
  exaggeration?: number;
}

/** how far a river's surface reaches past its waterline into the bank, where the ground hides it (m) */
const RIVER_TUCK_M = 0.9;
/** a lake's surface is cut into squares from this size, halving to the smallest near the shore (m) */
const LAKE_CELL_M = 32;
const LAKE_CELL_MIN_M = 4;
/** squares this near the waterline are halved, so the shore bands follow it (m) */
const LAKE_FINE_M = 7;
/** a river's surface is split into pieces about this long, so the camera culls what it can't see (m) */
const RIVER_PIECE_M = 300;
/** shore distance given to the open water, past where the bands change (m) */
const OPEN_WATER_M = 30;

/**
 * The water's surfaces: a level plane per lake, cut to its outline with the islands left out, and a ribbon along each
 * river and stream at its level. Both carry `shore`, the distance from the waterline (m), and `flowUv`, which the
 * material drifts its ripples along: distance along and across the flow on rivers, x and z on lakes. Adds nothing to a
 * scene; each mesh sits at its own centre. `dispose()` frees the geometry; the materials stay the caller's.
 */
export class WaterSurface {
  readonly meshes: THREE.Mesh[] = [];
  readonly triangles: number;

  constructor(
    bodies: Pick<WaterBodies, 'lakes' | 'courses' | 'lakeAt' | 'lakeShoreDistance'>,
    { lakeMaterial, riverMaterial, exaggeration = 1 }: WaterSurfaceOptions,
  ) {
    let triangles = 0;
    const add = (geo: Geo, material: THREE.Material, name: string) => {
      if (!geo.index.length) return;
      const mesh = toMesh(geo, material);
      mesh.name = name;
      this.meshes.push(mesh);
      triangles += geo.index.length / 3;
    };

    bodies.lakes.forEach((lake, li) => {
      const y = lake.level * exaggeration;
      const geo = newGeo();
      const shore = (x: number, z: number) => {
        const d = bodies.lakeShoreDistance(x, z);
        return d === Infinity ? (bodies.lakeAt(x, z) === li ? OPEN_WATER_M : -OPEN_WATER_M) : d;
      };
      const square = (x: number, z: number, size: number) => {
        const cx = x + size / 2;
        const cz = z + size / 2;
        const d = shore(cx, cz);
        const reach = size * 0.71;
        if (d < -reach) return; // all of it past the waterline: on land
        if (size > LAKE_CELL_MIN_M && Math.abs(d) < reach + LAKE_FINE_M) {
          const h = size / 2;
          for (const [ox, oz] of [
            [0, 0],
            [h, 0],
            [0, h],
            [h, h],
          ])
            square(x + ox, z + oz, h);
          return;
        }
        // the smallest squares may reach a few metres past the waterline: the raised shore covers that
        if (d < 0 && size > LAKE_CELL_MIN_M) return;
        const k = geo.pos.length / 3;
        for (const [px, pz] of [
          [x, z],
          [x + size, z],
          [x, z + size],
          [x + size, z + size],
        ]) {
          geo.pos.push(px, y, pz);
          geo.shore.push(Math.min(shore(px, pz), OPEN_WATER_M));
          geo.uv.push(px, pz);
        }
        geo.index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      };
      for (let x = lake.x0 - LAKE_CELL_MIN_M; x < lake.x1 + LAKE_CELL_MIN_M; x += LAKE_CELL_M)
        for (let z = lake.z0 - LAKE_CELL_MIN_M; z < lake.z1 + LAKE_CELL_MIN_M; z += LAKE_CELL_M)
          square(x, z, LAKE_CELL_M);
      add(geo, lakeMaterial, lake.key);
    });

    for (const c of bodies.courses) {
      const n = c.x.length;
      // the runs outside lakes, each one sample into the lake it meets, so the ribbon tucks under the lake's surface
      let k = 0;
      while (k < n) {
        while (k < n && c.lake[k] >= 0) k++;
        if (k >= n) break;
        let end = k;
        while (end < n - 1 && c.lake[end + 1] < 0) end++;
        const from = Math.max(0, k - 1);
        const to = Math.min(n - 1, end + 1);
        const q: Point[] = [];
        for (let i = from; i <= to; i++) q.push([c.x[i], c.z[i]]);
        for (let p0 = 0; p0 < q.length - 1; ) {
          let p1 = p0;
          while (p1 < q.length - 1 && c.s[from + p1] - c.s[from + p0] < RIVER_PIECE_M) p1++;
          const geo = newGeo();
          for (let i = p0; i <= p1; i++) {
            const j = from + i;
            const { nx, nz, scale } = mitreAt(q, i);
            const m = Number.isNaN(scale) ? 1 : scale;
            const half = c.half[j];
            const row = geo.pos.length / 3;
            for (const off of [-half - RIVER_TUCK_M, -half, 0, half, half + RIVER_TUCK_M]) {
              geo.pos.push(q[i][0] + nx * off * m, c.level[j] * exaggeration, q[i][1] + nz * off * m);
              geo.shore.push(half - Math.abs(off));
              geo.uv.push(c.s[j], off);
            }
            if (i > p0)
              for (let a = 0; a < 4; a++) {
                const v = row - 5 + a;
                geo.index.push(v, v + 1, v + 5, v + 1, v + 6, v + 5);
              }
          }
          add(geo, riverMaterial, `${c.key}:${Math.round(c.s[from + p0])}`);
          p0 = p1;
        }
        k = end + 1;
      }
    }
    this.triangles = triangles;
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
  }
}

interface Geo {
  pos: number[];
  shore: number[];
  uv: number[];
  index: number[];
}

const newGeo = (): Geo => ({ pos: [], shore: [], uv: [], index: [] });

/** The geometry centred on its own middle, as a mesh placed there: local coordinates for culling and float precision. */
function toMesh(geo: Geo, material: THREE.Material) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < geo.pos.length; i += 3) {
    x0 = Math.min(x0, geo.pos[i]);
    x1 = Math.max(x1, geo.pos[i]);
    z0 = Math.min(z0, geo.pos[i + 2]);
    z1 = Math.max(z1, geo.pos[i + 2]);
  }
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const pos = new Float32Array(geo.pos.length);
  for (let i = 0; i < geo.pos.length; i += 3) {
    pos[i] = geo.pos[i] - cx;
    pos[i + 1] = geo.pos[i + 1];
    pos[i + 2] = geo.pos[i + 2] - cz;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute(
    'normal',
    new THREE.BufferAttribute(
      new Float32Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)),
      3,
    ),
  );
  g.setAttribute('shore', new THREE.Float32BufferAttribute(geo.shore, 1));
  g.setAttribute('flowUv', new THREE.Float32BufferAttribute(geo.uv, 2));
  g.setIndex(geo.index);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.position.set(cx, 0, cz);
  mesh.receiveShadow = true;
  mesh.userData.keepMaterial = true; // the cel-shaded style (#206) leaves the water's own banded look alone
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}
