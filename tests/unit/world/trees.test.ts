import { describe, expect, it } from 'vitest';
import { LandUse } from '../../../src/world/data';
import { makeRnd } from '../../../src/world/random';
import { treeSpots } from '../../../src/world/trees';
import { makeWorld, square } from './fixture';

// a wood that is the triangle filling half of a 40 m square, and a field beside it
const WOOD = [-40, -20, 0, -20, -40, 20];
const inWood = (x: number, z: number) => x >= -40 && z >= -20 && x + z <= -20;
const WORLD = makeWorld({ l: [{ k: LandUse.FOREST, p: WOOD }, { k: LandUse.FARMLAND, p: square(0, -20, 40) }] });
/** how many numbers a run with `kept` spots drew: two per try, 100 tries, and one per kept spot */
const drawn = (kept: number) => 200 + kept;
const OPTIONS = { squareMetresPerTry: 16, minScale: 0.7, scaleSpread: 0.8 };

describe('treeSpots', () => {
  it('tries once per area of the bounding box, and keeps only the spots inside the wood', () => {
    const spots = treeSpots(WORLD, makeRnd(1), OPTIONS);
    const kept = spots.length / 3;
    expect(kept).toBeGreaterThan(30);
    expect(kept).toBeLessThan(70);
    for (let i = 0; i < spots.length; i += 3) {
      expect(inWood(spots[i], spots[i + 1])).toBe(true);
      expect(spots[i + 2]).toBeGreaterThanOrEqual(0.7);
      expect(spots[i + 2]).toBeLessThan(1.5);
    }
  });

  it('draws two numbers a try and a third for a kept spot, so the stream after it is predictable', () => {
    const rnd = makeRnd(1);
    const kept = treeSpots(WORLD, rnd, OPTIONS).length / 3;
    const expected = makeRnd(1);
    for (let i = 0; i < drawn(kept); i++) expected();
    expect(rnd()).toBe(expected());
  });

  it('gives the same spots from the same seed', () => {
    expect(treeSpots(WORLD, makeRnd(7), OPTIONS)).toEqual(treeSpots(WORLD, makeRnd(7), OPTIONS));
  });

  it('keeps spots clear of roads, and rolls no scale for a dropped one', () => {
    // a road whose edge runs along x = -30
    const roads = { nearestRoad: (x: number) => ({ d: Math.abs(x + 30), ri: 0 }) };
    const rnd = makeRnd(1);
    const spots = treeSpots(WORLD, rnd, { ...OPTIONS, roads, roadClearanceM: 5 });
    const kept = spots.length / 3;
    for (let i = 0; i < spots.length; i += 3) expect(Math.abs(spots[i] + 30)).toBeGreaterThan(5);
    expect(kept).toBeLessThan(treeSpots(WORLD, makeRnd(1), OPTIONS).length / 3);
    const expected = makeRnd(1);
    for (let i = 0; i < drawn(kept); i++) expected();
    expect(rnd()).toBe(expected());
  });
});
