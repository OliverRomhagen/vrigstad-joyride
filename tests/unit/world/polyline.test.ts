import { describe, expect, it } from 'vitest';
import {
  arcLengths,
  MITRE_LIMIT,
  mitreAt,
  pointAtArc,
  polylineLength,
  resample,
  ribbonEdges,
} from '../../../src/world/polyline';
import type { Point } from '../../../src/world/roads';

describe('resample', () => {
  it('keeps every vertex and cuts spans to at most the step', () => {
    const q = resample(
      [
        [0, 0],
        [13, 0],
        [13, 5],
      ],
      6,
    );
    expect(q).toEqual([
      [0, 0],
      [13 / 3, 0],
      [26 / 3, 0],
      [13, 0],
      [13, 5],
    ]);
    expect(polylineLength(q)).toBeCloseTo(18, 9);
  });
});

describe('ribbonEdges', () => {
  it('offsets half the width to each side, left of the direction first', () => {
    // heading east (+x): left is north (-z)
    expect(
      ribbonEdges(
        [
          [0, 0],
          [10, 0],
        ],
        0,
        4,
      ),
    ).toEqual({ lx: 0, lz: -2, rx: 0, rz: 2 });
  });
});

describe('mitreAt', () => {
  it('is the plain normal on a straight', () => {
    const m = mitreAt(
      [
        [0, 0],
        [5, 0],
        [10, 0],
      ],
      1,
    );
    expect([m.nx, m.nz, m.scale]).toEqual([-0, 1, 1]);
  });

  it('scales by 1 / cos(half the turn) in a bend, so the strip keeps its width', () => {
    // a right-angle turn from east to south: the right offset point lands on both offset lines
    const q: Point[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    const m = mitreAt(q, 1);
    expect(m.scale).toBeCloseTo(Math.SQRT2, 9);
    const d = 2;
    const x = 10 + m.nx * d * m.scale;
    const z = 0 + m.nz * d * m.scale;
    expect(z).toBeCloseTo(d, 9); // 2 m right of the eastbound leg
    expect(x).toBeCloseTo(10 - d, 9); // 2 m right of the southbound leg
  });

  it('gives NaN past the mitre limit, where the strip is split', () => {
    expect(
      mitreAt(
        [
          [0, 0],
          [10, 0],
          [0, 1],
        ],
        1,
      ).scale,
    ).toBeNaN();
    expect(1 / Math.cos(Math.PI / 3)).toBeLessThanOrEqual(MITRE_LIMIT); // a 120° turn is still mitred
  });
});

describe('arcLengths and pointAtArc', () => {
  const q: [number, number][] = [
    [0, 0],
    [3, 4],
    [3, 10],
  ];
  it('measures each vertex from the start, and finds a point and its tangent along the line', () => {
    const arcs = arcLengths(q);
    expect(arcs).toEqual([0, 5, 11]);
    expect(pointAtArc(q, arcs, 2.5)).toEqual({ x: 1.5, z: 2, tx: 0.6, tz: 0.8 });
    expect(pointAtArc(q, arcs, 8)).toMatchObject({ x: 3, z: 7, tx: 0, tz: 1 });
    expect(pointAtArc(q, arcs, -1)).toMatchObject({ x: 0, z: 0 }); // clamped to the ends
    expect(pointAtArc(q, arcs, 99)).toMatchObject({ x: 3, z: 10 });
  });
});
