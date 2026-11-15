import { describe, expect, it } from 'vitest';
import { WaterwayKind } from '../../../src/world/data';
import { Water } from '../../../src/world/water';
import { makeWorld, square } from './fixture';

const LAKE_WITH_ISLAND = [square(-20, -20, 40), square(-5, -5, 10)];
const NO_ROADS = { nearestRoad: () => ({ d: 1e9, ri: -1 }) };
// a road 5.5 m wide along z = 15, across the lake
const BRIDGE_AT_Z15 = { nearestRoad: (_x: number, z: number) => ({ d: Math.abs(z - 15) - 2.75, ri: 0 }) };

describe('inWater', () => {
  const water = new Water(makeWorld({ w: [LAKE_WITH_ISLAND] }), BRIDGE_AT_Z15);

  it('is true on a lake and false beside it', () => {
    expect(water.inWater(-12, -12)).toBe(true);
    expect(water.inWater(30, 0)).toBe(false);
  });

  it('is false on an island', () => {
    expect(water.inWater(0, 0)).toBe(false);
  });

  it('is false on a bridge, and on the metre past its edge', () => {
    expect(water.inWater(-12, 15)).toBe(false);
    expect(water.inWater(-12, 15 + 2.75 + 0.9)).toBe(false);
    expect(water.inWater(-12, 15 + 2.75 + 1.1)).toBe(true);
  });

  it('counts a river by its width, and not a stream', () => {
    const rivers = new Water(
      makeWorld({
        ww: [
          { k: WaterwayKind.RIVER, p: [-40, 30, 40, 30] },
          { k: WaterwayKind.STREAM, p: [-40, -30, 40, -30] },
        ],
      }),
      NO_ROADS,
    );
    expect(rivers.inWater(0, 32)).toBe(true);
    expect(rivers.inWater(0, 33)).toBe(false);
    expect(rivers.inWater(0, -30)).toBe(false);
  });
});
