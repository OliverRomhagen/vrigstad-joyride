import '../three-legacy';
import * as THREE from 'three';
import { BoundaryKind, type BoundaryRun } from '../plot-boundaries';
import { hashInts } from '../random';

/** sRGB colours of the boundaries: muted late-summer greens, white and falu red paint, grey stone (#145's palette) */
export interface BoundaryColours {
  hedge: number;
  /** a fence's paint by variant: white or grey (0), falu red (1) */
  picket: readonly [number, number];
  board: readonly [number, number];
  wall: number;
}

const BOUNDARY_COLOURS: BoundaryColours = {
  hedge: 0x5d7a3c,
  picket: [0xe8e3d6, 0x8e3424],
  board: [0x9a9184, 0x8e3424],
  wall: 0x8d877c,
};

/** side of a batching chunk (m), the same chunking as the streetscape's */
const CHUNK_M = 250;
/** each kind's run is cut into pieces at most this long (m): a hedge's and a wall's each get their own height and shade */
const PIECE_M: Record<BoundaryKind, number> = { 0: 1.6, 1: 2.4, 2: 2.4, 3: 1 };
/** how thick each kind is across its line (m) */
const WIDTH_M: Record<BoundaryKind, number> = { 0: 0.7, 1: 0.04, 2: 0.06, 3: 0.5 };
/** a hedge's or wall's pieces vary their height by up to this either way (m), and their shade by this share */
const HEIGHT_JITTER_M: Record<BoundaryKind, number> = { 0: 0.08, 1: 0, 2: 0, 3: 0.1 };
const SHADE_JITTER = 0.06;
/** a hedge's top is this much lighter, as if lit from above */
const HEDGE_TOP_LIGHTER = 0.12;
/** pickets stand this far apart (m), each this wide (m); the rail runs this high (m) and is this tall (m) */
const PICKET_EVERY_M = 0.55;
const PICKET_WIDE_M = 0.08;
const RAIL_AT_M = 0.55;
const RAIL_TALL_M = 0.09;
/** everything starts this far below the ground (m), so sloping ground doesn't show a gap under it */
const SINK_M = 0.15;

/** Non-indexed triangles under construction: positions, normals and linear colours, in buffers that grow. */
class Soup {
  position = new Float32Array(3 * 4096);
  normal = new Float32Array(3 * 4096);
  color = new Float32Array(3 * 4096);
  vertices = 0;

  /** Adds the quad 0 1 2 3 (in order round it, x y z each), facing (nx, ny, nz), in colour c. */
  quad(q: readonly number[], nx: number, ny: number, nz: number, c: THREE.Color) {
    if ((this.vertices + 6) * 3 > this.position.length) {
      for (const name of ['position', 'normal', 'color'] as const) {
        const bigger = new Float32Array(this[name].length * 2);
        bigger.set(this[name]);
        this[name] = bigger;
      }
    }
    const ux = q[3] - q[0];
    const uy = q[4] - q[1];
    const uz = q[5] - q[2];
    const vx = q[6] - q[0];
    const vy = q[7] - q[1];
    const vz = q[8] - q[2];
    // three culls back faces: go round the other way when the corners wind away from the normal
    const order =
      (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz < 0 ? REVERSED : FORWARD;
    for (const k of order) {
      const i = this.vertices++ * 3;
      this.position[i] = q[k * 3];
      this.position[i + 1] = q[k * 3 + 1];
      this.position[i + 2] = q[k * 3 + 2];
      this.normal[i] = nx;
      this.normal[i + 1] = ny;
      this.normal[i + 2] = nz;
      this.color[i] = c.r;
      this.color[i + 1] = c.g;
      this.color[i + 2] = c.b;
    }
  }
}
/** a quad's corners as two triangles, one way round and the other */
const FORWARD = [0, 1, 2, 0, 2, 3] as const;
const REVERSED = [0, 3, 2, 0, 2, 1] as const;
/** scratch for a quad's corners */
const _q = new Array<number>(12);
// biome-ignore format: four corners, x y z each
function corners(
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number, x3: number, y3: number, z3: number,
) {
  _q[0] = x0; _q[1] = y0; _q[2] = z0; _q[3] = x1; _q[4] = y1; _q[5] = z1;
  _q[6] = x2; _q[7] = y2; _q[8] = z2; _q[9] = x3; _q[10] = y3; _q[11] = z3;
  return _q;
}

/**
 * Adds a box standing on the ground from (ax, az) to (bx, bz), `width` across, from y0 to y1, with the given faces;
 * its top can take its own colour.
 */
function box(
  soup: Soup,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  width: number,
  y0: number,
  y1: number,
  c: THREE.Color,
  ends = true,
  top: THREE.Color | null = c,
) {
  const length = Math.hypot(bx - ax, bz - az) || 1;
  const tx = (bx - ax) / length;
  const tz = (bz - az) / length;
  const nx = -tz * (width / 2);
  const nz = tx * (width / 2);
  soup.quad(
    corners(ax + nx, y0, az + nz, bx + nx, y0, bz + nz, bx + nx, y1, bz + nz, ax + nx, y1, az + nz),
    -tz,
    0,
    tx,
    c,
  );
  soup.quad(
    corners(ax - nx, y0, az - nz, bx - nx, y0, bz - nz, bx - nx, y1, bz - nz, ax - nx, y1, az - nz),
    tz,
    0,
    -tx,
    c,
  );
  if (top)
    soup.quad(
      corners(ax + nx, y1, az + nz, bx + nx, y1, bz + nz, bx - nx, y1, bz - nz, ax - nx, y1, az - nz),
      0,
      1,
      0,
      top,
    );
  if (ends) {
    soup.quad(
      corners(ax + nx, y0, az + nz, ax - nx, y0, az - nz, ax - nx, y1, az - nz, ax + nx, y1, az + nz),
      -tx,
      0,
      -tz,
      c,
    );
    soup.quad(
      corners(bx + nx, y0, bz + nz, bx - nx, y0, bz - nz, bx - nx, y1, bz - nz, bx + nx, y1, bz + nz),
      tx,
      0,
      tz,
      c,
    );
  }
}

/** Run `p` (flat [x, z, ...]) cut into pieces at most maxM long, each [ax, az, bx, bz]. */
function pieces(p: readonly number[], maxM: number) {
  const out: number[][] = [];
  for (let i = 2; i < p.length; i += 2) {
    const [ax, az, bx, bz] = [p[i - 2], p[i - 1], p[i], p[i + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / maxM));
    for (let k = 0; k < n; k++)
      out.push([
        ax + ((bx - ax) * k) / n,
        az + ((bz - az) * k) / n,
        ax + ((bx - ax) * (k + 1)) / n,
        az + ((bz - az) * (k + 1)) / n,
      ]);
  }
  return out;
}

export interface PlotBoundariesOptions {
  /** the ground under (x, z), the same people stand on */
  groundAt(x: number, z: number): number;
  colours?: BoundaryColours;
}

/**
 * The hedges, fences and walls on the plots' edges: one vertex-coloured mesh per CHUNK_M chunk, which casts and takes
 * shadows. Nothing collides with them yet. Adds nothing to a scene; dispose() frees every geometry and the material.
 */
export class PlotBoundaries {
  readonly meshes: THREE.Mesh[] = [];
  readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  readonly triangles: number;

  constructor(runs: readonly BoundaryRun[], { groundAt, colours = BOUNDARY_COLOURS }: PlotBoundariesOptions) {
    const chunks = new Map<string, Soup>();
    const base = new THREE.Color();
    const shade = new THREE.Color();
    const top = new THREE.Color();
    for (const run of runs) {
      const key = `${Math.floor(run.p[0] / CHUNK_M)},${Math.floor(run.p[1] / CHUNK_M)}`;
      const soup = chunks.get(key) ?? new Soup();
      chunks.set(key, soup);
      const srgb =
        run.kind === BoundaryKind.HEDGE
          ? colours.hedge
          : run.kind === BoundaryKind.PICKET
            ? colours.picket[run.variant]
            : run.kind === BoundaryKind.BOARD
              ? colours.board[run.variant]
              : colours.wall;
      base.set(srgb).convertSRGBToLinear();
      const runPieces = pieces(run.p, PIECE_M[run.kind]);
      let groundBefore = 0; // the ground at the end of the piece before, where this one starts
      // each piece stands just inside the plot, its outer face on the line
      const insetM = (run.inward * WIDTH_M[run.kind]) / 2;
      runPieces.forEach(([px, pz, qx, qz], i) => {
        const length = Math.hypot(qx - px, qz - pz) || 1;
        const [rx, rz] = [(-(qz - pz) / length) * insetM, ((qx - px) / length) * insetM]; // to the right, times the inset
        const [ax, az, bx, bz] = [px + rx, pz + rz, qx + rx, qz + rz];
        const ga = i ? groundBefore : groundAt(ax, az);
        const gb = groundAt(bx, bz);
        groundBefore = gb;
        const y0 = Math.min(ga, gb) - SINK_M;
        const ground = (ga + gb) / 2;
        const roll = hashInts(Math.round(ax * 10), Math.round(az * 10));
        const height = run.heightM + (roll * 2 - 1) * HEIGHT_JITTER_M[run.kind];
        shade
          .copy(base)
          .multiplyScalar(1 + (hashInts(Math.round(az * 10), Math.round(ax * 10)) * 2 - 1) * SHADE_JITTER);
        if (run.kind === BoundaryKind.PICKET) {
          const length = Math.hypot(bx - ax, bz - az);
          const count = Math.max(1, Math.round(length / PICKET_EVERY_M));
          for (let k = 0; k < count; k++) {
            const t = (k + 0.5) / count;
            const half = PICKET_WIDE_M / 2 / (length || 1);
            const [t0, t1] = [t - half, t + half];
            const [x0, z0, x1, z1] = [
              ax + (bx - ax) * t0,
              az + (bz - az) * t0,
              ax + (bx - ax) * t1,
              az + (bz - az) * t1,
            ];
            // a picket's top and ends are a few centimetres across: only its faces are drawn
            box(soup, x0, z0, x1, z1, WIDTH_M[run.kind], y0, ground + height, shade, false, null);
          }
          const railY = ground + RAIL_AT_M;
          box(soup, ax, az, bx, bz, WIDTH_M[run.kind] * 1.5, railY, railY + RAIL_TALL_M, shade, false, null);
          return;
        }
        top.copy(shade).multiplyScalar(run.kind === BoundaryKind.HEDGE ? 1 + HEDGE_TOP_LIGHTER : 1);
        // a board fence's pieces are all one height, so only the run's own ends show; a hedge's and a wall's step
        const ends = run.kind !== BoundaryKind.BOARD || i === 0 || i === runPieces.length - 1;
        box(soup, ax, az, bx, bz, WIDTH_M[run.kind], y0, ground + height, shade, ends, top);
      });
    }
    let triangles = 0;
    for (const soup of chunks.values()) {
      const geometry = new THREE.BufferGeometry();
      const n = soup.vertices * 3;
      geometry.setAttribute('position', new THREE.BufferAttribute(soup.position.slice(0, n), 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(soup.normal.slice(0, n), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(soup.color.slice(0, n), 3));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.meshes.push(mesh);
      triangles += soup.vertices / 3;
    }
    this.triangles = triangles;
  }

  dispose() {
    for (const mesh of this.meshes) mesh.geometry.dispose();
    this.material.dispose();
  }
}
