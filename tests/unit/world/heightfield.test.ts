import { describe, expect, it } from 'vitest';
import { Heightfield } from '../../../src/world/heightfield';
import { makeWorld } from './fixture';

// rises 1 m every 50 m eastwards: decimetres per column 0, 10, 20
const EAST_SLOPE = [0, 10, 20, 0, 10, 20, 0, 10, 20];
// flat but for the far corner of the cell from (0, 0) to (50, 50), raised 10 m
const ONE_CORNER = [0, 0, 0, 0, 0, 0, 0, 0, 100];

describe('heightAt', () => {
  it('reads the samples at grid points, in metres above the lowest', () => {
    const field = new Heightfield(makeWorld({ elev: EAST_SLOPE.map(e => e + 500) }));
    expect(field.heightAt(-50, 0)).toBeCloseTo(0);
    expect(field.heightAt(0, 0)).toBeCloseTo(1);
  });

  it('interpolates within a triangle', () => {
    const field = new Heightfield(makeWorld({ elev: EAST_SLOPE }));
    expect(field.heightAt(25, 0)).toBeCloseTo(1.5);
  });

  it('follows the mesh triangles, so the diagonal of a cell is a crease', () => {
    const field = new Heightfield(makeWorld({ elev: ONE_CORNER }));
    expect(field.heightAt(25, 25)).toBeCloseTo(0);
    expect(field.heightAt(30, 30)).toBeCloseTo(2);
  });

  it('reads the last row and column, and holds the edge height outside the world', () => {
    const field = new Heightfield(makeWorld({ elev: EAST_SLOPE }));
    expect(field.heightAt(50, 0)).toBeCloseTo(2);
    expect(field.heightAt(50, 50)).toBeCloseTo(2);
    expect(field.heightAt(0, 50)).toBeCloseTo(1);
    expect(field.heightAt(1000, 0)).toBe(field.heightAt(50, 0));
    expect(field.heightAt(-1000, 0)).toBe(field.heightAt(-50, 0));
    expect(field.heightAt(0, 1000)).toBe(field.heightAt(0, 50));
  });

  it('scales by the exaggeration', () => {
    const plain = new Heightfield(makeWorld({ elev: EAST_SLOPE }));
    const doubled = new Heightfield(makeWorld({ elev: EAST_SLOPE }), { exaggeration: 2 });
    expect(doubled.heightAt(25, 0)).toBeCloseTo(plain.heightAt(25, 0) * 2);
  });

  it('reports the lowest and highest samples above sea level', () => {
    const field = new Heightfield(makeWorld({ elev: EAST_SLOPE.map(e => e + 500) }), { exaggeration: 2 });
    expect(field.minElevationM).toBe(50);
    expect(field.maxElevationM).toBe(52);
  });
});

describe('normalAt', () => {
  it('points straight up on flat ground', () => {
    const field = new Heightfield(makeWorld());
    expect(field.normalAt(10, 10, { x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('leans away from the uphill side, at unit length', () => {
    const field = new Heightfield(makeWorld({ elev: EAST_SLOPE }));
    const n = field.normalAt(10, 10, { x: 0, y: 0, z: 0 });
    expect(n.x).toBeLessThan(0);
    expect(n.z).toBeCloseTo(0);
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1);
  });

  it('writes into the object it is given and returns it', () => {
    const field = new Heightfield(makeWorld());
    const out = { x: 9, y: 9, z: 9 };
    expect(field.normalAt(0, 0, out)).toBe(out);
  });
});

describe('sampleHeight', () => {
  // uneven heights, as real data has, so a different order of operations would round differently in the last bit
  const UNEVEN = [1001, 1234, 1587, 1102, 1999, 1313, 1050, 1234, 1587];

  it('matches heightAt exactly at the samples', () => {
    const field = new Heightfield(makeWorld({ elev: UNEVEN }), { exaggeration: 2 });
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) expect(field.sampleHeight(i, j)).toBe(field.heightAt(-50 + 50 * i, -50 + 50 * j));
  });

  it('reads the last row and column', () => {
    const field = new Heightfield(makeWorld({ elev: EAST_SLOPE }));
    expect(field.sampleHeight(2, 2)).toBeCloseTo(2);
  });
});

describe('sampleCoordX and sampleCoordZ', () => {
  it('put the samples where heightAt reads them, from edge to edge', () => {
    const field = new Heightfield(makeWorld({ elev: EAST_SLOPE }));
    expect([0, 1, 2].map(i => field.sampleCoordX(i))).toEqual([-50, 0, 50]);
    expect([0, 1, 2].map(j => field.sampleCoordZ(j))).toEqual([-50, 0, 50]);
    for (let i = 0; i < 3; i++) expect(field.heightAt(field.sampleCoordX(i), 0)).toBeCloseTo(field.sampleHeight(i, 1));
  });
});

describe('Heightfield on a rectangle', () => {
  // 100 m east to west and 50 m north to south, 3 × 2 samples 50 m apart: rising 1 m every 50 m eastwards and 10 m
  // southwards, so a mixed-up axis reads a different height
  const RECT = makeWorld({ bounds: [-50, 0, 50, 50], nx: 3, nz: 2, elev: [0, 10, 20, 100, 110, 120] });

  it('counts and places the samples along each axis', () => {
    const field = new Heightfield(RECT);
    expect([field.nx, field.nz]).toEqual([3, 2]);
    expect([0, 1, 2].map(i => field.sampleCoordX(i))).toEqual([-50, 0, 50]);
    expect([0, 1].map(j => field.sampleCoordZ(j))).toEqual([0, 50]);
  });

  it('reads the four corners and the middle of an edge', () => {
    const field = new Heightfield(RECT);
    expect(field.heightAt(-50, 0)).toBeCloseTo(0);
    expect(field.heightAt(50, 0)).toBeCloseTo(2);
    expect(field.heightAt(-50, 50)).toBeCloseTo(10);
    expect(field.heightAt(50, 50)).toBeCloseTo(12);
    expect(field.heightAt(0, 25)).toBeCloseTo(6); // half way down the west edge of the east cell
    expect(field.sampleHeight(2, 1)).toBeCloseTo(12);
  });

  it('holds the edge height outside the rectangle, on each side', () => {
    const field = new Heightfield(RECT);
    expect(field.heightAt(1000, 1000)).toBe(field.heightAt(50, 50));
    expect(field.heightAt(-1000, -1000)).toBe(field.heightAt(-50, 0));
    expect(field.heightAt(0, -500)).toBe(field.heightAt(0, 0));
    expect(field.heightAt(500, 25)).toBe(field.heightAt(50, 25));
  });

  it('refines only the cells a cut asks for, each where it is', () => {
    // a cut that lowers the east cell (x 0 to 50) by 3 m and leaves the west one alone
    const east = {
      detail: (x0: number) => (x0 >= 0 ? 4 : 0),
      cutAt: (x: number, _z: number, base: number) => (x > 0 ? base - 3 : base),
    };
    const field = new Heightfield(RECT, { cut: east });
    expect(field.cellDetail(0, 0)).toBe(0);
    expect(field.cellDetail(1, 0)).toBeGreaterThan(0);
    expect(field.heightAt(25, 25)).toBeCloseTo(new Heightfield(RECT).heightAt(25, 25) - 3);
    expect(field.heightAt(-25, 25)).toBeCloseTo(new Heightfield(RECT).heightAt(-25, 25));
  });
});

describe('Heightfield with a cut', () => {
  // a 4 m deep, 10 m wide trench along x = 5, the rest untouched
  const trench = {
    detail: (x0: number, _z0: number, x1: number) => (x0 < 20 && x1 > -10 ? 10 : 0),
    cutAt: (x: number, _z: number, base: number) => (Math.abs(x - 5) < 5 ? base - 4 * (1 - Math.abs(x - 5) / 5) : base),
  };
  const world = makeWorld({ elev: EAST_SLOPE });

  it('is exactly as before without one', () => {
    const plain = new Heightfield(world);
    const again = new Heightfield(world, {});
    for (const [x, z] of [
      [-37, 12],
      [3, -44],
      [25, 25],
    ])
      expect(again.heightAt(x, z)).toBe(plain.heightAt(x, z));
    expect(plain.refinedCells).toBe(0);
  });

  it('reads the cut on the refined grid, and the plain grid elsewhere', () => {
    const plain = new Heightfield(world);
    const cut = new Heightfield(world, { cut: trench });
    expect(cut.refinedCells).toBe(2); // the two cells from x = 0 to 50 the trench runs through, along z
    expect(cut.heightAt(5, -25)).toBeCloseTo(plain.heightAt(5, -25) - 4, 5);
    expect(cut.heightAt(5, 25)).toBeCloseTo(plain.heightAt(5, 25) - 4, 5);
    expect(cut.heightAt(30, 10)).toBeCloseTo(plain.heightAt(30, 10), 5);
    expect(cut.heightAt(-30, 10)).toBe(plain.heightAt(-30, 10));
  });

  it('doubles the cut with the exaggeration', () => {
    const cut = new Heightfield(world, { cut: trench });
    const doubled = new Heightfield(world, { cut: trench, exaggeration: 2 });
    expect(doubled.heightAt(5, 10)).toBeCloseTo(cut.heightAt(5, 10) * 2, 5);
  });

  it('keeps a refined edge shared with a plain cell straight, so the mesh has no crack', () => {
    const cut = new Heightfield(world, { cut: trench });
    const plain = new Heightfield(world);
    // the edge at x = 0 is shared with the plain cell to the west: the trench reaches it, but the edge stays straight
    for (let z = -50; z <= 50; z += 5) expect(cut.heightAt(0.0001, z)).toBeCloseTo(plain.heightAt(0, z), 3);
  });
});
