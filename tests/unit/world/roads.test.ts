import { describe, expect, it } from 'vitest';
import { RoadClass, ROAD_WIDTH_M } from '../../../src/world/data';
import { createRoads, roadLiftM } from '../../../src/world/roads';
import { makeWorld } from './fixture';

const flat = () => 0;
// a primary road along z = 0, from x = -40 to 40
const MAIN_ROAD = { c: RoadClass.PRIMARY, n: 'Storgatan', p: [-40, 0, 40, 0] };
const HALF_WIDTH_M = ROAD_WIDTH_M[RoadClass.PRIMARY] / 2;

describe('nearestRoad', () => {
  const { nearestRoad } = createRoads(makeWorld({ r: [MAIN_ROAD] }), flat);

  it('is negative on the road and measures from its edge', () => {
    expect(nearestRoad(0, 0)).toEqual({ d: -HALF_WIDTH_M, ri: 0 });
    expect(nearestRoad(0, 10).d).toBeCloseTo(10 - HALF_WIDTH_M);
  });

  it('finds no road in a cell the road does not reach', () => {
    expect(nearestRoad(0, 60)).toEqual({ d: 1e9, ri: -1 });
  });

  it('returns the same object each call', () => {
    expect(nearestRoad(0, 0)).toBe(nearestRoad(5, 5));
  });

  it('writes into the object it is given, and leaves the shared one alone', () => {
    const shared = nearestRoad(0, 10);
    const own = { d: 0, ri: 0 };
    expect(nearestRoad(0, 60, own)).toBe(own);
    expect(own).toEqual({ d: 1e9, ri: -1 });
    expect(shared.ri).toBe(0);
  });
});

describe('groundAt', () => {
  const TERRAIN_M = 3;
  // a street crossing the main road at x = 0
  const CROSS_STREET = { c: RoadClass.STREET, n: '', p: [0, -40, 0, 40] };
  const { groundAt } = createRoads(makeWorld({ r: [MAIN_ROAD, CROSS_STREET] }), () => TERRAIN_M);

  it('puts things on top of the road ribbon, lower for smaller roads', () => {
    expect(roadLiftM(RoadClass.PRIMARY)).toBeCloseTo(0.25);
    expect(roadLiftM(RoadClass.STREET)).toBeCloseTo(0.19);
    expect(groundAt(20, 0)).toBeCloseTo(TERRAIN_M + 0.25);
    expect(groundAt(0, 20)).toBeCloseTo(TERRAIN_M + 0.19);
  });

  it('takes the highest ribbon where roads overlap', () => {
    expect(groundAt(0, 0)).toBeCloseTo(TERRAIN_M + 0.25);
  });

  it('eases the ribbon out over the metre past the kerb', () => {
    expect(groundAt(20, HALF_WIDTH_M + 0.5)).toBeCloseTo(TERRAIN_M + 0.125);
    expect(groundAt(20, HALF_WIDTH_M + 1)).toBe(TERRAIN_M);
  });
});

describe('junctions', () => {
  const streets = [
    { c: RoadClass.STREET, n: '', p: [-40, 0, 0, 0] },
    { c: RoadClass.STREET, n: '', p: [0, 0, 0, 40] },
    { c: RoadClass.PATH, n: '', p: [0, 0, 20, 20] },
  ];
  const { junctions, nodeKey, driveable } = createRoads(makeWorld({ r: streets }), flat);

  it('joins roads that share a vertex, as road and vertex index pairs', () => {
    expect(junctions.get(nodeKey([0, 0]))).toEqual([0, 1, 1, 0]);
  });

  it('leaves paths out of the driving network', () => {
    expect(driveable).toEqual([0, 1]);
  });
});
