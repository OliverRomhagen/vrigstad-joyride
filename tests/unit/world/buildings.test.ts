import { describe, expect, it } from 'vitest';
import { BuildingKind } from '../../../src/world/data';
import { BuildingIndex, forEachBuilding, roofParts } from '../../../src/world/buildings';
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

describe('roofParts', () => {
  const outline = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 6 },
    { x: 0, z: 6 },
  ];

  it('gives a flat roof one face at the wall top', () => {
    const { ring, yAt, sides } = roofParts(outline, undefined, 4);
    expect(ring).toBe(outline);
    expect(sides).toEqual([outline]);
    expect(yAt({ x: 5, z: 3 })).toBe(4);
  });

  it('cuts the outline where it crosses the ridge, and rises to it', () => {
    // a ridge along z = 3, over a roof 3 m wide each side
    const { ring, yAt, sides } = roofParts(outline, [0, 3, 10, 3, 3], 4);
    expect(ring).toHaveLength(6);
    expect(ring).toContainEqual({ x: 10, z: 3 });
    expect(ring).toContainEqual({ x: 0, z: 3 });
    expect(sides).toHaveLength(2);
    for (const side of sides) expect(side).toHaveLength(4);
    expect(yAt({ x: 10, z: 3 })).toBeCloseTo(4 + 2.1);
    expect(yAt({ x: 0, z: 0 })).toBeCloseTo(4);
  });

  it('caps how high a wide roof rises', () => {
    const wide = outline.map((v) => ({ x: v.x * 4, z: v.z * 4 }));
    expect(roofParts(wide, [0, 12, 40, 12, 12], 0).yAt({ x: 20, z: 12 })).toBeCloseTo(5);
  });
});

describe('forEachBuilding', () => {
  // ground rises 1 m every 50 m eastwards
  const slope = { heightAt: (x: number) => (x + 50) / 50 };

  it('visits the buildings in data order, with walls from below the lowest corner to the height over the highest', () => {
    const world = makeWorld({
      b: [
        { p: square(0, 0, 10), h: 5, k: BuildingKind.OTHER },
        { p: square(-40, 0, 20), h: 8, k: BuildingKind.CHURCH, s: 12 },
      ],
    });
    const seen: { kind: number; lo: number; hi: number; base: number; top: number; area: number }[] = [];
    forEachBuilding(world, slope, ({ building, lo, hi, base, top, area }) => seen.push({ kind: building.k, lo, hi, base, top, area }));
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ kind: BuildingKind.OTHER, area: 100 });
    expect(seen[0].lo).toBeCloseTo(1);
    expect(seen[0].hi).toBeCloseTo(1.2);
    expect(seen[0].base).toBeCloseTo(0);
    expect(seen[0].top).toBeCloseTo(6.2);
    expect(seen[1]).toMatchObject({ kind: BuildingKind.CHURCH, area: 400 });
  });

  it('gives the winding, which flips with the outline', () => {
    const p = square(0, 0, 10);
    const reversed: number[] = [];
    for (let i = p.length - 2; i >= 0; i -= 2) reversed.push(p[i], p[i + 1]);
    const windings: number[] = [];
    forEachBuilding(makeWorld({ b: [{ p, h: 3, k: BuildingKind.OTHER }, { p: reversed, h: 3, k: BuildingKind.OTHER }] }), slope, (s) =>
      windings.push(s.winding),
    );
    expect(windings).toEqual([1, -1]);
  });
});
