import { describe, expect, it } from 'vitest';
import { pointInPolygon, polygonArea, segmentDistance } from '../../../src/world/polygon';
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
