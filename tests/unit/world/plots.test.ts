import { describe, expect, it } from 'vitest';
import { BuildingIndex } from '../../../src/world/buildings';
import { type Building, BuildingKind, LandUse, type Road, RoadClass, RoadUse } from '../../../src/world/data';
import { houseFronts } from '../../../src/world/furniture/houses';
import { Heightfield } from '../../../src/world/heightfield';
import { layoutPlots, type Plot } from '../../../src/world/plots';
import { pointInPolygon, polygonBounds, segmentDistance } from '../../../src/world/polygon';
import { RoadNetwork } from '../../../src/world/roads';
import { makeWorld, square } from './fixture';

// An eastbound street along z = 0 from x = -200 to 200: south (+z) is its right. Plots start 5 m from its centre line.
const STREET: Road = { c: RoadClass.STREET, n: 'Villagatan', p: [-200, 0, 200, 0], i: 1 };
const FRONT_M = 5;
const house = (x: number, z: number, side = 10, depth = side): Building => ({
  p: [x, z, x + side, z, x + side, z + depth, x, z + depth],
  h: 5,
  k: BuildingKind.OTHER,
});

function plots(b: Building[], r: Road[] = [STREET], extra: Parameters<typeof makeWorld>[0] = {}) {
  const data = makeWorld({ size: 1000, b, r, ...extra });
  const roads = new RoadNetwork(data, new Heightfield(data));
  const fronts = houseFronts(data, roads, () => true);
  return layoutPlots({ data, roads, buildings: new BuildingIndex(data), fronts, frontEdgeM: () => FRONT_M });
}

const bounds = (p: Plot) => polygonBounds(p.outline);

describe('layoutPlots', () => {
  it('gives a house alone its full reach: to the sides, and back to the depth limit', () => {
    const [p] = plots([house(0, 10)]);
    expect(p).toMatchObject({ ri: 0, side: 1 });
    const b = bounds(p);
    expect(b.x0).toBeCloseTo(-12, 6);
    expect(b.x1).toBeCloseTo(22, 6);
    expect(b.z0).toBeCloseTo(FRONT_M, 6);
    expect(b.z1).toBeCloseTo(FRONT_M + 40, 6);
  });

  it('meets a neighbour halfway between their walls', () => {
    // walls at x = 10 and x = 16: the boundary falls at 13, to the step's precision
    const [a, b] = plots([house(0, 10), house(16, 10)]);
    expect(bounds(a).x1).toBeCloseTo(13, 0);
    expect(bounds(b).x0).toBeCloseTo(13, 0);
    expect(bounds(b).x0).toBeGreaterThanOrEqual(bounds(a).x1 - 0.01);
  });

  it('stops short of a road behind, a parking lot, and the edge of its residential area', () => {
    const back: Road = { c: RoadClass.STREET, n: 'Bakgatan', p: [-200, 40, 200, 40], i: 2 };
    expect(bounds(plots([house(0, 10)], [STREET, back])[0]).z1).toBeLessThanOrEqual(40 - 2.75 - 0.5 + 0.01);
    const lot = { i: 9, p: square(-50, 30, 100), k: 0 as const };
    expect(bounds(plots([house(0, 10)], [STREET], { pa: [lot] })[0]).z1).toBeLessThanOrEqual(30.01);
    const area = { k: LandUse.RESIDENTIAL, p: square(-5, 0, 30) };
    const b = bounds(plots([house(0, 10)], [STREET], { l: [area] })[0]);
    expect(b.x0).toBeGreaterThanOrEqual(-5.01);
    expect(b.z1).toBeLessThanOrEqual(30.01);
  });

  it('stops at a narrow path behind, even one that lies between two steps of the growing edge', () => {
    // a footpath at z = 32: the back edge grows from the house's back wall at z = 20 in 8 m steps, to 28 and then 36
    const path: Road = { c: RoadClass.PATH, n: '', p: [-200, 32, 200, 32], i: 2 };
    expect(bounds(plots([house(0, 10)], [STREET, path])[0]).z1).toBeLessThanOrEqual(32 - 0.75 - 0.5 + 0.01);
  });

  it('lets a shed join the plot, and keeps the plot off a big building behind', () => {
    expect(bounds(plots([house(0, 10), house(2, 25, 5)])[0]).z1).toBeCloseTo(FRONT_M + 40, 6); // 25 m²: joins
    // a 30 m × 20 m barn 16 m behind the house's back wall: halfway would be z = 28, but the plot's back corners,
    // 12 m out to the side of the house and 2 m past the barn's ends, are nearer the barn from z = 23.6
    const barn = house(-10, 36, 30, 20);
    expect(bounds(plots([house(0, 10), barn])[0]).z1).toBeCloseTo(23.6, 0);
  });

  it('gives a garage by a bigger house no plot of its own, and lets it join the plot of the house', () => {
    // a 12 m × 10 m house and a 6 m × 8 m garage 4 m from it: one plot, reaching past the garage as if it weren't there
    const [p, ...rest] = plots([house(0, 10, 12, 10), house(16, 10, 6, 8)]);
    expect(rest).toEqual([]);
    expect(bounds(p).x1).toBeCloseTo(24, 6); // the house's side at x = 12, plus SIDE_REACH_M
  });

  it('runs a driveway beside the house on the side with more room, from the carriageway to its middle', () => {
    // the neighbour on the left leaves 3 m of plot beside the house; the right has 12 m
    const [, p] = plots([house(-16, 10), house(0, 10)]);
    expect(p.driveway).toMatchObject({ source: 'inferred', widthM: 3.2 });
    const [x0, z0, x1, z1] = p.driveway!.p;
    expect(x0).toBeCloseTo(12, 6); // 0.4 m past the wall, plus half its width
    expect(x1).toBeCloseTo(12, 6);
    expect(z0).toBeCloseTo(2.75, 6);
    expect(z1).toBeCloseTo(15, 6);
  });

  it('runs it straight to the front when there is no room beside, and gives none at the carriageway', () => {
    const [, p] = plots([house(-12, 10), house(0, 10), house(12, 10)]);
    for (const [i, v] of [5, 2.75, 5, 10].entries()) expect(p.driveway!.p[i]).toBeCloseTo(v, 6);
    expect(plots([house(-10, 3), house(0, 3), house(10, 3)])[1].driveway).toBeNull();
  });

  it('keeps a mapped driveway, from the street', () => {
    const driveway: Road = { c: RoadClass.SERVICE, n: '', p: [15, 14, 15, 2.75], i: 2, s: RoadUse.DRIVEWAY };
    const [p] = plots([house(0, 10)], [STREET, driveway]);
    expect(p.driveway).toEqual({ p: [15, 2.75, 15, 14], widthM: 3.2, source: 'mapped' });
    expect(bounds(p).x1).toBeCloseTo(22, 6); // the driveway lies inside its plot, not across a boundary
  });

  it('follows a bend in the street, keeping its front edge off the street', () => {
    const bend: Road = { c: RoadClass.STREET, n: 'Krokgatan', p: [-200, 0, 0, 0, 0, 200], i: 1 };
    // a house in the inside of the bend, 5 m from the eastbound leg and 8 m from the southbound one
    const [p] = plots([house(-18, 5, 10)], [bend]);
    expect(pointInPolygon(p.outline, -13, 10)).toBe(true);
    for (let i = 0; i < p.outline.length; i += 2) {
      const [x, z] = [p.outline[i], p.outline[i + 1]];
      expect(Math.min(segmentDistance(x, z, -200, 0, 0, 0), segmentDistance(x, z, 0, 0, 0, 200))).toBeGreaterThan(
        FRONT_M - 0.01,
      );
    }
  });

  it('is the same whatever order the houses come in', () => {
    const a = plots([house(0, 10), house(16, 10), house(-20, -25)]);
    const b = plots([house(-20, -25), house(16, 10), house(0, 10)]);
    const byKey = (ps: Plot[]) => new Map(ps.map(p => [p.key, p.outline.map(v => v.toFixed(6))]));
    expect(byKey(b)).toEqual(byKey(a));
  });
});
