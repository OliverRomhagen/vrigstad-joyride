// The plots on the real map (data/vrigstad.json): one per house, none overlapping, none on a road.
import { describe, expect, it } from 'vitest';
import data from '../../../data/vrigstad.json';
import { BuildingIndex } from '../../../src/world/buildings';
import { ROAD_WIDTH_M, RoadUse, type WorldData } from '../../../src/world/data';
import { houseFronts } from '../../../src/world/furniture/houses';
import { Heightfield } from '../../../src/world/heightfield';
import { layoutPlots, propertyLineM } from '../../../src/world/plots';
import { pointInPolygon, polygonBounds, segmentDistance } from '../../../src/world/polygon';
import { RoadNetwork } from '../../../src/world/roads';
import { classifyStreetscape, sideSpecOf } from '../../../src/world/streetscape-rules';

const D = data as unknown as WorldData;
const roads = new RoadNetwork(D, new Heightfield(D));
const buildings = new BuildingIndex(D);
const sides = classifyStreetscape(D, roads, buildings);
const fronts = houseFronts(D, roads, () => true);
const t0 = performance.now();
const plots = layoutPlots({
  data: D,
  roads,
  buildings,
  fronts,
  frontEdgeM: (ri, side) => propertyLineM(sideSpecOf(sides[ri], side), roads.lines[ri].c),
});
const buildMs = performance.now() - t0;

describe('the plots on the real map', () => {
  it('gives nearly every house that fronts a street a plot and a driveway, and says how many are mapped', () => {
    // garages and big sheds by a bigger house are a sixth of the buildings houses.ts calls houses; they get no plot
    expect(plots.length).toBeGreaterThan(0.8 * fronts.length);
    const withDriveway = plots.filter(p => p.driveway);
    expect(withDriveway.length).toBeGreaterThan(0.95 * plots.length);
    // houses.ts ties only two of the 22 mapped driveways to a house; the rest are generated
    expect(plots.filter(p => p.driveway?.source === 'mapped').length).toBe(fronts.filter(f => f.atDriveway).length);
    expect(buildMs).toBeLessThan(400); // the budget in the game is #401's 40 ms; this only catches a runaway
  });

  it('puts every house inside its own plot', () => {
    const byKey = new Map(fronts.map(f => [f.key, f]));
    const outside = plots.filter(p => {
      const f = byKey.get(p.key)!;
      return !pointInPolygon(p.outline, f.x, f.z);
    });
    expect(outside.map(p => p.key)).toEqual([]);
  });

  it('lets no two plots overlap by more than the growing step', () => {
    // a 1 m grid over every plot: a cell more than 0.5 m inside two plots is an overlap
    const cells = new Map<string, number>();
    let overlaps = 0;
    for (const p of plots) {
      const b = polygonBounds(p.outline);
      for (let x = Math.ceil(b.x0); x <= b.x1; x++)
        for (let z = Math.ceil(b.z0); z <= b.z1; z++) {
          if (!pointInPolygon(p.outline, x, z) || edgeDistance(p.outline, x, z) < 0.5) continue;
          const k = `${x},${z}`;
          if (cells.has(k)) overlaps++;
          cells.set(k, 1);
        }
    }
    expect(overlaps / cells.size).toBeLessThan(0.002);
  });

  it('keeps nearly every plot off the carriageways', () => {
    // a plot always covers its house's rectangle in the street's coordinates, so where a house stands within a couple
    // of metres of a service road or a path, or a street curls round behind it, a corner reaches into the road: 12 of
    // 556 do, by 0.1 to 2.5 m
    const onRoad = new Set<string>();
    for (const p of plots)
      for (let i = 0; i < p.outline.length; i += 2)
        roads.forEachSegmentNear(p.outline[i], p.outline[i + 1], 10, (ax, az, bx, bz, ri) => {
          if (D.r[ri].s === RoadUse.DRIVEWAY || D.r[ri].s === RoadUse.SIDEWALK) return;
          if (segmentDistance(p.outline[i], p.outline[i + 1], ax, az, bx, bz) < ROAD_WIDTH_M[roads.lines[ri].c] / 2)
            onRoad.add(p.key);
        });
    expect(onRoad.size).toBeLessThan(0.03 * plots.length);
  });
});

function edgeDistance(p: number[], x: number, z: number) {
  let d = Infinity;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2)
    d = Math.min(d, segmentDistance(x, z, p[j], p[j + 1], p[i], p[i + 1]));
  return d;
}
