import { describe, expect, it } from 'vitest';
import { RoadClass, ROAD_WIDTH_M } from '../../../src/world/data';
import { nodeKey, RoadNetwork, roadLiftM } from '../../../src/world/roads';
import { makeWorld } from './fixture';

const terrainAt = (heightM: number) => ({ heightAt: () => heightM });
// a primary road along z = 0, from x = -40 to 40
const MAIN_ROAD = { c: RoadClass.PRIMARY, n: 'Storgatan', p: [-40, 0, 40, 0] };
const HALF_WIDTH_M = ROAD_WIDTH_M[RoadClass.PRIMARY] / 2;

describe('nearestRoad', () => {
  const roads = new RoadNetwork(makeWorld({ r: [MAIN_ROAD] }), terrainAt(0));

  it('is negative on the road and measures from its edge', () => {
    expect(roads.nearestRoad(0, 0)).toEqual({ d: -HALF_WIDTH_M, ri: 0 });
    expect(roads.nearestRoad(0, 10).d).toBeCloseTo(10 - HALF_WIDTH_M);
  });

  it('finds no road in a cell the road does not reach', () => {
    expect(roads.nearestRoad(0, 60)).toEqual({ d: 1e9, ri: -1 });
  });

  it('returns the same object each call', () => {
    expect(roads.nearestRoad(0, 0)).toBe(roads.nearestRoad(5, 5));
  });

  it('writes into the object it is given, and leaves the shared one alone', () => {
    const shared = roads.nearestRoad(0, 10);
    const own = { d: 0, ri: 0 };
    expect(roads.nearestRoad(0, 60, own)).toBe(own);
    expect(own).toEqual({ d: 1e9, ri: -1 });
    expect(shared.ri).toBe(0);
  });
});

describe('groundAt', () => {
  const TERRAIN_M = 3;
  // a street crossing the main road at x = 0
  const CROSS_STREET = { c: RoadClass.STREET, n: '', p: [0, -40, 0, 40] };
  const roads = new RoadNetwork(makeWorld({ r: [MAIN_ROAD, CROSS_STREET] }), terrainAt(TERRAIN_M));

  it('puts things on top of the road ribbon, lower for smaller roads', () => {
    expect(roadLiftM(RoadClass.PRIMARY)).toBeCloseTo(0.25);
    expect(roadLiftM(RoadClass.STREET)).toBeCloseTo(0.19);
    expect(roads.groundAt(20, 0)).toBeCloseTo(TERRAIN_M + 0.25);
    expect(roads.groundAt(0, 20)).toBeCloseTo(TERRAIN_M + 0.19);
  });

  it('takes the highest ribbon where roads overlap', () => {
    expect(roads.groundAt(0, 0)).toBeCloseTo(TERRAIN_M + 0.25);
  });

  it('eases the ribbon out over the metre past the kerb', () => {
    expect(roads.groundAt(20, HALF_WIDTH_M + 0.5)).toBeCloseTo(TERRAIN_M + 0.125);
    expect(roads.groundAt(20, HALF_WIDTH_M + 1)).toBe(TERRAIN_M);
  });
});

describe('junctions', () => {
  const streets = [
    { c: RoadClass.STREET, n: '', p: [-40, 0, 0, 0] },
    { c: RoadClass.STREET, n: '', p: [0, 0, 0, 40] },
    { c: RoadClass.PATH, n: '', p: [0, 0, 20, 20] },
  ];
  const roads = new RoadNetwork(makeWorld({ r: streets }), terrainAt(0));

  it('joins roads that share a vertex, as road and vertex index pairs', () => {
    expect(roads.junctions.get(nodeKey([0, 0]))).toEqual([0, 1, 1, 0]);
  });

  it('leaves paths out of the driving network', () => {
    expect(roads.driveable).toEqual([0, 1]);
  });
});
