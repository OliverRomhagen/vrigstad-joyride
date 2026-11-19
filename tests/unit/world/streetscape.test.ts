import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BuildingIndex } from '../../../src/world/buildings';
import { CrossingKind, LandUse, ParkingKind, type Road, RoadClass, RoadUse, ROAD_WIDTH_M, SideState, Surface, type WorldData } from '../../../src/world/data';
import { Heightfield } from '../../../src/world/heightfield';
import { ParkingMesh, parkingSurfaces } from '../../../src/world/mesh/parking-mesh';
import { SidewalkMesh } from '../../../src/world/mesh/sidewalk-mesh';
import { polygonArea, segmentDistance } from '../../../src/world/polygon';
import { resample, ribbonEdges } from '../../../src/world/polyline';
import { RoadNetwork, roadLiftM } from '../../../src/world/roads';
import { buildStreetscape, CURB_TOP_M, cutToTerrain, LOWERED_CURB_M, Part, type Soup, StreetscapeIndex } from '../../../src/world/streetscape';
import { classifyStreetscape, CURB_RESIDENTIAL_M, SIDEWALK_RESIDENTIAL_M } from '../../../src/world/streetscape-rules';
import { makeWorld, square } from './fixture';

// A 400 m world with uneven ground: a 5 × 5 grid, samples 100 m apart, heights in decimetres, so nothing is planar.
const BUMPY = [0, 30, 5, 40, 10, 20, 0, 35, 15, 25, 5, 45, 10, 30, 0, 30, 10, 20, 0, 40, 15, 0, 25, 5, 20];
const both = [SideState.PRESENT, SideState.PRESENT] as [SideState, SideState];
const street = (p: number[], extra: Partial<Road> = {}): Road => ({ c: RoadClass.STREET, n: '', p, i: p.length * 1000 + p[0] * 7 + p[1], sw: both, ...extra });

function build(world: Partial<WorldData>, avoidTrees?: number[]) {
  const data = makeWorld({ size: 400, n: 5, elev: BUMPY, ...world });
  const heightfield = new Heightfield(data);
  const roads = new RoadNetwork(data, heightfield);
  const buildings = new BuildingIndex(data);
  const sides = classifyStreetscape(data, roads, buildings);
  const layout = buildStreetscape({ data, roads, heightfield, buildings, sides, avoidTrees, treeRoadClearanceM: 2.5 });
  return { data, heightfield, roads, buildings, layout };
}

/** each triangle of a soup as three [x, y, z] vertices, with its part */
function triangles(s: Soup) {
  const out: { v: number[][]; part: Part }[] = [];
  for (let t = 0; t < s.part.length; t++) {
    const o = t * 9;
    out.push({ v: [0, 3, 6].map((k) => [s.pos[o + k], s.pos[o + k + 1], s.pos[o + k + 2]]), part: s.part[t] });
  }
  return out;
}
const normal = (v: number[][]) => {
  const u = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
  const w = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
  return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
};
const centroid = (v: number[][]) => [0, 1, 2].map((k) => (v[0][k] + v[1][k] + v[2][k]) / 3);
const TOPS: Part[] = [Part.CURB_TOP, Part.VERGE, Part.SIDEWALK];

/** distance from (x, z) to the nearest carriageway's edge, negative inside one */
function carriagewayDistance(data: WorldData, x: number, z: number) {
  let best = Infinity;
  for (const r of data.r) {
    if (r.c > RoadClass.TRACK || r.s === RoadUse.SIDEWALK) continue;
    for (let i = 2; i < r.p.length; i += 2) best = Math.min(best, segmentDistance(x, z, r.p[i - 2], r.p[i - 1], r.p[i], r.p[i + 1]) - ROAD_WIDTH_M[r.c] / 2);
  }
  return best;
}

/** curb heights: for every pair of curb-face vertices at the same (x, z), top minus bottom */
function curbHeights(s: Soup) {
  const out: { x: number; z: number; h: number }[] = [];
  for (const { v, part } of triangles(s)) {
    if (part !== Part.CURB_FACE) continue;
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) if (a !== b && v[a][0] === v[b][0] && v[a][2] === v[b][2] && v[a][1] > v[b][1]) out.push({ x: v[a][0], z: v[a][2], h: v[a][1] - v[b][1] });
  }
  return out;
}

describe('buildStreetscape: cross-sections', () => {
  // a curving street on bumpy ground, sidewalks both sides
  const curve = [-150, 20, -80, 0, -20, -30, 40, -30, 120, 10];
  const { data, heightfield, layout } = build({ r: [street(curve)] });

  it('builds one strip a side, starting on the ribbon edge itself', () => {
    expect(layout.strips.map((s) => s.side).sort()).toEqual([-1, 1]);
    const q = resample(
      Array.from({ length: curve.length / 2 }, (_, i): [number, number] => [curve[i * 2], curve[i * 2 + 1]]),
      6,
    );
    const left = layout.strips.find((s) => s.side < 0)!;
    // every ribbon sample's left edge is a station of the strip, bit for bit
    const inner = new Set<string>();
    for (let i = 0; i < left.inner.length; i += 2) inner.add(left.inner[i] + ',' + left.inner[i + 1]);
    for (let i = 1; i < q.length - 1; i++) {
      const e = ribbonEdges(q, i, ROAD_WIDTH_M[RoadClass.STREET]);
      expect(inner.has(e.lx + ',' + e.lz)).toBe(true);
    }
  });

  it('keeps the curb exactly curbH above the road, away from the ramped ends', () => {
    const heights = curbHeights(layout.surface);
    expect(heights.length).toBeGreaterThan(40);
    const ends = [curve.slice(0, 2), curve.slice(-2)];
    for (const { x, z, h } of heights) {
      const nearEnd = ends.some(([ex, ez]) => Math.hypot(x - ex, z - ez) < 1.5 + ROAD_WIDTH_M[RoadClass.STREET]);
      if (nearEnd) expect(h).toBeLessThanOrEqual(CURB_RESIDENTIAL_M + 1e-9);
      else expect(h).toBeCloseTo(CURB_RESIDENTIAL_M, 9);
    }
  });

  it('puts the raised strip at heightAt + roadLift + curbH, following the slope', () => {
    const lift = roadLiftM(RoadClass.STREET);
    let checked = 0;
    for (const { v, part } of triangles(layout.surface)) {
      if (part !== Part.SIDEWALK) continue;
      for (const [x, y, z] of v) {
        const h = y - heightfield.heightAt(x, z) - lift;
        expect(h).toBeGreaterThan(LOWERED_CURB_M - 1e-9);
        expect(h).toBeLessThanOrEqual(CURB_RESIDENTIAL_M + 1e-9);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('ends a strip that has nowhere to go with a ramp down to a lowered curb', () => {
    const lowest = Math.min(...curbHeights(layout.surface).map((c) => c.h));
    expect(lowest).toBeCloseTo(LOWERED_CURB_M, 9);
  });

  it('winds every triangle outward and makes none degenerate', () => {
    for (const { v, part } of triangles(layout.surface)) {
      const n = normal(v);
      expect(Math.hypot(n[0], n[1], n[2])).toBeGreaterThan(1e-6);
      if (TOPS.includes(part)) expect(n[1]).toBeGreaterThan(0);
      if (part === Part.CURB_FACE) {
        // faces the road: towards lower carriageway distance
        const [x, , z] = centroid(v);
        const len = Math.hypot(n[0], n[2]);
        const ahead = carriagewayDistance(data, x + (n[0] / len) * 0.3, z + (n[2] / len) * 0.3);
        expect(ahead).toBeLessThan(carriagewayDistance(data, x, z));
      }
    }
  });

  it('has a sidewalk of the default width, outside the carriageway', () => {
    for (const { v, part } of triangles(layout.surface)) {
      if (!TOPS.includes(part)) continue;
      const [x, , z] = centroid(v);
      const d = carriagewayDistance(data, x, z);
      expect(d).toBeGreaterThan(-1e-6);
      expect(d).toBeLessThan(CURB_TOP_M + SIDEWALK_RESIDENTIAL_M + 0.6); // the mitre widens bends a little
    }
  });
});

describe('buildStreetscape: awkward coordinates', () => {
  it('finds every vertex even where resampling does not land on it to the last bit', () => {
    // 0.1 + (0.7 - 0.1) is not 0.7 in floating point: vertices must be found by step count, not by comparing coordinates
    const p = [0.1, 0.1, 0.7, 0.30000000000000004, 13.37, 2.9, 41.3, -7.7, 77.1, 0.3];
    const drive: Road = { c: RoadClass.SERVICE, n: '', p: [41.3, -7.7, 45, -40], s: RoadUse.DRIVEWAY, i: 3 };
    const { layout } = build({ r: [street(p), drive] });
    expect(layout.openings.filter((o) => o.kind === 'driveway')).toHaveLength(1);
    for (const v of layout.surface.pos) expect(Number.isFinite(v)).toBe(true);
    for (const o of layout.openings) expect(Number.isFinite(o.s)).toBe(true);
  });
});

/** every strip end that no corner continues ramps down to a lowered curb, so nothing stops as a sheer block */
function expectLooseEndsRamped(layout: ReturnType<typeof build>['layout']) {
  const cornerEnds = new Set(layout.corners.flatMap((c) => [c.inner.slice(0, 2).join(), c.inner.slice(-2).join()]));
  const heights = new Map(curbHeights(layout.surface).map((c) => [c.x + ',' + c.z, c.h]));
  let loose = 0;
  for (const s of layout.strips) {
    for (const end of [s.inner.slice(0, 2).join(), s.inner.slice(-2).join()]) {
      if (cornerEnds.has(end)) continue;
      loose++;
      expect(heights.get(end)).toBeCloseTo(LOWERED_CURB_M, 9);
    }
  }
  return loose;
}

describe('buildStreetscape: junctions', () => {
  it('ramps the strip down where a corner cannot be built because the other arm is blocked', () => {
    // a house on the stem's east side, from just past the main road's sidewalk to 20 m down: the stem's strip can't
    // reach its corner, while the main road's strip can
    const edge = ROAD_WIDTH_M[RoadClass.STREET] / 2;
    const house = [edge + 0.5, edge + 2, edge + 12, edge + 2, edge + 12, 20, edge + 0.5, 20];
    const { layout } = build({ r: [street([-150, 0, 0, 0, 150, 0]), street([0, 0, 0, 150])], b: [{ p: house, h: 5, k: 0 }] });
    expect(layout.corners).toHaveLength(1);
    expect(expectLooseEndsRamped(layout)).toBeGreaterThan(4);
  });

  it('fillets both corners of a T and keeps the straight side whole', () => {
    // main road west to east along z = 0 (one way); the stem runs south from its middle
    const { data, layout } = build({ r: [street([-150, 0, 0, 0, 150, 0]), street([0, 0, 0, 150])] });
    expect(layout.corners).toHaveLength(2);
    // the north side (the main road's left) runs straight through; the south side is split by the stem
    expect(layout.strips.filter((s) => s.ri === 0 && s.side < 0)).toHaveLength(1);
    expect(layout.strips.filter((s) => s.ri === 0 && s.side > 0)).toHaveLength(2);
    for (const { v, part } of triangles(layout.surface)) {
      if (!TOPS.includes(part)) continue;
      const [x, , z] = centroid(v);
      expect(carriagewayDistance(data, x, z)).toBeGreaterThan(0);
    }
    expectLooseEndsRamped(layout);
    // each corner's curve starts and ends on a strip end
    const ends = new Set(layout.strips.flatMap((s) => [s.inner.slice(0, 2).join(), s.inner.slice(-2).join()]));
    for (const c of layout.corners) {
      expect(ends.has(c.inner.slice(0, 2).join())).toBe(true);
      expect(ends.has(c.inner.slice(-2).join())).toBe(true);
    }
  });

  it('rounds a half junction into the street without a sidewalk, and ramps it down there', () => {
    // the stem runs south; its left (east, +x) side has no sidewalk
    const { data, layout } = build({ r: [street([-150, 0, 0, 0, 150, 0]), street([0, 0, 0, 150], { sw: [SideState.ABSENT, SideState.PRESENT] })] });
    expect(layout.corners).toHaveLength(2);
    const half = layout.corners.find((c) => c.inner[0] > 0 && c.inner[c.inner.length - 2] > 0)!;
    expect(half).toBeDefined();
    const heights = new Map(curbHeights(layout.surface).map((c) => [c.x + ',' + c.z, c.h]));
    // the main road's strip runs into the corner at full height; the corner's far end, on the stem, is lowered
    expect(heights.get(half.inner.slice(0, 2).join())).toBeCloseTo(CURB_RESIDENTIAL_M, 9);
    expect(heights.get(half.inner.slice(-2).join())).toBeCloseTo(LOWERED_CURB_M, 9);
    // the stub stands on the stem's curb line, outside both carriageways
    const [sx, sz] = half.inner.slice(-2);
    expect(sx).toBeCloseTo(ROAD_WIDTH_M[RoadClass.STREET] / 2, 6);
    expect(sz).toBeGreaterThan(ROAD_WIDTH_M[RoadClass.STREET] / 2);
    for (const { v, part } of triangles(layout.surface)) {
      if (!TOPS.includes(part)) continue;
      const [x, , z] = centroid(v);
      expect(carriagewayDistance(data, x, z)).toBeGreaterThan(0);
      expect(normal(v)[1]).toBeGreaterThan(0);
    }
    expectLooseEndsRamped(layout);
  });

  it('fillets all four corners of a crossroads', () => {
    const { data, layout } = build({ r: [street([-150, 0, 0, 0, 150, 0]), street([0, -150, 0, 0, 0, 150])] });
    expect(layout.corners).toHaveLength(4);
    for (const { v, part } of triangles(layout.surface)) {
      if (!TOPS.includes(part)) continue;
      const [x, , z] = centroid(v);
      expect(carriagewayDistance(data, x, z)).toBeGreaterThan(0);
    }
    for (const { v, part } of triangles(layout.surface)) if (TOPS.includes(part)) expect(normal(v)[1]).toBeGreaterThan(0);
  });

  it('gives an acute junction no fillet, and no sidewalk on either carriageway', () => {
    // two roads leaving one node 20° apart
    const a = 20 * (Math.PI / 180);
    const { data, layout } = build({ r: [street([0, 0, 150, 0]), street([0, 0, 150 * Math.cos(a), 150 * Math.sin(a)])] });
    expect(layout.corners).toHaveLength(0);
    for (const { v, part } of triangles(layout.surface)) {
      if (!TOPS.includes(part)) continue;
      const [x, , z] = centroid(v);
      expect(carriagewayDistance(data, x, z)).toBeGreaterThan(0);
    }
  });

  it('lowers the curb across a driveway and runs the sidewalk on, on that side only', () => {
    const drive: Road = { c: RoadClass.SERVICE, n: '', p: [0, 0, 0, 30], s: RoadUse.DRIVEWAY, i: 5 };
    const { layout } = build({ r: [street([-150, 0, 0, 0, 150, 0]), drive] });
    expect(layout.strips.filter((s) => s.ri === 0)).toHaveLength(2); // one strip a side, unbroken
    expect(layout.openings).toEqual([expect.objectContaining({ ri: 0, side: 1, kind: 'driveway', half: (ROAD_WIDTH_M[RoadClass.SERVICE] + 1) / 2 })]);
    const heights = curbHeights(layout.surface);
    const south = heights.filter((c) => c.z > 0 && Math.abs(c.x) < 1);
    const north = heights.filter((c) => c.z < 0 && Math.abs(c.x) < 1);
    expect(south.length).toBeGreaterThan(0);
    for (const c of south) expect(c.h).toBeCloseTo(LOWERED_CURB_M, 9);
    for (const c of north) expect(c.h).toBeCloseTo(CURB_RESIDENTIAL_M, 9);
    for (const c of heights.filter((c) => c.z > 0 && Math.abs(c.x) > 1.75 + 1.5 + 0.01 && Math.abs(c.x) < 100)) expect(c.h).toBeCloseTo(CURB_RESIDENTIAL_M, 9);
  });

  it('lowers both curbs at a mapped crossing and paints a zebra only when it is marked', () => {
    const roads = [street([-150, 0, 0, 0, 150, 0])];
    const marked = build({ r: roads, x: [{ i: 1, x: 0, z: 0, k: CrossingKind.MARKED, r: 0, v: 1 }] });
    expect(marked.layout.openings.filter((o) => o.kind === 'crossing')).toHaveLength(2);
    expect(marked.layout.markings.part.length).toBeGreaterThan(0);
    const unmarked = build({ r: roads, x: [{ i: 1, x: 0, z: 0, k: CrossingKind.UNMARKED, r: 0, v: 1 }] });
    expect(unmarked.layout.markings.part).toHaveLength(0);
  });

  it('never builds a sidewalk through a building, and narrows it before giving up', () => {
    // a house reaching to 1.8 m from the curb on the south side, x 0..10: the 1.5 m sidewalk narrows to 1 m there
    const edge = ROAD_WIDTH_M[RoadClass.STREET] / 2;
    const { layout } = build({ r: [street([-150, 0, 150, 0])], b: [{ p: square(0, edge + CURB_TOP_M + 1.2, 10), h: 5, k: 0 }] });
    const south = layout.strips.filter((s) => s.side > 0);
    expect(south).toHaveLength(1);
    const widths: number[] = [];
    for (let i = 0; i < south[0].outer.length; i += 2) widths.push(south[0].outer[i + 1] - south[0].inner[i + 1] - CURB_TOP_M);
    expect(Math.min(...widths)).toBeCloseTo(1, 6);
    // a house right on the curb ends the strip
    const blocked = build({ r: [street([-150, 0, 150, 0])], b: [{ p: square(0, edge + 0.5, 10), h: 5, k: 0 }] });
    expect(blocked.layout.strips.filter((s) => s.side > 0)).toHaveLength(2);
  });
});

describe('buildStreetscape: parking', () => {
  // a 60 × 40 m asphalt lot with a 10 × 10 m hole, on bumpy ground
  const lot = { i: 9, p: [-30, -20, 30, -20, 30, 20, -30, 20], h: [square(-5, -5, 10)], k: ParkingKind.SURFACE, sf: Surface.ASPHALT };

  it('cuts the surface to the terrain, keeps the hole and the area', () => {
    const { data, heightfield, layout } = build({ pa: [lot] });
    const soup = parkingSurfaces(layout, data, heightfield);
    const lift = roadLiftM(RoadClass.SERVICE);
    let area = 0;
    for (const { v, part } of triangles(soup)) {
      if (part !== Part.PARKING) continue;
      const n = normal(v);
      expect(n[1]).toBeGreaterThan(0);
      area += n[1] / 2;
      // planar on the ground: the middle of every piece is exactly on the terrain, so no piece spans a terrain fold
      const [x, y, z] = centroid(v);
      expect(y).toBeCloseTo(heightfield.heightAt(x, z) + lift, 6);
      expect(x > -5 && x < 5 && z > -5 && z < 5).toBe(false);
    }
    expect(area).toBeCloseTo(60 * 40 - 100, 6);
    // skirts face away from the surface
    for (const { v, part } of triangles(soup)) {
      if (part !== Part.SKIRT) continue;
      const n = normal(v);
      const [x, , z] = centroid(v);
      const len = Math.hypot(n[0], n[2]);
      const px = x + (n[0] / len) * 0.2;
      const pz = z + (n[2] / len) * 0.2;
      const onLot = Math.abs(px) < 30 && Math.abs(pz) < 20 && !(Math.abs(px) < 5 && Math.abs(pz) < 5);
      expect(onLot).toBe(false);
    }
  });

  it('infers a stall layout on a hard lot, none on gravel, and uses mapped spaces when there are some', () => {
    const asphalt = build({ pa: [lot] }).layout.lots[0];
    expect(asphalt.stallSource).toBe('inferred');
    expect(asphalt.stallCount).toBeGreaterThanOrEqual(4);
    expect(build({ pa: [{ ...lot, sf: Surface.GRAVEL }] }).layout.lots[0].stallSource).toBeNull();
    const spaces = build({ pa: [lot], ps: [{ i: 1, p: square(10, 10, 2.5) }] }).layout.lots[0];
    expect(spaces).toMatchObject({ stallSource: 'mapped', stallCount: 1 });
  });

  it('cuts any triangle into planar pieces of the same area', () => {
    const grid = { samples: 5, sampleCoord: (i: number) => -200 + 100 * i };
    const tri = [-170, -130, 140, -20, -10, 160];
    const out = cutToTerrain(tri, grid);
    let a = 0;
    for (let t = 0; t < out.length; t += 6) a += polygonArea(out.slice(t, t + 6));
    expect(a).toBeCloseTo(polygonArea(tri), 6);
    expect(out.length / 6).toBeGreaterThan(8);
  });
});

describe('StreetscapeIndex', () => {
  const lot = { i: 9, p: [60, 60, 100, 60, 100, 90, 60, 90], h: [square(75, 70, 5)], k: ParkingKind.SURFACE };
  const { data, heightfield, layout } = build({ r: [street([-150, 0, 150, 0])], pa: [lot] });
  const index = new StreetscapeIndex(layout, data, heightfield);
  const lift = roadLiftM(RoadClass.STREET);

  it('is the sidewalk height on the sidewalk, and nothing on the road', () => {
    const z = ROAD_WIDTH_M[RoadClass.STREET] / 2 + CURB_TOP_M + SIDEWALK_RESIDENTIAL_M / 2;
    for (const x of [-40, 3, 77.7]) {
      expect(index.surfaceAt(x, z)).toBeCloseTo(heightfield.heightAt(x, z) + lift + CURB_RESIDENTIAL_M, 1);
      expect(index.surfaceAt(x, -z)).toBeCloseTo(heightfield.heightAt(x, -z) + lift + CURB_RESIDENTIAL_M, 1);
      expect(index.surfaceAt(x, 0)).toBeNull();
      expect(index.surfaceAt(x, 20)).toBeNull();
    }
  });

  it('is the parking height on the lot, and nothing in its hole', () => {
    expect(index.surfaceAt(65, 65)).toBe(heightfield.heightAt(65, 65) + roadLiftM(RoadClass.SERVICE));
    expect(index.surfaceAt(77, 72)).toBeNull();
  });
});

describe('streetscape: trees, determinism and disposal', () => {
  const land = [{ k: LandUse.RESIDENTIAL, p: square(-200, -200, 400) }];
  // untagged residential streets: about 40 % get a verge, and verges get trees
  const roads = Array.from({ length: 8 }, (_, k): Road => ({ c: RoadClass.STREET, n: '', p: [-150, -140 + k * 40, 150, -140 + k * 40], i: 500 + k }));

  it('puts inferred trees only on verges, spaced and clear of junctions', () => {
    const { layout } = build({ r: roads, l: land, t: [0, 100] });
    expect(layout.trees[0]).toEqual({ x: 0, z: 100, source: 'mapped' });
    const inferred = layout.trees.filter((t) => t.source === 'inferred');
    expect(inferred.length).toBeGreaterThan(0);
    for (let i = 1; i < inferred.length; i++) {
      const d = Math.hypot(inferred[i].x - inferred[i - 1].x, inferred[i].z - inferred[i - 1].z);
      if (d < 30) expect(d).toBeGreaterThanOrEqual(12 - 1e-9);
    }
    const avoid = inferred.flatMap((t) => [t.x, t.z]);
    expect(build({ r: roads, l: land }, avoid).layout.trees.filter((t) => t.source === 'inferred')).toHaveLength(0);
  });

  it('builds the same geometry twice, number for number, and never calls Math.random', () => {
    const random = Math.random;
    Math.random = () => {
      throw new Error('Math.random called');
    };
    try {
      const world = { r: [street([-150, 0, 0, 0, 150, 0]), street([0, 0, 0, 150])], l: land, pa: [{ i: 9, p: square(40, 40, 40), k: ParkingKind.SURFACE }] };
      const a = build(world).layout;
      const b = build(world).layout;
      expect(b.surface.pos).toEqual(a.surface.pos);
      expect(b.markings.pos).toEqual(a.markings.pos);
      expect(b.trees).toEqual(a.trees);
    } finally {
      Math.random = random;
    }
  });

  it('batches per chunk and frees every geometry it made, leaving the materials', () => {
    const { data, heightfield, layout } = build({ r: [street([-190, 0, 190, 0])], pa: [{ i: 9, p: square(40, 40, 40), k: ParkingKind.SURFACE }] });
    const surface = new THREE.MeshLambertMaterial({ vertexColors: true });
    const markings = new THREE.MeshLambertMaterial();
    const sidewalks = new SidewalkMesh(layout, { surface, markings });
    const parking = new ParkingMesh(layout, data, heightfield, { surface, markings });
    // the street spans two chunks (x < 0 and x >= 0), the lot one
    expect(sidewalks.meshes.length).toBeGreaterThanOrEqual(2);
    expect(parking.meshes.length).toBeGreaterThanOrEqual(1);
    const freed = new Set<THREE.BufferGeometry>();
    for (const m of [...sidewalks.meshes, ...parking.meshes]) m.geometry.addEventListener('dispose', () => freed.add(m.geometry));
    let materialFreed = false;
    surface.addEventListener('dispose', () => {
      materialFreed = true;
    });
    sidewalks.dispose();
    parking.dispose();
    expect(freed.size).toBe(sidewalks.meshes.length + parking.meshes.length);
    expect(materialFreed).toBe(false);
  });
});
