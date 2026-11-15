import type { WorldData } from './data';
import { clamp } from './math';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * 'triangle' follows the terrain mesh's triangles exactly, so things placed with it sit on the ground.
 * 'bilinear' is the map's older lookup, which drifts off the mesh between grid points.
 */
export type Interpolation = 'triangle' | 'bilinear';

export interface HeightfieldOptions {
  /** vertical scale; the map doubles heights so the low relief reads */
  exaggeration?: number;
  interpolation?: Interpolation;
}

const NORMAL_STEP_M = 1.5;

/** Terrain heights from the elevation grid, in metres above the lowest sample (times `exaggeration`). */
export class Heightfield {
  /** lowest sample above sea level (m), not exaggerated */
  readonly minElevationM: number;
  /** highest sample above sea level (m), not exaggerated */
  readonly maxElevationM: number;
  private readonly size: number;
  private readonly half: number;
  private readonly samples: number;
  private readonly elev: number[];
  private readonly minDm: number;
  private readonly exaggeration: number;
  private readonly interpolation: Interpolation;

  constructor(data: WorldData, { exaggeration = 1, interpolation = 'triangle' }: HeightfieldOptions = {}) {
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
    this.interpolation = interpolation;
  }

  heightAt(x: number, z: number) {
    const n = this.samples;
    const half = this.half;
    const u = clamp(((x + half) / this.size) * (n - 1), 0, n - 1.0001);
    const v = clamp(((z + half) / this.size) * (n - 1), 0, n - 1.0001);
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const k = j * n + i;
    const a = this.elev[k];
    const b = this.elev[k + 1];
    const d = this.elev[k + n];
    const c = this.elev[k + n + 1];
    if (this.interpolation === 'bilinear') {
      const h = a * (1 - fu) * (1 - fv) + b * fu * (1 - fv) + d * (1 - fu) * fv + c * fu * fv;
      return (h / 10 - this.minElevationM) * this.exaggeration;
    }
    const h = fu + fv <= 1 ? a + (b - a) * fu + (d - a) * fv : c + (d - c) * (1 - fu) + (b - c) * (1 - fv);
    return ((h - this.minDm) / 10) * this.exaggeration;
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
