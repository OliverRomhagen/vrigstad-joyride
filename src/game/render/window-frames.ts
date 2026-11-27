import * as THREE from 'three';
import { HOUSE_FRAMES_MATERIAL } from './house-materials';

// 3D window frames near the camera, for the toon style (#413): a ring and a sill standing out from the wall over each
// painted window, so the frames get the toon style's bands and some depth. The village has ~36 500 windows, ~660 of them
// within 80 m of Torget, so only those are drawn, as one instanced mesh: one draw call, about 22 000 triangles there. The
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
const CELL_M = 20; // the list is refilled when the camera enters another cell of this size
/** How far from the camera the frames are drawn (m): on desktop, and on a touch screen. */
export const WINDOW_FRAMES_M = 80,
  WINDOW_FRAMES_COARSE_M = 40;
const DEPTH_M = 0.06; // how far the ring stands out
/** The glass of the 3D windows, and of the painted ones in the toon style, so a frame appearing doesn't change it (#413). */
export const WINDOW_GLASS = '#304d61';
const SILL_DEPTH_M = 0.1;
const FRAME = new THREE.Color('#f1efe8'),
  INK = new THREE.Color('#10151c'), // the toon style's line colour (toon-style.ts)
  GLASS = new THREE.Color(WINDOW_GLASS); // as the art direction mocks' windows
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
  private readonly cells = new Map<string, number[]>();
  private readonly radiusM: number;
  private cell = '';

  constructor(
    scene: THREE.Scene,
    private readonly windows: Float32Array,
    { radiusM }: { radiusM: number },
  ) {
    this.radiusM = radiusM;
    for (let i = 0; i < windows.length / WINDOW_STRIDE; i++) {
      const k = this.cellKey(windows[i * WINDOW_STRIDE], windows[i * WINDOW_STRIDE + 2]);
      let list = this.cells.get(k);
      if (!list) {
        list = [];
        this.cells.set(k, list);
      }
      list.push(i);
    }
    // room for the densest spot: every window in the cells a radius can reach, at most
    const reach = Math.ceil(radiusM / CELL_M) * 2 + 1;
    let densest = 0;
    for (const list of this.cells.values()) densest = Math.max(densest, list.length);
    const capacity = Math.min(windows.length / WINDOW_STRIDE, densest * reach * reach) || 1;
    this.mesh = new THREE.InstancedMesh(
      frameGeometry(),
      new THREE.MeshLambertMaterial({ vertexColors: true, name: HOUSE_FRAMES_MATERIAL }), // the name gives it the toon style's house ramp
      capacity,
    );
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false; // its bounds change with every refill
    scene.add(this.mesh);
  }

  /** Refills the frames around (x, z) when that's in another cell than last time; a no-op otherwise. */
  update(x: number, z: number) {
    const k = this.cellKey(x, z);
    if (k === this.cell) return;
    this.cell = k;
    const w = this.windows,
      r = this.radiusM,
      cx = Math.floor(x / CELL_M),
      cz = Math.floor(z / CELL_M),
      span = Math.ceil(r / CELL_M),
      cap = this.mesh.instanceMatrix.count;
    let n = 0;
    for (let i = cx - span; i <= cx + span && n < cap; i++)
      for (let j = cz - span; j <= cz + span && n < cap; j++)
        for (const wi of this.cells.get(i + ',' + j) ?? []) {
          const o = wi * WINDOW_STRIDE;
          if (Math.hypot(w[o] - x, w[o + 2] - z) > r) continue;
          _p.set(w[o], w[o + 1], w[o + 2]);
          _q.setFromAxisAngle(_up, w[o + 3]);
          _s.set(w[o + 4], w[o + 5], 1);
          this.mesh.setMatrixAt(n++, _m.compose(_p, _q, _s));
          if (n === cap) break;
        }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private cellKey(x: number, z: number) {
    return Math.floor(x / CELL_M) + ',' + Math.floor(z / CELL_M);
  }
}
