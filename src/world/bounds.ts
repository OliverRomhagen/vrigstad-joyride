import type { WorldBounds } from './data';

/** True when (x, z) is at least `marginM` inside the world's bounds [x0, z0, x1, z1]. */
export function insideBounds([x0, z0, x1, z1]: WorldBounds, x: number, z: number, marginM = 0) {
  return x >= x0 + marginM && x <= x1 - marginM && z >= z0 + marginM && z <= z1 - marginM;
}
