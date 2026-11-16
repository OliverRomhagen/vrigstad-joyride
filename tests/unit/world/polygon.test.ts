import { describe, expect, it } from 'vitest';
import { pointInPolygon, polygonArea, polygonBounds, segmentDistance, segmentParam } from '../../../src/world/polygon';
import { square } from './fixture';

// an L: a 10 m square with its north-east quarter cut out
const L_SHAPE = [0, 0, 10, 0, 10, 5, 5, 5, 5, 10, 0, 10];

describe('pointInPolygon', () => {
  it('handles a concave outline', () => {
    expect(pointInPolygon(L_SHAPE, 2, 2)).toBe(true);
    expect(pointInPolygon(L_SHAPE, 2, 8)).toBe(true);
    expect(pointInPolygon(L_SHAPE, 8, 8)).toBe(false);
  });
});

describe('segmentDistance', () => {
  it('measures to the nearest point of the segment, ends included', () => {
    expect(segmentDistance(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(segmentDistance(13, 4, 0, 0, 10, 0)).toBe(5);
  });

  it('treats a segment of zero length as a point', () => {
    expect(segmentDistance(3, 4, 0, 0, 0, 0)).toBe(5);
  });
});

describe('segmentParam', () => {
  it('runs from 0 at the start to 1 at the end, clamped past either', () => {
    expect(segmentParam(5, 3, 0, 0, 10, 0)).toBe(0.5);
    expect(segmentParam(-4, 0, 0, 0, 10, 0)).toBe(0);
    expect(segmentParam(13, 4, 0, 0, 10, 0)).toBe(1);
  });

  it('is 0 on a segment of zero length', () => {
    expect(segmentParam(3, 4, 0, 0, 0, 0)).toBe(0);
  });
});

describe('polygonBounds', () => {
  it('boxes the outline', () => {
    expect(polygonBounds(L_SHAPE)).toEqual({ x0: 0, x1: 10, z0: 0, z1: 10 });
  });

  it('grows the box it is given', () => {
    const box = polygonBounds(square(0, 0, 4));
    expect(polygonBounds(square(-2, 6, 1), box)).toBe(box);
    expect(box).toEqual({ x0: -2, x1: 4, z0: 0, z1: 7 });
  });
});

describe('polygonArea', () => {
  it('is positive whichever way the outline winds', () => {
    const sq = square(0, 0, 4);
    const reversed: number[] = [];
    for (let i = sq.length - 2; i >= 0; i -= 2) reversed.push(sq[i], sq[i + 1]);
    expect(polygonArea(sq)).toBe(16);
    expect(polygonArea(reversed)).toBe(16);
    expect(polygonArea(L_SHAPE)).toBe(75);
  });
});
