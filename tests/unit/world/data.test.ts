import { describe, expect, it } from 'vitest';
import data from '../../../data/vrigstad.json';
import { BuildingKind, LandUse, RoadClass, ROAD_WIDTH_M, WaterwayKind } from '../../../src/world/data';

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
});
