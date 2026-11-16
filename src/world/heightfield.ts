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
export function createHeightfield(data: WorldData, { exaggeration = 1, interpolation = 'triangle' }: HeightfieldOptions = {}) {
  const size = data.size;
  const half = size / 2;
  const n = data.n;
  const elev = data.elev;
  // a loop, not Math.min(...elev): spreading a finer grid would pass the engine's argument limit
  let minDm = Infinity;
  let maxDm = -Infinity;
  for (const h of elev) {
    if (h < minDm) minDm = h;
    if (h > maxDm) maxDm = h;
  }
  const minM = minDm / 10;

  function heightAt(x: number, z: number) {
    const u = clamp(((x + half) / size) * (n - 1), 0, n - 1.0001);
    const v = clamp(((z + half) / size) * (n - 1), 0, n - 1.0001);
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const k = j * n + i;
    const a = elev[k];
    const b = elev[k + 1];
    const d = elev[k + n];
    const c = elev[k + n + 1];
    if (interpolation === 'bilinear') {
      const h = a * (1 - fu) * (1 - fv) + b * fu * (1 - fv) + d * (1 - fu) * fv + c * fu * fv;
      return (h / 10 - minM) * exaggeration;
    }
    const h = fu + fv <= 1 ? a + (b - a) * fu + (d - a) * fv : c + (d - c) * (1 - fu) + (b - c) * (1 - fv);
    return ((h - minDm) / 10) * exaggeration;
  }

  /** The terrain's up vector at (x, z), written into `out`. Normalised as three's Vector3.normalize does. */
  function normalAt<T extends Vec3Like>(x: number, z: number, out: T): T {
    const nx = heightAt(x - NORMAL_STEP_M, z) - heightAt(x + NORMAL_STEP_M, z);
    const ny = 2 * NORMAL_STEP_M;
    const nz = heightAt(x, z - NORMAL_STEP_M) - heightAt(x, z + NORMAL_STEP_M);
    const scale = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    out.x = nx * scale;
    out.y = ny * scale;
    out.z = nz * scale;
    return out;
  }

  return {
    heightAt,
    normalAt,
    /** lowest and highest sample above sea level (m), not exaggerated */
    minElevationM: minM,
    maxElevationM: maxDm / 10,
  };
}

export type Heightfield = ReturnType<typeof createHeightfield>;
