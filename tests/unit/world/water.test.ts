import { describe, expect, it } from 'vitest';
import { RoadClass, WaterwayKind } from '../../../src/world/data';
import { createRoads } from '../../../src/world/roads';
import { createWater } from '../../../src/world/water';
import { makeWorld, square } from './fixture';

const LAKE_WITH_ISLAND = [square(-20, -20, 40), square(-5, -5, 10)];
const BRIDGE = { c: RoadClass.STREET, n: '', p: [-30, 15, 30, 15] };

function waterOf(overrides: Parameters<typeof makeWorld>[0]) {
  const world = makeWorld(overrides);
  return createWater(world, createRoads(world, () => 0).nearestRoad).inWater;
}

describe('inWater', () => {
  const inWater = waterOf({ w: [LAKE_WITH_ISLAND], r: [BRIDGE] });

  it('is true on a lake and false beside it', () => {
    expect(inWater(-12, -12)).toBe(true);
    expect(inWater(30, 0)).toBe(false);
  });

  it('is false on an island', () => {
    expect(inWater(0, 0)).toBe(false);
  });

  it('is false on a bridge', () => {
    expect(inWater(-12, 15)).toBe(false);
  });

  it('counts a river by its width, and not a stream', () => {
    const inRiver = waterOf({
      ww: [
        { k: WaterwayKind.RIVER, p: [-40, 30, 40, 30] },
        { k: WaterwayKind.STREAM, p: [-40, -30, 40, -30] },
      ],
    });
    expect(inRiver(0, 32)).toBe(true);
    expect(inRiver(0, 33)).toBe(false);
    expect(inRiver(0, -30)).toBe(false);
  });
});
