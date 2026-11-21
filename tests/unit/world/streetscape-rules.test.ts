import { describe, expect, it } from 'vitest';
import { BuildingIndex } from '../../../src/world/buildings';
import {
  type Building,
  LandUse,
  type Road,
  RoadClass,
  RoadUse,
  SideState,
  StreetParking,
  Surface,
  type WorldData,
} from '../../../src/world/data';
import { RoadNetwork } from '../../../src/world/roads';
import {
  classifyStreetscape,
  SIDEWALK_CENTRE_M,
  SIDEWALK_RESIDENTIAL_M,
  sideSpecOf,
  VERGE_M,
} from '../../../src/world/streetscape-rules';
import { makeWorld, square } from './fixture';

const flat = { heightAt: () => 0 };
const house = (x: number, z: number): Building => ({ p: square(x, z, 8), h: 5, k: 0 });
// an eastbound street along z = 0, 100 m long; its left is north (-z), its right south (+z)
const street = (extra: Partial<Road> = {}): Road => ({
  c: RoadClass.STREET,
  n: 'Gatan',
  p: [-50, 0, 50, 0],
  i: 1,
  ...extra,
});
const TORGET = { t: 'Torget', x: 0, z: 0, k: 'p' };

function classify(world: Partial<WorldData>, overrides = {}) {
  const data = makeWorld({ size: 400, ...world });
  return classifyStreetscape(data, new RoadNetwork(data, flat), new BuildingIndex(data), overrides);
}

// five houses north and five south of the street: 10 per 100 m, the centre near Torget
const rowOfHouses = (z: number) => [-45, -25, -5, 15, 35].map(x => house(x, z));
const centreHouses = [...rowOfHouses(-20), ...rowOfHouses(12)];

describe('classifyStreetscape: explicit tags', () => {
  it('takes mapped sides as mapped, with the mapped width', () => {
    const [s] = classify({
      r: [street({ sw: [SideState.PRESENT, SideState.ABSENT], sww: [2.5, 0], ssf: [Surface.CONCRETE, 0] })],
    });
    expect(s.left).toMatchObject({ sidewalk: 'present', widthM: 2.5, surface: Surface.CONCRETE, source: 'mapped' });
    expect(s.right).toMatchObject({ sidewalk: 'absent', widthM: 0, curbM: 0, source: 'mapped' });
  });

  it('fills an unspecific sidewalk tag from defaults and calls it derived', () => {
    const [s] = classify({ r: [street({ sw: [SideState.PRESENT, SideState.PRESENT] })] });
    expect(s.left).toMatchObject({ sidewalk: 'present', widthM: SIDEWALK_RESIDENTIAL_M, source: 'derived' });
  });

  it('lets explicit absence beat inference, even in the centre', () => {
    const [s] = classify({
      r: [street({ sw: [SideState.ABSENT, SideState.UNKNOWN] })],
      b: centreHouses,
      labels: [TORGET],
    });
    expect(s.profile).toBe('centre');
    expect(s.left).toMatchObject({ sidewalk: 'absent', source: 'mapped' });
    expect(s.right).toMatchObject({ sidewalk: 'present', source: 'inferred' });
  });

  it('keeps a missing tag apart from "no": unknown is inferred, never mapped', () => {
    const [s] = classify({ r: [street()] });
    expect(s.profile).toBe('outskirts');
    expect(s.left).toMatchObject({ sidewalk: 'absent', source: 'inferred' });
  });

  it('passes street parking through per side', () => {
    const [s] = classify({ r: [street({ pk: [StreetParking.UNKNOWN, StreetParking.LANE] })] });
    expect(s.right.parking).toBe(StreetParking.LANE);
    expect(s.left.parking).toBe(StreetParking.UNKNOWN);
  });
});

describe('classifyStreetscape: separately mapped sidewalks', () => {
  const sidewalkNorth: Road = { c: RoadClass.PATH, n: '', p: [-50, -6, 50, -6], s: RoadUse.SIDEWALK, i: 2 };

  it('does not draw a sidewalk where a separate one runs alongside', () => {
    const [s] = classify({ r: [street(), sidewalkNorth], b: centreHouses, labels: [TORGET] });
    expect(s.left).toMatchObject({ sidewalk: 'separate', source: 'derived', widthM: 0 });
    expect(s.right).toMatchObject({ sidewalk: 'present', source: 'inferred' });
  });

  it('marks only the stretch the separate sidewalk covers', () => {
    const half: Road = { ...sidewalkNorth, p: [-50, -6, 0, -6] };
    const [s] = classify({ r: [street(), half], b: centreHouses, labels: [TORGET] });
    expect(s.left.sidewalk).toBe('present');
    const cover = Array.from(s.left.separate!);
    expect(cover[0]).toBe(1);
    expect(cover[cover.length - 1]).toBe(0);
  });

  it('ignores a footway that crosses rather than runs alongside', () => {
    const across: Road = { ...sidewalkNorth, p: [0, -30, 0, -1] };
    const [s] = classify({ r: [street(), across], b: centreHouses, labels: [TORGET] });
    expect(s.left.separate).toBeNull();
  });
});

describe('classifyStreetscape: profiles', () => {
  it('gives the centre a 2 m sidewalk on both sides', () => {
    const [s] = classify({ r: [street()], b: centreHouses, labels: [TORGET] });
    expect(s.profile).toBe('centre');
    for (const side of [s.left, s.right])
      expect(side).toMatchObject({
        sidewalk: 'present',
        widthM: SIDEWALK_CENTRE_M,
        surface: Surface.PAVING,
        source: 'inferred',
      });
  });

  it('is residential, not centre, far from Torget', () => {
    const [s] = classify({ r: [street()], b: centreHouses, labels: [{ ...TORGET, x: 900 }] });
    expect(s.profile).toBe('residential');
  });

  it('puts the residential sidewalk on the side with more houses', () => {
    // three houses south (right), none north
    const [s] = classify({ r: [street()], b: [house(-30, 12), house(0, 12), house(30, 12)] });
    expect(s.profile).toBe('residential');
    expect(s.right).toMatchObject({
      sidewalk: 'present',
      widthM: SIDEWALK_RESIDENTIAL_M,
      surface: Surface.ASPHALT,
      source: 'inferred',
    });
    expect(s.left.sidewalk).toBe('absent');
  });

  it('counts a residential land-use polygon as built-up', () => {
    const [s] = classify({ r: [street()], l: [{ k: LandUse.RESIDENTIAL, p: square(-100, -100, 200) }] });
    expect(s.profile).toBe('residential');
  });

  it('gives a primary road in the countryside no pavement', () => {
    const [s] = classify({ r: [street({ c: RoadClass.PRIMARY })] });
    expect(s.profile).toBe('outskirts');
    expect([s.left.sidewalk, s.right.sidewalk]).toEqual(['absent', 'absent']);
  });

  it('infers nothing on driveways, service roads or footways', () => {
    const out = classify({
      r: [street({ c: RoadClass.SERVICE, s: RoadUse.DRIVEWAY }), street({ c: RoadClass.PATH, i: 3 })],
      b: centreHouses,
      labels: [TORGET],
    });
    for (const s of out) expect([s.left.sidewalk, s.right.sidewalk]).toEqual(['absent', 'absent']);
  });

  it('gives verges to about 40 % of residential streets, by way id', () => {
    const roads = Array.from({ length: 200 }, (_, k) => street({ i: 1000 + k }));
    const out = classify({ r: roads, l: [{ k: LandUse.RESIDENTIAL, p: square(-100, -100, 200) }] });
    const withVerge = out.filter(s => s.left.vergeM === VERGE_M || s.right.vergeM === VERGE_M).length;
    expect(withVerge / out.length).toBeGreaterThan(0.3);
    expect(withVerge / out.length).toBeLessThan(0.5);
    expect(out.every(s => s.streetTrees === s.left.vergeM + s.right.vergeM > 0)).toBe(true);
  });
});

describe('classifyStreetscape: determinism and overrides', () => {
  it('follows the way id, not the order of the data', () => {
    const other = street({ i: 9, p: [-50, 30, 50, 30] });
    const tie = street({ i: 77 }); // no houses: a tie, decided by the hash
    const land = [{ k: LandUse.RESIDENTIAL, p: square(-100, -100, 200) }];
    const a = classify({ r: [tie, other], l: land })[0];
    const b = classify({ r: [other, tie], l: land })[1];
    expect(b).toEqual(a);
  });

  it('applies an override by way id; a cited survey makes it mapped', () => {
    const [s] = classify(
      { r: [street()] },
      { 1: { sidewalk: { left: 'present' }, sidewalkWidthM: 3, note: 'survey 2026-08-01' } },
    );
    expect(s.left).toMatchObject({ sidewalk: 'present', widthM: 3, source: 'mapped' });
    const [t] = classify({ r: [street()] }, { 1: { profile: 'centre', note: 'looks like the centre on a photo' } });
    expect(t.profile).toBe('centre');
    const [u] = classify({ r: [street()] }, { 1: { sidewalk: { right: 'present' }, note: 'photo, June 2026' } });
    expect(u.right.source).toBe('derived');
  });
});

describe('sideSpecOf', () => {
  it('reads the left side for -1 and the right for +1', () => {
    const [sides] = classifyStreetscape(
      makeWorld({ r: [{ c: RoadClass.STREET, n: '', p: [-40, 0, 40, 0], sw: [SideState.PRESENT, SideState.ABSENT] }] }),
      new RoadNetwork(makeWorld({ r: [{ c: RoadClass.STREET, n: '', p: [-40, 0, 40, 0] }] }), { heightAt: () => 0 }),
      new BuildingIndex(makeWorld()),
    );
    expect(sideSpecOf(sides, -1)).toBe(sides.left);
    expect(sideSpecOf(sides, 1)).toBe(sides.right);
  });
});
