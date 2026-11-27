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
  /** the industrial chain-link fence's galvanised steel */
  mesh: number;
}

const BOUNDARY_COLOURS: BoundaryColours = {
  hedge: 0x5d7a3c,
  picket: [0xe8e3d6, 0x8e3424],
  board: [0x9a9184, 0x8e3424],
  wall: 0x8d877c,
  mesh: 0x9da3a1,
};

/** side of a batching chunk (m), the same chunking as the streetscape's */
const CHUNK_M = 250;
/**
 * each kind's run is cut into pieces at most this long (m): a hedge's and a wall's each get their own height and shade,
 * and a picket or chain-link fence has a post at each end of its pieces; a board fence's posts are behind its boards, so it shows
 * only the run's end posts
 */
const PIECE_M: Record<BoundaryKind, number> = { 0: 2.4, 1: 2.4, 2: 2.4, 3: 1, 4: 2.5 };
/** how thick each kind is across its line (m); a fence's panel is a plane, its posts are this thick */
const WIDTH_M: Record<BoundaryKind, number> = { 0: 0.7, 1: 0.09, 2: 0.1, 3: 0.5, 4: 0.08 };
/** a hedge's or wall's pieces vary their height by up to this either way (m), and their shade by this share */
const HEIGHT_JITTER_M: Record<BoundaryKind, number> = { 0: 0.08, 1: 0, 2: 0, 3: 0.1, 4: 0 };
const SHADE_JITTER = 0.06;
/** a hedge's top is this much lighter, as if lit from above */
const HEDGE_TOP_LIGHTER = 0.12;
/** one repeat of the fence texture along a fence (m): a picket and its gap, four boards, or one mesh of chain-link */
const REPEAT_M: Record<BoundaryKind, number> = { 0: 1, 1: 0.15, 2: 0.5, 3: 1, 4: 0.08 };
/** a fence's posts stand this far above its panel (m), and are this much darker */
const POST_ABOVE_M = 0.06;
const POST_DARKER = 0.85;
/**
 * the fence texture (FENCE_TEXTURE_PX wide, two bands of BAND_ROWS, bottom up): a picket and its gap, with two rails,
 * pointed at the top and see-through between; and four boards in slightly different shades, with dark joins
 */
const FENCE_TEXTURE_PX = 32;
const BAND_ROWS = 64;
/** each panel fence's band in the texture */
const BAND: Partial<Record<BoundaryKind, number>> = { 1: 0, 2: 1 };
/**
 * the chain-link texture: one diamond mesh, CHAIN_PX square, repeating both ways every REPEAT_M[MESH]; its wires are
 * this share of a mesh thick. Its own alphaTest is low, so the wires thin out with distance rather than vanishing at
 * once, as a real one does; the posts and the top rail carry the fence's line far off.
 */
const CHAIN_PX = 32;
const CHAIN_WIRE = 0.09;
const CHAIN_ALPHA_TEST = 0.3;
/** the chain-link fence's top rail: this thick and tall (m) */
const TOP_RAIL_M = 0.05;
/** the picket half's rows, from the bottom: the picket starts above the ground (the panel is sunk SINK_M), rails, point */
const PICKET_FROM_ROW = 11;
const RAILS: readonly (readonly [number, number])[] = [
  [20, 25],
  [46, 51],
];
const POINT_FROM_ROW = 56;
/** the picket fills this share of its repeat; each board's shade, and its join's */
const PICKET_SHARE = 0.6;
const BOARD_SHADES = [235, 216, 228, 208];
const JOIN_SHADE = 140;

/** everything starts this far below the ground (m), so sloping ground doesn't show a gap under it */
const SINK_M = 0.15;

/** The fence texture: white, see-through between the pickets, grey at the boards' joins (the vertex colour paints it). */
function fenceTexture() {
  const [w, h] = [FENCE_TEXTURE_PX, BAND_ROWS * 2];
  const px = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++)
    for (let col = 0; col < w; col++) {
      const u = (col + 0.5) / w; // across one repeat
      let shade = 255;
      let opaque: boolean;
      const band = Math.floor(row / BAND_ROWS);
      const r = row % BAND_ROWS; // the row within its band
      if (band === 0) {
        // a picket in the middle of its repeat, narrowing to a point at the top, and the rails right across
        const tip = r < POINT_FROM_ROW ? 1 : (BAND_ROWS - r) / (BAND_ROWS - POINT_FROM_ROW);
        const picket = r >= PICKET_FROM_ROW && Math.abs(u - 0.5) < (PICKET_SHARE / 2) * tip;
        opaque = picket || RAILS.some(([a, b]) => r >= a && r < b);
      } else {
        const board = Math.floor(u * BOARD_SHADES.length);
        const join = (u * BOARD_SHADES.length) % 1 < 1 / 8; // a texel's width of each board
        shade = join ? JOIN_SHADE : BOARD_SHADES[board];
        opaque = true;
      }
      px.set([shade, shade, shade, opaque ? 255 : 0], (row * w + col) * 4);
    }
  const texture = new THREE.DataTexture(px, w, h);
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** The chain-link texture: white wires on a diamond, see-through between (the vertex colour paints it). */
function chainTexture() {
  const px = new Uint8Array(CHAIN_PX * CHAIN_PX * 4);
  for (let row = 0; row < CHAIN_PX; row++)
    for (let col = 0; col < CHAIN_PX; col++) {
      // a diamond with its corners at the middles of the tile's edges: the wires where |x| + |y| is a half
      const [x, y] = [(col + 0.5) / CHAIN_PX - 0.5, (row + 0.5) / CHAIN_PX - 0.5];
      const wire = Math.abs(Math.abs(x) + Math.abs(y) - 0.5) < CHAIN_WIRE / 2;
      px.set([255, 255, 255, wire ? 255 : 0], (row * CHAIN_PX + col) * 4);
    }
  const texture = new THREE.DataTexture(px, CHAIN_PX, CHAIN_PX);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Non-indexed triangles under construction: positions, normals, linear colours and texture coordinates, in buffers that grow. */
class Soup {
  position = new Float32Array(3 * 4096);
  normal = new Float32Array(3 * 4096);
  color = new Float32Array(3 * 4096);
  uv = new Float32Array(2 * 4096);
  vertices = 0;

  /**
   * Adds the quad 0 1 2 3 (in order round it, x y z each), facing (nx, ny, nz), in colour c, with the texture
   * coordinates `uv` (u v at each corner) or none.
   */
  quad(q: readonly number[], nx: number, ny: number, nz: number, c: THREE.Color, uv?: readonly number[]) {
    if ((this.vertices + 6) * 3 > this.position.length) {
      for (const name of ['position', 'normal', 'color', 'uv'] as const) {
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
      if (uv) {
        this.uv[(i / 3) * 2] = uv[k * 2];
        this.uv[(i / 3) * 2 + 1] = uv[k * 2 + 1];
      }
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
 * The hedges, fences and walls on the plots' edges. In each CHUNK_M chunk, one vertex-coloured mesh holds the boxes
 * (hedges, walls, fence posts) and one the fences' panels, a textured plane each piece, see-through between the pickets.
 * They cast and take shadows. Nothing collides with them yet. Adds nothing to a scene; dispose() frees every geometry,
 * the materials and the texture.
 */
export class PlotBoundaries {
  readonly meshes: THREE.Mesh[] = [];
  readonly materials = {
    boxes: new THREE.MeshLambertMaterial({ vertexColors: true }),
    panels: new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: fenceTexture(),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    }),
    chain: new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: chainTexture(),
      alphaTest: CHAIN_ALPHA_TEST,
      side: THREE.DoubleSide,
    }),
  };
  readonly triangles: number;

  constructor(runs: readonly BoundaryRun[], { groundAt, colours = BOUNDARY_COLOURS }: PlotBoundariesOptions) {
    const chunks = new Map<string, { boxes: Soup; panels: Soup; chain: Soup }>();
    const base = new THREE.Color();
    const shade = new THREE.Color();
    const top = new THREE.Color();
    const uv = new Array<number>(8);
    for (const run of runs) {
      const key = `${Math.floor(run.p[0] / CHUNK_M)},${Math.floor(run.p[1] / CHUNK_M)}`;
      const chunk = chunks.get(key) ?? { boxes: new Soup(), panels: new Soup(), chain: new Soup() };
      chunks.set(key, chunk);
      const band = BAND[run.kind];
      const chainLink = run.kind === BoundaryKind.MESH;
      const fence = band !== undefined || chainLink;
      const srgb =
        run.kind === BoundaryKind.HEDGE
          ? colours.hedge
          : run.kind === BoundaryKind.PICKET
            ? colours.picket[run.variant]
            : run.kind === BoundaryKind.BOARD
              ? colours.board[run.variant]
              : run.kind === BoundaryKind.MESH
                ? colours.mesh
                : colours.wall;
      base.set(srgb).convertSRGBToLinear();
      const runPieces = pieces(run.p, PIECE_M[run.kind]);
      let groundBefore = 0; // the ground at the end of the piece before, where this one starts
      let alongM = 0; // along the run, so the fence texture carries on from piece to piece
      // each piece stands just inside the plot, its outer face on the line; a slim one keeps its inner face where a
      // full one's is, and leaves the room on the line's side
      const widthM = WIDTH_M[run.kind] * (run.slim ? 0.5 : 1);
      const insetM = run.inward * (WIDTH_M[run.kind] - widthM / 2);
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
        const jitter = fence ? 0 : (hashInts(Math.round(az * 10), Math.round(ax * 10)) * 2 - 1) * SHADE_JITTER;
        shade.copy(base).multiplyScalar(1 + jitter);
        if (fence) {
          // the panel, from the ground to the fence's top, and a post at its start (and the run's end)
          const y1 = ground + height;
          const [tx, tz] = [(bx - ax) / length, (bz - az) / length];
          const [u0, u1] = [alongM / REPEAT_M[run.kind], (alongM + length) / REPEAT_M[run.kind]];
          // a panel fence's band of the fence texture; the chain-link repeats its mesh up the fence too
          const [v0, v1] = band === undefined ? [0, (y1 - y0) / REPEAT_M[run.kind]] : [band / 2, (band + 1) / 2];
          [uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[6], uv[7]] = [u0, v0, u1, v0, u1, v1, u0, v1];
          const soup = chainLink ? chunk.chain : chunk.panels;
          soup.quad(corners(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az), -tz, 0, tx, shade, uv);
          alongM += length;
          top.copy(shade).multiplyScalar(POST_DARKER);
          if (chainLink) box(chunk.boxes, ax, az, bx, bz, TOP_RAIL_M, y1 - TOP_RAIL_M, y1, top, false);
          const post = (x: number, z: number) =>
            box(
              chunk.boxes,
              x - tx * 0.05,
              z - tz * 0.05,
              x + tx * 0.05,
              z + tz * 0.05,
              WIDTH_M[run.kind],
              y0,
              y1 + POST_ABOVE_M,
              top,
            );
          if (i === 0 || run.kind !== BoundaryKind.BOARD) post(ax, az);
          if (i === runPieces.length - 1) post(bx, bz);
          return;
        }
        top.copy(shade).multiplyScalar(run.kind === BoundaryKind.HEDGE ? 1 + HEDGE_TOP_LIGHTER : 1);
        box(chunk.boxes, ax, az, bx, bz, widthM, y0, ground + height, shade, true, top);
      });
    }
    let triangles = 0;
    for (const chunk of chunks.values())
      for (const [soup, material] of [
        [chunk.boxes, this.materials.boxes],
        [chunk.panels, this.materials.panels],
        [chunk.chain, this.materials.chain],
      ] as const) {
        if (!soup.vertices) continue;
        const geometry = new THREE.BufferGeometry();
        const n = soup.vertices * 3;
        geometry.setAttribute('position', new THREE.BufferAttribute(soup.position.slice(0, n), 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(soup.normal.slice(0, n), 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(soup.color.slice(0, n), 3));
        if (material !== this.materials.boxes)
          geometry.setAttribute('uv', new THREE.BufferAttribute(soup.uv.slice(0, soup.vertices * 2), 2));
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.meshes.push(mesh);
        triangles += soup.vertices / 3;
      }
    this.triangles = triangles;
  }

  dispose() {
    for (const mesh of this.meshes) mesh.geometry.dispose();
    this.materials.boxes.dispose();
    for (const material of [this.materials.panels, this.materials.chain]) {
      material.map?.dispose();
      material.dispose();
    }
  }
}
