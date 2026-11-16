import { describe, expect, it } from 'vitest';
import { BuildingKind } from '../../../src/world/data';
import { BuildingIndex } from '../../../src/world/buildings';
import { pointInPolygon } from '../../../src/world/polygon';
import { makeWorld, square } from './fixture';

const HOUSE = square(0, 0, 10);
const indexWithHouse = () => new BuildingIndex(makeWorld({ b: [{ p: HOUSE, h: 5, k: BuildingKind.OTHER }] }));

describe('collide', () => {
  it('leaves a circle clear of every wall alone', () => {
    const o = { x: 12, z: 5 };
    expect(indexWithHouse().collide(o, 1)).toBe(false);
    expect(o).toEqual({ x: 12, z: 5 });
  });

  it('leaves a circle alone that is inside the bounds but clear of the corner', () => {
    const o = { x: 11, z: 11 };
    expect(indexWithHouse().collide(o, 1.2)).toBe(false);
    expect(o).toEqual({ x: 11, z: 11 });
  });

  it('pushes a circle that overlaps a wall out to touch it', () => {
    const o = { x: 10.5, z: 5 };
    expect(indexWithHouse().collide(o, 1)).toBe(true);
    expect(o.x).toBeCloseTo(11);
    expect(o.z).toBeCloseTo(5);
  });

  it('pushes a circle inside a footprint out through the nearest wall', () => {
    const o = { x: 9, z: 5 };
    expect(indexWithHouse().collide(o, 0.5)).toBe(true);
    expect(o.x).toBeCloseTo(10.5);
    expect(pointInPolygon(HOUSE, o.x, o.z)).toBe(false);
  });
});

describe('addFootprint', () => {
  it('adds an outline after the data, which things then collide with', () => {
    const index = indexWithHouse();
    expect(index.addFootprint(square(30, 30, 3))).toBe(1);
    expect(index.footprints[1]).toMatchObject({ x0: 30, x1: 33, z0: 30, z1: 33 });
    expect(index.collide({ x: 31.5, z: 34 }, 1.5)).toBe(true);
  });

  it('files an outline in every cell its bounds touch', () => {
    const index = new BuildingIndex(makeWorld());
    index.addFootprint(square(38, 38, 4));   // straddles the cell corner at (40, 40)
    // each circle overlaps one corner of the outline and stays inside a single 40 m cell, so it only finds it through that cell
    for (const [x, z] of [[37.5, 37.5], [42.5, 37.5], [37.5, 42.5], [42.5, 42.5]]) expect(index.collide({ x, z }, 1)).toBe(true);
  });
});
