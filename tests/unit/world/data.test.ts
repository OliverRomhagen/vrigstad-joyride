import { describe, expect, it } from 'vitest';
import data from '../../../data/vrigstad.json';
import {
  BuildingKind,
  CrossingKind,
  Kerb,
  LandUse,
  ParkingKind,
  ParkingOrientation,
  ROAD_WIDTH_M,
  RoadClass,
  RoadUse,
  SideState,
  StreetParking,
  Surface,
  WaterwayKind,
  type WorldData,
} from '../../../src/world/data';

// The pages import the JSON without type checks, so this is what holds tools/process.py to WorldData.
const codes = (kinds: Record<string, number>) => new Set(Object.values(kinds));

describe('data/vrigstad.json', () => {
  it('has a full elevation grid', () => {
    expect(data.elev).toHaveLength(data.n * data.n);
  });

  it('uses only the class codes data.ts names', () => {
    const roadClasses = codes(RoadClass);
    for (const r of data.r) expect(roadClasses).toContain(r.c);
    const buildingKinds = codes(BuildingKind);
    for (const b of data.b) expect(buildingKinds).toContain(b.k);
    const waterwayKinds = codes(WaterwayKind);
    for (const w of data.ww) expect(waterwayKinds).toContain(w.k);
    const landUses = codes(LandUse);
    for (const l of data.l) expect(landUses).toContain(l.k);
    for (const l of data.labels) expect(['p', 'w']).toContain(l.k);
  });

  it('has a width for every road class', () => {
    expect(ROAD_WIDTH_M).toHaveLength(Object.keys(RoadClass).length);
  });

  it('gives every ridge five numbers', () => {
    for (const b of data.b) if ('g' in b) expect(b.g).toHaveLength(5);
  });

  it('uses only the streetscape codes data.ts names', () => {
    // the optional fields are absent from the JSON's inferred type when the snapshot has none, so read it as WorldData
    const w = data as unknown as WorldData;
    const pair = (v: number[] | undefined, kinds: Record<string, number>) => {
      if (!v) return;
      expect(v).toHaveLength(2);
      for (const c of v) expect(codes(kinds)).toContain(c);
    };
    const ids = new Set<string>();
    for (const r of w.r) {
      expect(Number.isInteger(r.i)).toBe(true);
      const id = r.i + ':' + (r.j ?? '');
      expect(ids).not.toContain(id);
      ids.add(id);
      if (r.s !== undefined) expect(codes(RoadUse)).toContain(r.s);
      if (r.sf !== undefined) expect(codes(Surface)).toContain(r.sf);
      if (r.w !== undefined) expect(r.w).toBeGreaterThan(0);
      pair(r.sw, SideState);
      pair(r.ssf, Surface);
      pair(r.pk, StreetParking);
      pair(r.po, ParkingOrientation);
      if (r.sww) for (const v of r.sww) expect(v === 0 || (v >= 0.8 && v <= 6)).toBe(true);
    }
    for (const a of w.pa ?? []) {
      expect(codes(ParkingKind)).toContain(a.k);
      if (a.sf !== undefined) expect(codes(Surface)).toContain(a.sf);
      expect(a.p.length).toBeGreaterThanOrEqual(6);
    }
    for (const x of w.x ?? []) {
      expect(codes(CrossingKind)).toContain(x.k);
      if (x.kb !== undefined) expect(codes(Kerb)).toContain(x.kb);
      if (x.r !== undefined) expect(w.r[x.r].p[(x.v ?? -1) * 2]).toBe(x.x);
    }
    for (const k of w.kb ?? []) expect(codes(Kerb)).toContain(k.kb);
    expect((w.t ?? []).length % 2).toBe(0);
  });
});
