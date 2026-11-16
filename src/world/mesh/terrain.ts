import '../three-legacy';
import * as THREE from 'three';
import type { Heightfield } from '../heightfield';

export interface TerrainMeshOptions {
  material: THREE.Material;
  skirtMaterial: THREE.Material;
  /** how far below height 0 the skirt round the edge reaches (m) */
  skirtDepthM: number;
}

/**
 * The terrain on the elevation grid, and a skirt that closes its edge down to a solid base. Adds nothing to a scene.
 * `dispose()` frees the geometry it made; the materials stay the caller's.
 */
export class TerrainMesh {
  readonly surface: THREE.Mesh;
  readonly skirt: THREE.Mesh;

  constructor(
    heightfield: Pick<Heightfield, 'samples' | 'sampleCoord' | 'sampleHeight'>,
    { material, skirtMaterial, skirtDepthM }: TerrainMeshOptions,
  ) {
    const n = heightfield.samples;
    const at = (i: number) => heightfield.sampleCoord(i);
    const half = at(n - 1);

    const pos = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    const index: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        pos[k * 3] = at(i);
        pos[k * 3 + 1] = heightfield.sampleHeight(i, j);
        pos[k * 3 + 2] = at(j);
        uv[k * 2] = i / (n - 1);
        uv[k * 2 + 1] = 1 - j / (n - 1);
        if (i < n - 1 && j < n - 1) index.push(k, k + n, k + 1, k + 1, k + n, k + n + 1);
      }
    }
    const surface = new THREE.BufferGeometry();
    surface.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    surface.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    surface.setIndex(index);
    surface.computeVertexNormals();
    this.surface = new THREE.Mesh(surface, material);
    this.surface.receiveShadow = true;

    // one wall per grid step along each edge, from the terrain down to the base
    const bottom = -skirtDepthM;
    const v: number[] = [];
    const edge = (point: (i: number) => [number, number, number]) => {
      for (let i = 0; i < n - 1; i++) {
        const a = point(i);
        const b = point(i + 1);
        v.push(a[0], a[1], a[2], b[0], b[1], b[2], b[0], bottom, b[2], a[0], a[1], a[2], b[0], bottom, b[2], a[0], bottom, a[2]);
      }
    };
    edge((i) => [at(i), heightfield.sampleHeight(i, n - 1), half]);
    edge((i) => [at(i), heightfield.sampleHeight(i, 0), -half]);
    edge((i) => [half, heightfield.sampleHeight(n - 1, i), at(i)]);
    edge((i) => [-half, heightfield.sampleHeight(0, i), at(i)]);
    const skirt = new THREE.BufferGeometry();
    skirt.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    skirt.computeVertexNormals();
    this.skirt = new THREE.Mesh(skirt, skirtMaterial);
  }

  dispose() {
    this.surface.geometry.dispose();
    this.skirt.geometry.dispose();
  }
}
