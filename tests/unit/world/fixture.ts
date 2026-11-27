import type { WorldBounds, WorldData } from '../../../src/world/data';

/** the bounds of a square world `side` metres across, centred on the origin */
export const centred = (side: number): WorldBounds => [-side / 2, -side / 2, side / 2, side / 2];

/** A 100 m square world, flat unless `elev` says otherwise. The 3 × 3 grid puts samples at -50, 0 and 50 m. */
export function makeWorld(overrides: Partial<WorldData> = {}): WorldData {
  return {
    bounds: [-50, -50, 50, 50],
    nx: 3,
    nz: 3,
    elev: new Array(9).fill(0),
    b: [],
    r: [],
    w: [],
    ww: [],
    l: [],
    labels: [],
    ...overrides,
  };
}

/** An axis-aligned square outline, as a flat [x, z, ...] array. */
export const square = (x0: number, z0: number, side: number) => [
  x0,
  z0,
  x0 + side,
  z0,
  x0 + side,
  z0 + side,
  x0,
  z0 + side,
];

/**
 * A 400 m square world on a 25 m grid (17 × 17 samples, -200 to 200 m), falling 1 m every 100 m eastwards from 10 m,
 * for the water's channels: fine enough that a river's banks sit inside it.
 */
export function makeValley(overrides: Partial<WorldData> = {}): WorldData {
  const n = 17;
  const elev: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) elev.push(100 - i * 2.5);
  return makeWorld({ bounds: [-200, -200, 200, 200], nx: n, nz: n, elev, ...overrides });
}
