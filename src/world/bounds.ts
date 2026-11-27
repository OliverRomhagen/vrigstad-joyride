import type { WorldBounds } from './data';
import { clamp } from './math';

/** True when (x, z) is at least `marginM` inside the world's bounds [x0, z0, x1, z1]. */
export function insideBounds([x0, z0, x1, z1]: WorldBounds, x: number, z: number, marginM = 0) {
  return x >= x0 + marginM && x <= x1 - marginM && z >= z0 + marginM && z <= z1 - marginM;
}

/** Moves `p` back to at least `marginM` inside the bounds, along each axis on its own. */
export function clampInside([x0, z0, x1, z1]: WorldBounds, p: { x: number; z: number }, marginM: number) {
  p.x = clamp(p.x, x0 + marginM, x1 - marginM);
  p.z = clamp(p.z, z0 + marginM, z1 - marginM);
}

/** True for a segment whose two ends are both within `marginM` of the same edge: one the world's edge cut, not a shore. */
export function alongEdge(
  [x0, z0, x1, z1]: WorldBounds,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  marginM: number,
) {
  return (
    (ax <= x0 + marginM && bx <= x0 + marginM) ||
    (ax >= x1 - marginM && bx >= x1 - marginM) ||
    (az <= z0 + marginM && bz <= z0 + marginM) ||
    (az >= z1 - marginM && bz >= z1 - marginM)
  );
}
