import { describe, expect, it } from 'vitest';
import { type Building, BuildingKind, type Road, RoadClass, RoadUse } from '../../../../src/world/data';
import { houseFronts } from '../../../../src/world/furniture/houses';
import { Heightfield } from '../../../../src/world/heightfield';
import { RoadNetwork } from '../../../../src/world/roads';
import { makeWorld, square } from '../fixture';

// An eastbound street along z = 0 from x = -200 to 200: south (+z) is its right.
const STREET: Road = { c: RoadClass.STREET, n: 'Villagatan', p: [-200, 0, 200, 0], i: 1 };
const house = (x: number, z: number, side = 10, k: BuildingKind = BuildingKind.OTHER): Building => ({
  p: square(x, z, side),
  h: 5,
  k,
});

function fronts(b: Building[], r: Road[] = [STREET], eligible = (_ri: number) => true) {
  const data = makeWorld({ size: 1000, b, r });
  return houseFronts(data, new RoadNetwork(data, new Heightfield(data)), eligible);
}

describe('houseFronts', () => {
  it('ties a house to its street: the side it is on and how far along, opposite its middle', () => {
    const [south, north] = fronts([house(10, 15), house(60, -25)]);
    expect(south).toMatchObject({ ri: 0, side: 1, atDriveway: false });
    expect(south.alongM).toBeCloseTo(215, 6); // x = 15 is 215 m from the street's start
    expect(north).toMatchObject({ side: -1 });
    expect(north.alongM).toBeCloseTo(265, 6);
  });

  it('skips sheds, big buildings, the church, houses too far away, and streets that are not eligible', () => {
    expect(
      fronts([house(0, 10, 4), house(0, 10, 25), house(0, 10, 10, BuildingKind.CHURCH), house(0, 40, 10)]),
    ).toEqual([]);
    expect(fronts([house(0, 10)], [STREET], () => false)).toEqual([]);
  });

  it('moves the front to where a mapped driveway from the street meets it', () => {
    const driveway: Road = { c: RoadClass.SERVICE, n: '', p: [30, 2.75, 30, 14], i: 2, s: RoadUse.DRIVEWAY };
    const [f] = fronts([house(10, 15)], [STREET, driveway]);
    expect(f.atDriveway).toBe(true);
    expect(f.alongM).toBeCloseTo(230, 6);
  });

  it('gives a driveway two houses reach to the one its end is nearer, not to both', () => {
    // the driveway ends 7.8 m from the first house's middle (15, 20) and 20.9 m from the second's (30, 20): both within reach
    const driveway: Road = { c: RoadClass.SERVICE, n: '', p: [10, 2.75, 10, 14], i: 2, s: RoadUse.DRIVEWAY };
    const [own, neighbour] = fronts([house(10, 15), house(25, 15)], [STREET, driveway]);
    expect(own).toMatchObject({ atDriveway: true });
    expect(own.alongM).toBeCloseTo(210, 6);
    expect(neighbour).toMatchObject({ atDriveway: false });
    expect(neighbour.alongM).toBeCloseTo(230, 6); // opposite its own middle
  });

  it('keys a house by where it stands, not by data order', () => {
    const a = fronts([house(10, 15), house(60, 15)]).map(f => f.key);
    const b = fronts([house(60, 15), house(10, 15)]).map(f => f.key);
    expect(new Set(a)).toEqual(new Set(b));
  });
});
