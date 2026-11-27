import * as THREE from 'three';
import { col } from '../../world/three-legacy';
import { HOUSE_FRAMES_MATERIAL } from './house-materials';
import { INK_COLOR } from './ink-flag';

// 3D window frames near the camera, for the toon style (#413): a ring and a sill standing out from the wall over each
// painted window, so the frames get the toon style's bands and some depth. The village has ~36 500 windows, ~660 of them
// within 80 m of Torget, so only those are drawn, as one instanced mesh: one draw call, 44 triangles a frame, about
// 29 000 there. The
// painted windows stay everywhere, so far houses look as before and a frame appearing doesn't change the window under it.

/** The window tile's width (m): a 1.0 m window centred in it, so along a wall the windows stand about this far apart. */
export const WINDOW_TILE_M = 3.2;
// a house: no windows on a wall shorter than this, and none closer to a corner; a big building (an apartment block) has
// a regular grid closer to its corners
const HOUSE_WALL_MIN_M = 3,
  HOUSE_CORNER_M = 0.9,
  BLOCK_WALL_MIN_M = 1.6,
  BLOCK_CORNER_M = 0.4;

/**
 * Where a wall `len` metres long gets its windows (#413): `count` tiles `tile` metres wide from `start` metres along it,
 * centred, so the corners are clear; null for a wall too short for one. A short wall gets one window in its middle. The
 * tile keeps within 0.9 to 1.15 of WINDOW_TILE_M, so a window keeps about its size.
 */
export function windowRun(len: number, isBlock: boolean): { count: number; start: number; tile: number } | null {
  if (len < (isBlock ? BLOCK_WALL_MIN_M : HOUSE_WALL_MIN_M)) return null;
  const free = len - 2 * (isBlock ? BLOCK_CORNER_M : HOUSE_CORNER_M),
    count = Math.max(1, Math.round(free / WINDOW_TILE_M)),
    tile = Math.min(Math.max(free / count, 0.9 * WINDOW_TILE_M), 1.15 * WINDOW_TILE_M, len / count);
  return { count, start: (len - count * tile) / 2, tile };
}

/** What addBuildings records per window: centre x, y, z (m, on the window skin), facing (rad, as rotation.y), width, height (m). */
export const WINDOW_STRIDE = 6;
const CELL_M = 20; // the windows are sorted into a grid of this size, so a refill looks only at the cells in reach
/**
 * The list is refilled once the camera is this far from where it was last filled (m), with every window within the
 * radius plus this, so no window within the radius ever lacks its frame between refills. A distance rather than cell
 * lines, so a camera idling or orbiting on a line (x = 0 and z = 0 run through Torget) doesn't refill every few frames.
 */
export const REFILL_STEP_M = 8;
/** How far from the camera the frames are drawn (m): on desktop, and on a touch screen. */
export const WINDOW_FRAMES_M = 80,
  WINDOW_FRAMES_COARSE_M = 40;
const DEPTH_M = 0.06; // how far the ring stands out
/** The glass of the 3D windows, and of the painted ones in the toon style, so a frame appearing doesn't change it (#413). */
export const WINDOW_GLASS = '#304d61';
const SILL_DEPTH_M = 0.1;
const FRAME = col('#f1efe8'), // col(): the vertex colours are linear, and colour management is off (world/three-legacy.ts)
  INK = col(INK_COLOR), // the toon style's line colour
  GLASS = col(WINDOW_GLASS); // as the art direction mocks' windows
const GLASS_Z_M = 0.03; // the pane sits back in the frame

// in the window's own units: x and y from -0.5 to 0.5 across the painted frame, z in metres out from the wall; the bars
// match the painted frame (8 cm of a 1.0 × 1.25 m window). An instanced mesh can't carry the toon style's ink lines,
// so the frame draws its own: a dark rim along the outer and inner edges of its front, in the vertex colours.
const BAR_X = 0.08,
  BAR_Y = 0.064,
  RIM_X = 0.022,
  RIM_Y = 0.018,
  SILL = { x: 0.56, y0: -0.56, y1: -0.5 };

type P = [number, number, number];
const quads: { q: [P, P, P, P]; c: THREE.Color }[] = [];
// the four strips of a flat ring between an outer and an inner rectangle, at depth d
const flatRing = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ix0: number,
  iy0: number,
  ix1: number,
  iy1: number,
  d: number,
  c: THREE.Color,
) => {
  const o: [number, number][] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    n: [number, number][] = [
      [ix0, iy0],
      [ix1, iy0],
      [ix1, iy1],
      [ix0, iy1],
    ];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quads.push({
      q: [
        [o[i][0], o[i][1], d],
        [o[j][0], o[j][1], d],
        [n[j][0], n[j][1], d],
        [n[i][0], n[i][1], d],
      ],
      c,
    });
  }
};
// the four sides of a rectangle, from the wall out to depth d
const sides = (x0: number, y0: number, x1: number, y1: number, d: number, c: THREE.Color) => {
  const r: [number, number][] = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = r[i],
      [bx, by] = r[(i + 1) % 4];
    quads.push({
      q: [
        [ax, ay, 0],
        [bx, by, 0],
        [bx, by, d],
        [ax, ay, d],
      ],
      c,
    });
  }
};
{
  const d = DEPTH_M,
    [ix0, iy0, ix1, iy1] = [-0.5 + BAR_X, -0.5 + BAR_Y, 0.5 - BAR_X, 0.5 - BAR_Y];
  flatRing(-0.5, -0.5, 0.5, 0.5, -0.5 + RIM_X, -0.5 + RIM_Y, 0.5 - RIM_X, 0.5 - RIM_Y, d, INK);
  flatRing(
    -0.5 + RIM_X,
    -0.5 + RIM_Y,
    0.5 - RIM_X,
    0.5 - RIM_Y,
    ix0 - RIM_X,
    iy0 - RIM_Y,
    ix1 + RIM_X,
    iy1 + RIM_Y,
    d,
    FRAME,
  );
  flatRing(ix0 - RIM_X, iy0 - RIM_Y, ix1 + RIM_X, iy1 + RIM_Y, ix0, iy0, ix1, iy1, d, INK);
  sides(-0.5, -0.5, 0.5, 0.5, d, FRAME); // no inner sides: 6 cm deep, the inner rim does their work, and the painted frame is behind
  // a solid pane over the painted glass and cross bars, as the mocks' windows have
  quads.push({
    q: [
      [ix0, iy0, GLASS_Z_M],
      [ix1, iy0, GLASS_Z_M],
      [ix1, iy1, GLASS_Z_M],
      [ix0, iy1, GLASS_Z_M],
    ],
    c: GLASS,
  });
  // the sill: front (its top edge inked), top and ends; its back is against the wall, and its underside is never seen
  const { x, y0, y1 } = SILL,
    sd = SILL_DEPTH_M,
    rim = y1 - RIM_Y;
  quads.push(
    {
      q: [
        [-x, y0, sd],
        [x, y0, sd],
        [x, rim, sd],
        [-x, rim, sd],
      ],
      c: FRAME,
    },
    {
      q: [
        [-x, rim, sd],
        [x, rim, sd],
        [x, y1, sd],
        [-x, y1, sd],
      ],
      c: INK,
    },
    {
      q: [
        [-x, y1, sd],
        [x, y1, sd],
        [x, y1, 0],
        [-x, y1, 0],
      ],
      c: FRAME,
    },
    {
      q: [
        [-x, y0, 0],
        [-x, y0, sd],
        [-x, y1, sd],
        [-x, y1, 0],
      ],
      c: FRAME,
    },
    {
      q: [
        [x, y0, sd],
        [x, y0, 0],
        [x, y1, 0],
        [x, y1, sd],
      ],
      c: FRAME,
    },
  );
}
/** Triangles per window frame. */
export const FRAME_TRIANGLES = quads.length * 2;

/** One window frame, in the window's own units (see above), white with ink rims in its vertex colours, for an instanced mesh. */
export function frameGeometry(): THREE.BufferGeometry {
  const pos: number[] = [],
    col: number[] = [];
  for (const { q, c } of quads)
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...q[i]);
      col.push(c.r, c.g, c.b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

const _m = new THREE.Matrix4(),
  _p = new THREE.Vector3(),
  _q = new THREE.Quaternion(),
  _s = new THREE.Vector3(),
  _up = new THREE.Vector3(0, 1, 0);

/** The window frames within `radiusM` of the camera, in one instanced mesh it adds to the scene. */
export class WindowFrames {
  readonly mesh: THREE.InstancedMesh;
  // the windows sorted by grid cell, as flat arrays, so a refill allocates nothing: cell c's windows are
  // cellWindows[cellStart[c]] up to cellWindows[cellStart[c + 1]], for c = (cz - z0) * cols + (cx - x0)
  private readonly cellStart: Int32Array;
  private readonly cellWindows: Int32Array;
  private readonly x0: number;
  private readonly z0: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly span: number; // the cells a refill looks at either side of the camera's
  private readonly radiusM: number;
  private filledX = Infinity; // where the list was last filled: nowhere yet
  private filledZ = Infinity;

  constructor(
    scene: THREE.Scene,
    private readonly windows: Float32Array,
    { radiusM }: { radiusM: number },
  ) {
    this.radiusM = radiusM;
    const count = windows.length / WINDOW_STRIDE,
      cxOf = (i: number) => Math.floor(windows[i * WINDOW_STRIDE] / CELL_M),
      czOf = (i: number) => Math.floor(windows[i * WINDOW_STRIDE + 2] / CELL_M);
    let x0 = 0,
      z0 = 0,
      x1 = 0,
      z1 = 0;
    for (let i = 0; i < count; i++) {
      const cx = cxOf(i),
        cz = czOf(i);
      if (i === 0 || cx < x0) x0 = cx;
      if (i === 0 || cz < z0) z0 = cz;
      if (i === 0 || cx > x1) x1 = cx;
      if (i === 0 || cz > z1) z1 = cz;
    }
    this.x0 = x0;
    this.z0 = z0;
    this.cols = x1 - x0 + 1;
    this.rows = z1 - z0 + 1;
    const cellOf = (i: number) => (czOf(i) - z0) * this.cols + (cxOf(i) - x0);
    this.cellStart = new Int32Array(this.cols * this.rows + 1);
    for (let i = 0; i < count; i++) this.cellStart[cellOf(i) + 1]++;
    for (let c = 0; c < this.cols * this.rows; c++) this.cellStart[c + 1] += this.cellStart[c];
    this.cellWindows = new Int32Array(count);
    const next = this.cellStart.slice(0, -1);
    for (let i = 0; i < count; i++) this.cellWindows[next[cellOf(i)]++] = i;
    this.span = Math.ceil((radiusM + REFILL_STEP_M) / CELL_M);
    const capacity = this.mostInReach() || 1;
    this.mesh = new THREE.InstancedMesh(
      frameGeometry(),
      new THREE.MeshLambertMaterial({ vertexColors: true, name: HOUSE_FRAMES_MATERIAL }), // the paint ramp, as the painted windows have
      capacity,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // rewritten at every refill
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false; // its bounds change with every refill
    scene.add(this.mesh);
  }

  /** How many frames the mesh has room for. */
  get capacity() {
    return this.mesh.instanceMatrix.count;
  }

  /** Refills the frames around the camera at (x, z) once it's REFILL_STEP_M from the last refill; a no-op otherwise. */
  update(x: number, z: number) {
    if (Math.hypot(x - this.filledX, z - this.filledZ) < REFILL_STEP_M) return;
    this.filledX = x;
    this.filledZ = z;
    const w = this.windows,
      r = this.radiusM + REFILL_STEP_M,
      cx = Math.floor(x / CELL_M) - this.x0,
      cz = Math.floor(z / CELL_M) - this.z0,
      cap = this.capacity;
    let n = 0;
    for (let j = Math.max(0, cz - this.span); j <= Math.min(this.rows - 1, cz + this.span); j++)
      for (let i = Math.max(0, cx - this.span); i <= Math.min(this.cols - 1, cx + this.span); i++) {
        const c = j * this.cols + i;
        for (let k = this.cellStart[c]; k < this.cellStart[c + 1] && n < cap; k++) {
          const o = this.cellWindows[k] * WINDOW_STRIDE;
          if (Math.hypot(w[o] - x, w[o + 2] - z) > r) continue;
          _p.set(w[o], w[o + 1], w[o + 2]);
          _q.setFromAxisAngle(_up, w[o + 3]);
          _s.set(w[o + 4], w[o + 5], 1);
          this.mesh.setMatrixAt(n++, _m.compose(_p, _q, _s));
        }
      }
    this.mesh.count = n;
    if (!n) return; // nothing to upload: an empty range would send the whole buffer (a length of 0 means "to the end")
    const matrices = this.mesh.instanceMatrix;
    matrices.clearUpdateRanges();
    matrices.addUpdateRange(0, n * 16); // upload only the frames in use, not the whole buffer
    matrices.needsUpdate = true;
  }

  // the most windows a refill can look at, wherever the camera is: the busiest square of cells it reaches, summed
  // over a table of running totals, so the buffer is as big as the densest spot needs and no bigger
  private mostInReach() {
    const { cols, rows, span } = this,
      sums = new Int32Array((cols + 1) * (rows + 1)),
      at = (i: number, j: number) => sums[j * (cols + 1) + i];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const c = j * cols + i;
        sums[(j + 1) * (cols + 1) + i + 1] =
          this.cellStart[c + 1] - this.cellStart[c] + at(i, j + 1) + at(i + 1, j) - at(i, j);
      }
    let most = 0;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const a = Math.max(0, i - span),
          b = Math.max(0, j - span),
          c = Math.min(cols, i + span + 1),
          d = Math.min(rows, j + span + 1);
        most = Math.max(most, at(c, d) - at(a, d) - at(c, b) + at(a, b));
      }
    return most;
  }
}
