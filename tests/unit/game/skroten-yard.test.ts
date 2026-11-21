import { describe, expect, it } from 'vitest';
import { NISSE_UV, RING_UV, YARD, yardLayout, yardToWorld } from '../../../src/game/skroten-yard';
import { pointInPolygon, segmentDistance } from '../../../src/world/polygon';

// how far (u, v) of the yard's frame is from the nearest outline you collide with; 0 inside one
function clearance(outlines: number[][], u: number, v: number) {
  const { x, z } = yardToWorld(u, v);
  let best = 1e9;
  for (const p of outlines) {
    if (pointInPolygon(p, x, z)) return 0;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2)
      best = Math.min(best, segmentDistance(x, z, p[j], p[j + 1], p[i], p[i + 1]));
  }
  return best;
}

describe('Skroten yard', () => {
  it('is laid out the same on every load', () => {
    expect(yardLayout()).toEqual(yardLayout());
    expect(yardLayout().wrecks.length).toBeGreaterThan(20);
  });

  it('turns the frame without stretching it: u runs along the road, v into the yard, both in metres', () => {
    const o = yardToWorld(0, 0),
      a = yardToWorld(10, 0),
      b = yardToWorld(0, 10);
    expect(Math.hypot(a.x - o.x, a.z - o.z)).toBeCloseTo(10, 2);
    expect(Math.hypot(b.x - o.x, b.z - o.z)).toBeCloseTo(10, 2);
    expect(b.z).toBeGreaterThan(o.z); // into the yard is southwards, away from Stockarydsvägen
  });

  it('leaves the drive from the road through the gate to the ring clear for a car', () => {
    const { outlines } = yardLayout();
    for (let v = -5; v <= RING_UV.v + 4; v += 0.5) expect(clearance(outlines, RING_UV.u, v)).toBeGreaterThan(1.6); // a car's collision radius is 1.5 m
    expect(YARD.gateHalf).toBeGreaterThan(4);
  });

  it('puts Skrot-Nisse beside the ring, not on it', () => {
    const d = Math.hypot(NISSE_UV.u - RING_UV.u, NISSE_UV.v - RING_UV.v);
    expect(d).toBeGreaterThan(5.5); // the ring for a car is 3.75 m across its middle
    expect(d).toBeLessThan(9);
  });
});
