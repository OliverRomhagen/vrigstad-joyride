import { describe, expect, it } from 'vitest';
import { createHeightfield } from '../../../src/world/heightfield';
import { makeWorld } from './fixture';

// rises 1 m every 50 m eastwards: decimetres per column 0, 10, 20
const EAST_SLOPE = [0, 10, 20, 0, 10, 20, 0, 10, 20];
// flat but for the far corner of the cell from (0, 0) to (50, 50), raised 10 m
const ONE_CORNER = [0, 0, 0, 0, 0, 0, 0, 0, 100];

describe('heightAt', () => {
  it('reads the samples at grid points, in metres above the lowest', () => {
    const { heightAt } = createHeightfield(makeWorld({ elev: EAST_SLOPE.map((e) => e + 500) }));
    expect(heightAt(-50, 0)).toBeCloseTo(0);
    expect(heightAt(0, 0)).toBeCloseTo(1);
  });

  it('interpolates within a triangle', () => {
    const { heightAt } = createHeightfield(makeWorld({ elev: EAST_SLOPE }));
    expect(heightAt(25, 0)).toBeCloseTo(1.5);
  });

  it('follows the mesh triangles, so the diagonal of a cell is a crease', () => {
    const { heightAt } = createHeightfield(makeWorld({ elev: ONE_CORNER }));
    expect(heightAt(25, 25)).toBeCloseTo(0);
    expect(heightAt(30, 30)).toBeCloseTo(2);
  });

  it('averages the four corners when bilinear', () => {
    const { heightAt } = createHeightfield(makeWorld({ elev: ONE_CORNER }), { interpolation: 'bilinear' });
    expect(heightAt(25, 25)).toBeCloseTo(2.5);
  });

  it('reads the last row and column, and holds the edge height outside the world', () => {
    const { heightAt } = createHeightfield(makeWorld({ elev: EAST_SLOPE }));
    expect(heightAt(50, 0)).toBeCloseTo(2);
    expect(heightAt(50, 50)).toBeCloseTo(2);
    expect(heightAt(0, 50)).toBeCloseTo(1);
    expect(heightAt(1000, 0)).toBe(heightAt(50, 0));
    expect(heightAt(-1000, 0)).toBe(heightAt(-50, 0));
    expect(heightAt(0, 1000)).toBe(heightAt(0, 50));
  });

  it('scales by the exaggeration', () => {
    const plain = createHeightfield(makeWorld({ elev: EAST_SLOPE }));
    const doubled = createHeightfield(makeWorld({ elev: EAST_SLOPE }), { exaggeration: 2 });
    expect(doubled.heightAt(25, 0)).toBeCloseTo(plain.heightAt(25, 0) * 2);
  });

  it('reports the lowest and highest samples above sea level', () => {
    const field = createHeightfield(makeWorld({ elev: EAST_SLOPE.map((e) => e + 500) }), { exaggeration: 2 });
    expect(field.minElevationM).toBe(50);
    expect(field.maxElevationM).toBe(52);
  });
});

describe('normalAt', () => {
  it('points straight up on flat ground', () => {
    const { normalAt } = createHeightfield(makeWorld());
    expect(normalAt(10, 10, { x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('leans away from the uphill side, at unit length', () => {
    const { normalAt } = createHeightfield(makeWorld({ elev: EAST_SLOPE }));
    const n = normalAt(10, 10, { x: 0, y: 0, z: 0 });
    expect(n.x).toBeLessThan(0);
    expect(n.z).toBeCloseTo(0);
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1);
  });

  it('writes into the object it is given and returns it', () => {
    const { normalAt } = createHeightfield(makeWorld());
    const out = { x: 9, y: 9, z: 9 };
    expect(normalAt(0, 0, out)).toBe(out);
  });
});
