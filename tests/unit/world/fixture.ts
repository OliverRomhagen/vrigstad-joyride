import type { WorldData } from '../../../src/world/data';

/** A 100 m square world, flat unless `elev` says otherwise. The 3 × 3 grid puts samples at -50, 0 and 50 m. */
export function makeWorld(overrides: Partial<WorldData> = {}): WorldData {
  return { size: 100, n: 3, elev: new Array(9).fill(0), b: [], r: [], w: [], ww: [], l: [], labels: [], ...overrides };
}

/** An axis-aligned square outline, as a flat [x, z, ...] array. */
export const square = (x0: number, z0: number, side: number) => [x0, z0, x0 + side, z0, x0 + side, z0 + side, x0, z0 + side];
