import '../three-legacy';
import * as THREE from 'three';
import type { Plot } from '../plots';
import { pointInPolygon } from '../polygon';
import { hashInts } from '../random';
import { STREETSCAPE_COLOURS } from './sidewalk-mesh';

/** a driveway's surface floats this far above the ground (m), with a polygon offset as well, so the ground can't show through */
const LIFT_M = 0.03;
/** its surface follows the ground with a cross-section every this many metres */
const STEP_M = 1;
/** where it starts on its plot is found to within this (m) */
const START_STEP_M = 0.25;
/** each driveway's shade varies by up to this share either way */
const SHADE_JITTER = 0.05;
/** side of a batching chunk (m), as the boundaries' */
const CHUNK_M = 250;

export interface DrivewaySurfacesOptions {
  /** the ground under (x, z), the same people stand on */
  groundAt(x: number, z: number): number;
  /** what each plot's driveway is laid with (drivewaySurface in plot-boundaries.ts) */
  surfaceOf(plot: Plot): 'asphalt' | 'gravel';
}

/**
 * The plots' driveways laid on the ground, asphalt or gravel, from where each enters its plot (past the sidewalk, which
 * runs on across it) to its end: one vertex-coloured mesh per CHUNK_M chunk, which takes shadows. Adds nothing to a
 * scene; dispose() frees its geometries and its material.
 */
export class DrivewaySurfaces {
  readonly meshes: THREE.Mesh[] = [];
  readonly material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  readonly triangles: number;

  constructor(plots: readonly Plot[], { groundAt, surfaceOf }: DrivewaySurfacesOptions) {
    const chunks = new Map<string, { position: number[]; color: number[] }>();
    const c = new THREE.Color();
    let triangles = 0;
    for (const plot of plots) {
      const d = plot.driveway;
      if (!d) continue;
      c.set(STREETSCAPE_COLOURS[surfaceOf(plot)]).convertSRGBToLinear();
      c.multiplyScalar(1 + (hashInts(Math.round(d.p[0] * 10), Math.round(d.p[1] * 10)) * 2 - 1) * SHADE_JITTER);
      // the centre line from where it enters the plot, a point every STEP_M, with its direction at each
      const line: number[] = []; // x, z
      // a piece's start is the piece before's end: once is enough, or the strip gets a flat triangle
      const add = (x: number, z: number) => {
        if (line.length && line[line.length - 2] === x && line[line.length - 1] === z) return;
        line.push(x, z);
      };
      let inside = false;
      for (let i = 2; i < d.p.length; i += 2) {
        const [ax, az, bx, bz] = [d.p[i - 2], d.p[i - 1], d.p[i], d.p[i + 1]];
        const length = Math.hypot(bx - ax, bz - az) || 1;
        for (let m = 0; m < length; m += inside ? STEP_M : START_STEP_M) {
          const [x, z] = [ax + ((bx - ax) * m) / length, az + ((bz - az) * m) / length];
          inside ||= pointInPolygon(plot.outline, x, z);
          if (inside) add(x, z);
        }
        if (inside) add(bx, bz);
      }
      if (line.length < 4) continue;
      const key = `${Math.floor(line[0] / CHUNK_M)},${Math.floor(line[1] / CHUNK_M)}`;
      const chunk = chunks.get(key) ?? { position: [], color: [] };
      chunks.set(key, chunk);
      // a strip its width wide: two corners at each point, across its direction there, from the points either side, so
      // a bend's cross-section lies on its bisector and the strip doesn't fold over itself on the inside
      const count = line.length / 2;
      const corners = (k: number) => {
        const [x, z] = [line[k * 2], line[k * 2 + 1]];
        const [i, j] = [Math.max(0, k - 1), Math.min(count - 1, k + 1)];
        const length = Math.hypot(line[j * 2] - line[i * 2], line[j * 2 + 1] - line[i * 2 + 1]) || 1;
        const [tx, tz] = [(line[j * 2] - line[i * 2]) / length, (line[j * 2 + 1] - line[i * 2 + 1]) / length];
        const [nx, nz] = [-tz * (d.widthM / 2), tx * (d.widthM / 2)];
        return [x - nx, groundAt(x - nx, z - nz) + LIFT_M, z - nz, x + nx, groundAt(x + nx, z + nz) + LIFT_M, z + nz];
      };
      let before = corners(0);
      for (let k = 1; k < count; k++) {
        const here = corners(k);
        const [a, b, cc, dd] = [before.slice(0, 3), before.slice(3), here.slice(3), here.slice(0, 3)];
        // left, right, then on: wound counter-clockwise seen from above, so its face is up
        for (const v of [a, b, cc, a, cc, dd]) {
          chunk.position.push(...v);
          chunk.color.push(c.r, c.g, c.b);
        }
        triangles += 2;
        before = here;
      }
    }
    for (const { position, color } of chunks.values()) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.receiveShadow = true;
      this.meshes.push(mesh);
    }
    this.triangles = triangles;
  }

  dispose() {
    for (const mesh of this.meshes) mesh.geometry.dispose();
    this.material.dispose();
  }
}
