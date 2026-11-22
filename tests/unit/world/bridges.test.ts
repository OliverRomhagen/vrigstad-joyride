import { describe, expect, it } from 'vitest';
import data from '../../../data/vrigstad.json';
import { archetypeOf, BridgeIndex, crest, WALKWAY_CURB_M } from '../../../src/world/bridges';
import { RoadClass, type WorldData } from '../../../src/world/data';
import { Heightfield } from '../../../src/world/heightfield';
import { RoadNetwork, roadLiftM } from '../../../src/world/roads';
import { makeWorld } from './fixture';

// a terrain sloping 2 % to the east, so heights tell the deck from the ground
const sloped = { heightAt: (x: number) => 10 + 0.02 * x };
// a primary road along z = 0: approach, a 20 m bridge from x = -10 to 10, approach
const roadWorld = makeWorld({
  r: [
    { c: RoadClass.PRIMARY, n: '', p: [-40, 0, -10, 0], i: 1 },
    { c: RoadClass.PRIMARY, n: '', p: [-10, 0, 10, 0], i: 7, br: { l: 1 } },
    { c: RoadClass.PRIMARY, n: '', p: [10, 0, 40, 0], i: 2 },
  ],
});

describe('BridgeIndex on a fixture', () => {
  const index = new BridgeIndex(roadWorld, sloped);
  const [b] = index.bridges;

  it('finds the bridge from its tag only, as a road slab', () => {
    expect(index.bridges).toHaveLength(1);
    expect(b).toMatchObject({ key: 'b7', roads: [1], archetype: 'road-slab', spanM: 20, carriageM: 9 });
    expect(index.bridgeOf(0)).toBeUndefined();
  });

  it('meets the approaches exactly and crests in the middle within the grade limit', () => {
    const lift = roadLiftM(RoadClass.PRIMARY);
    for (const x of [-10, 10]) expect(index.ribbonHeight(1, x, 4.5, lift)).toBe(sloped.heightAt(x) + lift);
    expect(b.riseM).toBeCloseTo(Math.min(0.3, (0.05 * 20) / 4));
    expect(index.deckAt(0, 0)).toBeCloseTo(sloped.heightAt(0) + lift + b.riseM);
    // the steepest grade of 4·rise·t(1 − t) is at the ends: 4·rise / span
    expect((4 * b.riseM) / b.spanM).toBeLessThanOrEqual(0.05 + 1e-12);
  });

  it('puts the walkways a curb above the carriageway, and is nothing past the deck', () => {
    const lift = roadLiftM(RoadClass.PRIMARY);
    expect(index.deckAt(0, 5.5)).toBeCloseTo(sloped.heightAt(0) + lift + b.riseM + WALKWAY_CURB_M);
    expect(index.deckAt(0, -5.5)).toBeCloseTo(sloped.heightAt(0) + lift + b.riseM + WALKWAY_CURB_M);
    expect(index.deckAt(0, b.halfWidthM + 0.1)).toBeNull();
    expect(index.deckAt(-10.1, 0)).toBeNull();
    expect(index.deckAt(10.1, 0)).toBeNull();
    expect(index.onDeck(3, 2)).toBe(true);
  });

  it('leaves other roads to the terrain', () => {
    expect(index.ribbonHeight(0, -20, 0, 0.25)).toBeUndefined();
    expect(index.walkOffsetM(0)).toBeUndefined();
    expect(index.walkOffsetM(1)).toBeCloseTo(4.5 + 2.15 / 2);
  });
});

describe('grouping and archetypes', () => {
  it('joins pieces that share an end, whichever way they run, but not across a class or layer change', () => {
    const w = makeWorld({
      r: [
        { c: RoadClass.PATH, n: '', p: [0, 0, 5, 0], i: 30, br: {} },
        { c: RoadClass.PATH, n: '', p: [12, 0, 5, 0], i: 20, br: {} }, // reversed, shares (5, 0)
        { c: RoadClass.PATH, n: '', p: [12, 0, 15, 0], i: 40, br: { l: 2 } }, // another layer
        { c: RoadClass.STREET, n: '', p: [0, 0, 0, -5], i: 50, br: {} }, // another class
      ],
    });
    const index = new BridgeIndex(w, { heightAt: () => 0 });
    expect(index.bridges.map(b => [b.key, b.roads, b.spanM])).toEqual([
      ['b20', [0, 1], 12],
      ['b40', [2], 3],
      ['b50', [3], 5],
    ]);
    expect(index.bridges[0].p).toEqual([
      [0, 0],
      [5, 0],
      [12, 0],
    ]);
  });

  it('picks the structure by function and span', () => {
    expect(archetypeOf(RoadClass.SERVICE, false, 5)).toBe('road-slab');
    expect(archetypeOf(RoadClass.PATH, true, 5)).toBe('path-steel');
    expect(archetypeOf(RoadClass.PATH, false, 13)).toBe('path-steel');
    expect(archetypeOf(RoadClass.PATH, false, 7)).toBe('path-timber');
  });

  it('crests only between the ends', () => {
    expect(crest(0.3, 0)).toBe(0);
    expect(crest(0.3, 1)).toBe(0);
    expect(crest(0.3, 0.5)).toBeCloseTo(0.3);
    expect(crest(0.3, -0.2)).toBe(0);
  });

  it('is the same whatever order the data lists the pieces in', () => {
    const r = [...roadWorld.r].reverse();
    const a = new BridgeIndex(roadWorld, sloped).bridges.map(b => [b.key, b.p]);
    const b = new BridgeIndex(makeWorld({ r }), sloped).bridges.map(b => [b.key, b.p]);
    expect(b).toEqual(a);
  });
});

describe('the six mapped bridges (data/vrigstad.json)', () => {
  const D = data as unknown as WorldData;
  const index = new BridgeIndex(D, new Heightfield(D));

  it('are six bridges with the archetypes #238 lists', () => {
    expect(index.bridges.map(b => [b.key, b.archetype, Math.round(b.spanM)])).toEqual([
      ['b48174896', 'road-slab', 25],
      ['b48401500', 'path-steel', 8],
      ['b48401503', 'path-steel', 9],
      ['b48401511', 'path-steel', 17],
      ['b57834128', 'path-timber', 7],
      ['b58102458', 'path-steel', 14],
    ]);
  });

  it('keep every deck within its grade limit, and the road deck under Jönköpingsvägen', () => {
    for (const b of index.bridges)
      expect((4 * b.riseM) / b.spanM).toBeLessThanOrEqual((b.archetype === 'road-slab' ? 0.05 : 0.08) + 1e-12);
    expect(index.onDeck(-33.9, -8.4)).toBe(true);
    expect(index.deckAt(-33.9, -8.4)).toBeGreaterThan(new Heightfield(D).heightAt(-33.9, -8.4));
  });

  it('give groundAt no step from the approach onto the deck and off again', () => {
    const roads = new RoadNetwork(D, new Heightfield(D), index);
    for (const b of index.bridges) {
      const [a, z] = [b.p[0], b.p[b.p.length - 1]];
      const [dx, dz] = [(z[0] - a[0]) / b.spanM, (z[1] - a[1]) / b.spanM];
      let last = Number.NaN;
      // along the centre line, from 5 m before the bridge to 5 m past it, every 10 cm
      for (let s = -5; s <= b.spanM + 5; s += 0.1) {
        const g = roads.groundAt(a[0] + dx * s, a[1] + dz * s);
        // at most the 6 cm between two classes' ribbon lifts, which b58102458 has where a driveway meets its footway,
        // as every driveway-to-footway joint off the bridges already does
        if (!Number.isNaN(last)) expect(Math.abs(g - last)).toBeLessThan(0.065);
        last = g;
      }
    }
  });
});
