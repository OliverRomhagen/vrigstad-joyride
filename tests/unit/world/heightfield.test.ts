import { describe, expect, it } from 'vitest';
import { Heightfield } from '../../../src/world/heightfield';
import { makeWorld } from './fixture';

// rises 1 m every 50 m eastwards: decimetres per column 0, 10, 20
const EAST_SLOPE = [0, 10, 20, 0, 10, 20, 0, 10, 20];
// flat but for the far corner of the cell from (0, 0) to (50, 50), raised 10 m
const ONE_CORNER = [0, 0, 0, 0, 0, 0, 0, 0, 100];

describe('heightAt', () => {
  it('reads the samples at grid points, in metres above the lowest', () => {
    const field = new Heightfield(makeWorld({ elev: EAST_SLOPE.map((e) => e + 500) }));
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

  it('averages the four corners when bilinear', () => {
    const field = new Heightfield(makeWorld({ elev: ONE_CORNER }), { interpolation: 'bilinear' });
    expect(field.heightAt(25, 25)).toBeCloseTo(2.5);
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
    const field = new Heightfield(makeWorld({ elev: EAST_SLOPE.map((e) => e + 500) }), { exaggeration: 2 });
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
  // heights where the two interpolations' sums round differently in the last bit, as real data does
  const UNEVEN = [1001, 1234, 1587, 1102, 1999, 1313, 1050, 1234, 1587];

  it('matches heightAt exactly at the samples, for both interpolations', () => {
    for (const interpolation of ['triangle', 'bilinear'] as const) {
      const field = new Heightfield(makeWorld({ elev: UNEVEN }), { exaggeration: 2, interpolation });
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) expect(field.sampleHeight(i, j)).toBe(field.heightAt(-50 + 50 * i, -50 + 50 * j));
    }
  });

  it('works out each interpolation its own way, so the map keeps its vertices', () => {
    const triangle = new Heightfield(makeWorld({ elev: UNEVEN }));
    const bilinear = new Heightfield(makeWorld({ elev: UNEVEN }), { interpolation: 'bilinear' });
    expect(triangle.sampleHeight(1, 0)).toBe((1234 - 1001) / 10);
    expect(bilinear.sampleHeight(1, 0)).toBe(1234 / 10 - 1001 / 10);
    expect(triangle.sampleHeight(1, 0)).not.toBe(bilinear.sampleHeight(1, 0));
  });

  it('reads the last row and column', () => {
    const field = new Heightfield(makeWorld({ elev: EAST_SLOPE }));
    expect(field.sampleHeight(2, 2)).toBeCloseTo(2);
  });
});

describe('sampleCoord', () => {
  it('puts the samples where heightAt reads them, from edge to edge', () => {
    const field = new Heightfield(makeWorld({ elev: EAST_SLOPE }));
    expect([0, 1, 2].map((i) => field.sampleCoord(i))).toEqual([-50, 0, 50]);
    for (let i = 0; i < 3; i++) expect(field.heightAt(field.sampleCoord(i), 0)).toBeCloseTo(field.sampleHeight(i, 1));
  });
});
