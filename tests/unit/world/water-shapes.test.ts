import { describe, expect, it } from 'vitest';
import { BuildingKind, RoadClass, WaterwayKind } from '../../../src/world/data';
import { Heightfield } from '../../../src/world/heightfield';
import { courseLevels, RIVER_HALF_WIDTH_M, STREAM_HALF_WIDTH_M, WaterBodies } from '../../../src/world/water-shapes';
import { makeValley, square } from './fixture';

// a river along z = 0 from west to east, downhill, as OSM draws it
const RIVER = { k: WaterwayKind.RIVER, p: [-180, 0, 180, 0] };
const build = (world = makeValley({ ww: [RIVER] })) => {
  const base = new Heightfield(world);
  return { world, base, bodies: new WaterBodies(world, base) };
};

describe('courseLevels', () => {
  const s = Array.from({ length: 50 }, (_, k) => k * 2);
  const none = s.map(() => Number.NaN);

  it('never rises above the target, and climbs slowly where the ground does', () => {
    const target = s.map(v => (v < 40 ? 5 - v * 0.01 : 4.6 + (v - 40) * 0.05)); // falls, then a bump in the ground
    const level = courseLevels(target, s, none);
    for (let k = 0; k < s.length; k++) expect(level[k]).toBeLessThanOrEqual(target[k] + 1e-12);
    for (let k = 1; k < s.length; k++) expect(level[k] - level[k - 1]).toBeLessThanOrEqual(0.015 * 2 + 1e-12);
    expect(level[49]).toBeLessThan(target[49] - 1); // cut through the bump rather than following it up
  });

  it('holds a lake level inside the lake, and falls to meet it gently before', () => {
    const target = s.map(() => 5);
    const lake = s.map((_, k) => (k >= 30 ? 3 : Number.NaN));
    const level = courseLevels(target, s, lake);
    for (let k = 30; k < 50; k++) expect(level[k]).toBe(3);
    for (let k = 1; k < 31; k++) expect(level[k - 1] - level[k]).toBeLessThanOrEqual(0.02 * 2 + 1e-12);
    expect(level[29]).toBeCloseTo(3 + 0.02 * 2);
  });
});

describe('WaterBodies: a river', () => {
  const { base, bodies } = build();
  const [course] = bodies.courses;

  it('runs downstream with a level below both banks, and never steps', () => {
    expect(course.s[course.s.length - 1]).toBeCloseTo(360);
    for (let k = 0; k < course.x.length; k++) {
      expect(base.heightAt(course.x[k], course.z[k]) - course.level[k]).toBeGreaterThanOrEqual(1 - 1e-9);
      if (k) expect(Math.abs(course.level[k] - course.level[k - 1])).toBeLessThan(0.05);
    }
  });

  it('takes the shared half width, wandering a little', () => {
    for (const h of course.half) expect(Math.abs(h / RIVER_HALF_WIDTH_M - 1)).toBeLessThanOrEqual(0.12 + 1e-9);
  });

  it('cuts a bed under the water and banks up to the untouched ground', () => {
    const x = 10;
    const p = { course: 0, d: 0, s: 0, level: 0, half: 0, slope: 0, bed: 0 };
    bodies.nearestCourse(x, 0, p);
    const cut = (z: number) => bodies.cutAt(x, z, base.heightAt(x, z));
    expect(cut(0)).toBeCloseTo(p.level - p.bed, 5);
    expect(cut(p.half)).toBeCloseTo(p.level, 1);
    // the bank rises steadily from the waterline to the ground
    let last = cut(p.half);
    for (let z = p.half + 0.5; z < p.half + 12; z += 0.5) {
      const h = cut(z);
      expect(h).toBeGreaterThanOrEqual(last - 1e-9);
      expect(h).toBeLessThanOrEqual(base.heightAt(x, z) + 1e-9);
      last = h;
    }
    expect(last).toBeCloseTo(base.heightAt(x, p.half + 11.5), 6);
  });

  it('leaves the ground alone past the banks', () => {
    for (const z of [-40, -16, 16, 40, 120])
      for (const x of [-150, -60, 0, 60, 150])
        expect(bodies.cutAt(x, z, base.heightAt(x, z))).toBe(base.heightAt(x, z));
  });

  it('is wet over the water and dry beside it', () => {
    expect(bodies.levelAt(0, 1)).toBeCloseTo(course.level[90], 1);
    expect(bodies.levelAt(0, 6)).toBeNaN();
  });

  it('is the same every time it is built', () => {
    const again = build().bodies.courses[0];
    expect(Array.from(again.level)).toEqual(Array.from(course.level));
    expect(Array.from(again.half)).toEqual(Array.from(course.half));
  });
});

describe('WaterBodies: what the channel keeps away from', () => {
  const road = { c: RoadClass.SECONDARY, n: 'Bron', p: [20, -60, 20, 60] };
  const house = { p: square(-60, 6, 10), h: 6, k: BuildingKind.OTHER };
  const { base, bodies } = build(makeValley({ ww: [RIVER], r: [road], b: [house] }));
  const cut = (x: number, z: number) => bodies.cutAt(x, z, base.heightAt(x, z));

  it('keeps a road crossing the river at its height, across its width and sidewalks', () => {
    for (const x of [20, 20 - 3.75, 20 + 3.75, 20 + 6]) expect(cut(x, 0)).toBe(base.heightAt(x, 0));
    expect(cut(40, 0)).toBeLessThan(base.heightAt(40, 0) - 1);
  });

  it('keeps a building and the ground round it as they were', () => {
    for (const [x, z] of [
      [-55, 11],
      [-60, 6],
      [-50, 6],
      [-55, 5],
    ])
      expect(cut(x, z)).toBe(base.heightAt(x, z));
  });
});

describe('WaterBodies: a bridge over the river (#238)', () => {
  // a street along x = 20 that crosses the river on a 30 m bridge from z = -15 to 15
  const roads = [
    { c: RoadClass.STREET, n: '', p: [20, -60, 20, -15], i: 1 },
    { c: RoadClass.STREET, n: '', p: [20, -15, 20, 15], i: 2, br: { l: 1 } },
    { c: RoadClass.STREET, n: '', p: [20, 15, 20, 60], i: 3 },
  ];
  const { base, bodies } = build(makeValley({ ww: [RIVER], r: roads }));
  const cut = (x: number, z: number) => bodies.cutAt(x, z, base.heightAt(x, z));

  it('cuts the channel on under the deck, and keeps the approaches to their ends', () => {
    expect(cut(20, 0)).toBeLessThan(base.heightAt(20, 0) - 1);
    for (const z of [-15, -20, 15, 20])
      for (const x of [20 - 3.75, 20, 20 + 3.75]) expect(cut(x, z)).toBe(base.heightAt(x, z));
  });

  it('leaves the ground under the abutment seats, then eases into the bank, rather than rounding the road ends', () => {
    expect(cut(20, -14)).toBe(base.heightAt(20, -14));
    expect(cut(20, -5)).toBeLessThan(base.heightAt(20, -5) - 0.01);
  });
});

describe('WaterBodies: flow direction', () => {
  it('turns a waterway drawn uphill to run downhill', () => {
    const { base, bodies } = build(makeValley({ ww: [{ k: WaterwayKind.RIVER, p: [180, 0, -180, 0] }] }));
    const c = bodies.courses[0];
    expect(base.heightAt(c.x[0], c.z[0])).toBeGreaterThan(base.heightAt(c.x[c.x.length - 1], c.z[c.z.length - 1]));
  });

  it('gives a stream its narrower width', () => {
    const { bodies } = build(makeValley({ ww: [{ k: WaterwayKind.STREAM, p: [-180, 50, 180, 50] }] }));
    for (const h of bodies.courses[0].half) expect(h).toBeLessThan(STREAM_HALF_WIDTH_M * 1.13);
  });
});

describe('WaterBodies: a lake with an island', () => {
  const lake = [square(-100, -100, 120), square(-60, -60, 40)];
  // a river flowing into it from the east
  const inflow = { k: WaterwayKind.RIVER, p: [180, -80, 0, -80] };
  const { base, bodies } = build(makeValley({ w: [lake], ww: [inflow] }));
  const [l] = bodies.lakes;
  const cut = (x: number, z: number) => bodies.cutAt(x, z, base.heightAt(x, z));

  it('is level, below its shore and no higher than the river flowing in', () => {
    const shoreLow = Math.min(...[-100, -40, 20].map(x => base.heightAt(x, -100)));
    expect(l.level).toBeLessThanOrEqual(shoreLow);
    const c = bodies.courses[0];
    const inlet = Array.from(c.lake).indexOf(0);
    expect(c.level[inlet]).toBe(l.level);
    expect(c.level[inlet - 1] - l.level).toBeLessThanOrEqual(0.02 * 2 + 1e-9);
  });

  it('lies under the water inside, rises to the shore, and leaves the island dry', () => {
    expect(cut(-80, -80)).toBeLessThan(l.level);
    expect(cut(0, -10)).toBeLessThan(l.level);
    expect(cut(-100, -20)).toBeGreaterThan(l.level); // on the shore
    expect(cut(-40, -40)).toBeGreaterThan(l.level); // the island's middle
    expect(bodies.levelAt(-80, -80)).toBe(l.level);
    expect(bodies.levelAt(-40, -40)).toBeNaN();
  });

  it('measures the shore from the waterline, a little inside the mapped shore', () => {
    expect(bodies.lakeShoreDistance(-90, -20)).toBeCloseTo(10 - 0.1 / 0.35, 5);
    expect(bodies.lakeShoreDistance(-110, -20)).toBeLessThan(0);
    expect(bodies.lakeShoreDistance(-40, -80)).toBe(Infinity);
  });
});
