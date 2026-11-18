import { describe, expect, it } from 'vitest';
import { MITRE_LIMIT, mitreAt, polylineLength, resample, ribbonEdges } from '../../../src/world/polyline';
import type { Point } from '../../../src/world/roads';

describe('resample', () => {
  it('keeps every vertex and cuts spans to at most the step', () => {
    const q = resample([[0, 0], [13, 0], [13, 5]], 6);
    expect(q).toEqual([[0, 0], [13 / 3, 0], [26 / 3, 0], [13, 0], [13, 5]]);
    expect(polylineLength(q)).toBeCloseTo(18, 9);
  });
});

describe('ribbonEdges', () => {
  it('offsets half the width to each side, left of the direction first', () => {
    // heading east (+x): left is north (-z)
    expect(ribbonEdges([[0, 0], [10, 0]], 0, 4)).toEqual({ lx: 0, lz: -2, rx: 0, rz: 2 });
  });
});

describe('mitreAt', () => {
  it('is the plain normal on a straight', () => {
    const m = mitreAt([[0, 0], [5, 0], [10, 0]], 1);
    expect([m.nx, m.nz, m.scale]).toEqual([-0, 1, 1]);
  });

  it('scales by 1 / cos(half the turn) in a bend, so the strip keeps its width', () => {
    // a right-angle turn from east to south: the right offset point lands on both offset lines
    const q: Point[] = [[0, 0], [10, 0], [10, 10]];
    const m = mitreAt(q, 1);
    expect(m.scale).toBeCloseTo(Math.SQRT2, 9);
    const d = 2;
    const x = 10 + m.nx * d * m.scale;
    const z = 0 + m.nz * d * m.scale;
    expect(z).toBeCloseTo(d, 9); // 2 m right of the eastbound leg
    expect(x).toBeCloseTo(10 - d, 9); // 2 m right of the southbound leg
  });

  it('gives NaN past the mitre limit, where the strip is split', () => {
    expect(mitreAt([[0, 0], [10, 0], [0, 1]], 1).scale).toBeNaN();
    expect(1 / Math.cos(Math.PI / 3)).toBeLessThanOrEqual(MITRE_LIMIT); // a 120° turn is still mitred
  });
});
