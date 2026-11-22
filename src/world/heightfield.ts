import type { WorldData } from './data';
import { clamp } from './math';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * A change to the ground that the grid can't show, such as a river channel (`WaterBodies`). The heightfield asks it
 * once, when it is built, and stores what it says on a finer grid in the cells it touches.
 */
export interface TerrainCut {
  /**
   * Samples per side the grid cell from (x0, z0) to (x1, z1) needs: 0 when the cut leaves it alone, 1 for its corners
   * only, more for a finer grid. It may say more than needed: a cell the cut turns out not to change stays as it was.
   */
  detail(x0: number, z0: number, x1: number, z1: number): number;
  /** the cut ground at (x, z), in metres above the lowest sample and not exaggerated, where the uncut ground is `baseM` */
  cutAt(x: number, z: number, baseM: number): number;
}

export interface HeightfieldOptions {
  /** vertical scale; the map doubles heights so the low relief reads */
  exaggeration?: number;
  /** carved into the ground before the exaggeration, so the map's doubled relief doubles it too */
  cut?: TerrainCut;
}

interface FineCell {
  /** samples per side */
  m: number;
  /** (m + 1)² heights in metres above the lowest sample, not exaggerated, row by row from the cell's north-west corner */
  h: Float32Array;
}

const NORMAL_STEP_M = 1.5;

/**
 * Terrain heights from the elevation grid, in metres above the lowest sample (times `exaggeration`).
 * Interpolated on the terrain mesh's triangles, so anything placed with it sits on the ground.
 */
export class Heightfield {
  /** lowest sample above sea level (m), not exaggerated */
  readonly minElevationM: number;
  /** highest sample above sea level (m), not exaggerated */
  readonly maxElevationM: number;
  /** samples along each side of the grid */
  readonly samples: number;
  private readonly size: number;
  private readonly half: number;
  private readonly elev: number[];
  private readonly minDm: number;
  private readonly exaggeration: number;
  /** the cut's coarse samples in metres above the lowest, when there is a cut */
  private readonly cutElev: Float64Array | null = null;
  /** per grid cell (row by row), its index into `fine`, or -1 */
  private readonly fineIndex: Int32Array | null = null;
  private readonly fine: FineCell[] = [];

  constructor(data: WorldData, { exaggeration = 1, cut }: HeightfieldOptions = {}) {
    this.size = data.size;
    this.half = data.size / 2;
    this.samples = data.n;
    this.elev = data.elev;
    // a loop, not Math.min(...elev): spreading a finer grid would pass the engine's argument limit
    let minDm = Infinity;
    let maxDm = -Infinity;
    for (const h of data.elev) {
      if (h < minDm) minDm = h;
      if (h > maxDm) maxDm = h;
    }
    this.minDm = minDm;
    this.minElevationM = minDm / 10;
    this.maxElevationM = maxDm / 10;
    this.exaggeration = exaggeration;
    if (cut) {
      this.cutElev = Float64Array.from(data.elev, h => (h - minDm) / 10);
      this.fineIndex = new Int32Array((this.samples - 1) ** 2).fill(-1);
      this.applyCut(cut);
    }
  }

  /** samples per side of grid cell (i, j): 0 or 1 where it is the plain grid cell, more where a cut refined it */
  cellDetail(i: number, j: number) {
    const f = this.fineIndex ? this.fineIndex[j * (this.samples - 1) + i] : -1;
    return f < 0 ? 0 : this.fine[f].m;
  }

  /** Height of sub-sample (a, b) of refined cell (i, j), a from the west and b from the north, as `heightAt` reads it. */
  fineHeight(i: number, j: number, a: number, b: number) {
    const c = this.fine[(this.fineIndex as Int32Array)[j * (this.samples - 1) + i]];
    return c.h[b * (c.m + 1) + a] * this.exaggeration;
  }

  /** grid cells a cut refined */
  get refinedCells() {
    return this.fine.length;
  }

  heightAt(x: number, z: number) {
    if (this.cutElev) return this.cutHeight(x, z) * this.exaggeration;
    const n = this.samples;
    const half = this.half;
    const u = clamp(((x + half) / this.size) * (n - 1), 0, n - 1.0001);
    const v = clamp(((z + half) / this.size) * (n - 1), 0, n - 1.0001);
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const k = j * n + i;
    const h = triangle(this.elev[k], this.elev[k + 1], this.elev[k + n], this.elev[k + n + 1], fu, fv);
    return ((h - this.minDm) / 10) * this.exaggeration;
  }

  /**
   * Height of the elevation sample in column `i` (from the west) and row `j` (from the north): the value `heightAt`
   * interpolates from there, worked out the same way, so a mesh built on the samples matches the lookup.
   */
  sampleHeight(i: number, j: number) {
    if (this.cutElev) return this.cutElev[j * this.samples + i] * this.exaggeration;
    const h = this.elev[j * this.samples + i];
    return ((h - this.minDm) / 10) * this.exaggeration;
  }

  /** x of the samples in column `i`, or z of those in row `i` (m); the grid's edges are at ±half its size */
  sampleCoord(i: number) {
    return -this.half + (this.size * i) / (this.samples - 1);
  }

  /** the uncut ground at (x, z), in metres above the lowest sample, not exaggerated */
  private baseAt(x: number, z: number) {
    const n = this.samples;
    const u = clamp(((x + this.half) / this.size) * (n - 1), 0, n - 1.0001);
    const v = clamp(((z + this.half) / this.size) * (n - 1), 0, n - 1.0001);
    const i = Math.floor(u);
    const j = Math.floor(v);
    const k = j * n + i;
    const e = this.elev;
    return (triangle(e[k], e[k + 1], e[k + n], e[k + n + 1], u - i, v - j) - this.minDm) / 10;
  }

  private cutHeight(x: number, z: number) {
    const n = this.samples;
    const u = clamp(((x + this.half) / this.size) * (n - 1), 0, n - 1.0001);
    const v = clamp(((z + this.half) / this.size) * (n - 1), 0, n - 1.0001);
    const i = Math.floor(u);
    const j = Math.floor(v);
    const f = (this.fineIndex as Int32Array)[j * (n - 1) + i];
    if (f < 0) {
      const e = this.cutElev as Float64Array;
      const k = j * n + i;
      return triangle(e[k], e[k + 1], e[k + n], e[k + n + 1], u - i, v - j);
    }
    const { m, h } = this.fine[f];
    const fu = Math.min((u - i) * m, m - 0.0001);
    const fv = Math.min((v - j) * m, m - 0.0001);
    const a = Math.floor(fu);
    const b = Math.floor(fv);
    const k = b * (m + 1) + a;
    return triangle(h[k], h[k + 1], h[k + m + 1], h[k + m + 2], fu - a, fv - b);
  }

  /**
   * Asks the cut which cells it changes and stores the cut ground there, each cell on the coarsest of its grids
   * (halving from the detail the cut asked for, down to the plain cell) that holds the cut within CUT_TOLERANCE_M.
   * A refined cell's edge that it shares with a plain cell is a straight line between the two corners, as the plain
   * cell's triangle edge is; an edge shared with another refined cell carries the cut at the points both cells have,
   * and is straight between them. So the mesh built on these samples has no cracks.
   */
  private applyCut(cut: TerrainCut) {
    const n = this.samples;
    const cells = n - 1;
    const at = (i: number) => this.sampleCoord(i);
    const elev = this.cutElev as Float64Array;
    const fineIndex = this.fineIndex as Int32Array;
    const asked = new Uint8Array(cells * cells);
    for (let j = 0; j < cells; j++)
      for (let i = 0; i < cells; i++) asked[j * cells + i] = cut.detail(at(i), at(j), at(i + 1), at(j + 1));
    // corners first: every sample of a cell the cut touches takes the cut's height there; a cell left plain shares its
    // corners with the mesh, so it stays joined even where a corner moved
    const touched = new Uint8Array(n * n);
    for (let j = 0; j < cells; j++)
      for (let i = 0; i < cells; i++)
        if (asked[j * cells + i]) {
          const k = j * n + i;
          touched[k] = touched[k + 1] = touched[k + n] = touched[k + n + 1] = 1;
        }
    for (let k = 0; k < n * n; k++) if (touched[k]) elev[k] = cut.cutAt(at(k % n), at(Math.floor(k / n)), elev[k]);

    // the cut at every sub-sample of the detail asked for, and the coarsest grid that holds it
    const full: (Float32Array | null)[] = new Array(cells * cells).fill(null);
    const detail = new Uint8Array(cells * cells);
    for (let j = 0; j < cells; j++)
      for (let i = 0; i < cells; i++) {
        const m = asked[j * cells + i];
        if (m < 2) {
          detail[j * cells + i] = m;
          continue;
        }
        const x0 = at(i);
        const z0 = at(j);
        const side = at(i + 1) - x0;
        const h = new Float32Array((m + 1) * (m + 1));
        let changed = false;
        for (let b = 0; b <= m; b++)
          for (let a = 0; a <= m; a++) {
            const corner = (a === 0 || a === m) && (b === 0 || b === m);
            const x = x0 + (side * a) / m;
            const z = z0 + (side * b) / m;
            const base = this.baseAt(x, z);
            const y = corner ? elev[(j + (b ? 1 : 0)) * n + i + (a ? 1 : 0)] : cut.cutAt(x, z, base);
            h[b * (m + 1) + a] = y;
            if (Math.abs(y - base) > 1e-6) changed = true;
          }
        if (!changed) continue;
        full[j * cells + i] = h;
        detail[j * cells + i] = coarsest(h, m);
      }

    // past the world's edge there is no neighbour to agree with: the edge takes the cut at every sub-sample
    const detailOf = (i: number, j: number, own: number) =>
      i < 0 || j < 0 || i >= cells || j >= cells ? own : detail[j * cells + i];
    for (let j = 0; j < cells; j++)
      for (let i = 0; i < cells; i++) {
        const c = detail[j * cells + i];
        const h0 = full[j * cells + i];
        if (c < 2 || !h0) continue;
        const m = asked[j * cells + i];
        const r = m / c;
        const fullAt = (a: number, b: number) => h0[b * r * (m + 1) + a * r];
        const h = new Float32Array((c + 1) * (c + 1));
        for (let b = 0; b <= c; b++)
          for (let a = 0; a <= c; a++) {
            let y = fullAt(a, b);
            if ((b === 0 || b === c || a === 0 || a === c) && !((a === 0 || a === c) && (b === 0 || b === c))) {
              // on an edge: the points this cell shares with its neighbour, straight between them
              const vertical = a === 0 || a === c;
              const t = vertical ? b : a;
              const other = vertical ? detailOf(i + (a ? 1 : -1), j, c) : detailOf(i, j + (b ? 1 : -1), c);
              const g = other < 2 ? 1 : gcd(c, other);
              const step = c / g;
              const q0 = Math.floor(t / step);
              const f = t / step - q0;
              if (f) {
                const end = (q: number) => (vertical ? fullAt(a, q * step) : fullAt(q * step, b));
                y = end(q0) + (end(q0 + 1) - end(q0)) * f;
              }
            }
            h[b * (c + 1) + a] = y;
          }
        fineIndex[j * cells + i] = this.fine.length;
        this.fine.push({ m: c, h });
      }
  }

  /** The terrain's up vector at (x, z), written into `out`. Normalised as three's Vector3.normalize does. */
  normalAt<T extends Vec3Like>(x: number, z: number, out: T): T {
    const nx = this.heightAt(x - NORMAL_STEP_M, z) - this.heightAt(x + NORMAL_STEP_M, z);
    const ny = 2 * NORMAL_STEP_M;
    const nz = this.heightAt(x, z - NORMAL_STEP_M) - this.heightAt(x, z + NORMAL_STEP_M);
    const scale = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    out.x = nx * scale;
    out.y = ny * scale;
    out.z = nz * scale;
    return out;
  }
}

/** a refined cell keeps the coarsest grid that holds the cut within this, everywhere on its finest grid (m) */
const CUT_TOLERANCE_M = 0.05;

/**
 * The coarsest grid, halving from m (or the plain cell, 1), whose triangles hold the samples `h` of an m grid within
 * CUT_TOLERANCE_M. A grid that doesn't divide m evenly is skipped.
 */
function coarsest(h: Float32Array, m: number) {
  const fits = (c: number) => {
    const r = m / c;
    for (let b = 0; b <= m; b++)
      for (let a = 0; a <= m; a++) {
        const u = a / r;
        const v = b / r;
        const ca = Math.min(Math.floor(u), c - 1);
        const cb = Math.min(Math.floor(v), c - 1);
        const k = (cb * (m + 1) + ca) * r;
        const right = r;
        const down = r * (m + 1);
        const y = triangle(h[k], h[k + right], h[k + down], h[k + down + right], u - ca, v - cb);
        if (Math.abs(y - h[b * (m + 1) + a]) > CUT_TOLERANCE_M) return false;
      }
    return true;
  };
  if (fits(1)) return 1;
  let best = m;
  for (let c = m / 2; Number.isInteger(c) && c >= 2 && fits(c); c /= 2) best = c;
  return best;
}

/** The height at (fu, fv) in a cell with corners a (north-west), b (north-east), d (south-west), c (south-east), split along the diagonal from b to d. */
function triangle(a: number, b: number, d: number, c: number, fu: number, fv: number) {
  return fu + fv <= 1 ? a + (b - a) * fu + (d - a) * fv : c + (d - c) * (1 - fu) + (b - c) * (1 - fv);
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}
