import { describe, expect, it } from 'vitest';
import { BuildingIndex } from '../../../src/world/buildings';
import { BuildingKind, LandUse, type Road, RoadClass } from '../../../src/world/data';
import { Heightfield } from '../../../src/world/heightfield';
import {
  BoundaryKind,
  type BoundaryRun,
  drivewaySurface,
  industrialFences,
  layoutBoundaries,
} from '../../../src/world/plot-boundaries';
import type { Plot } from '../../../src/world/plots';
import { RoadNetwork } from '../../../src/world/roads';
import type { Profile } from '../../../src/world/streetscape-rules';
import { makeWorld, square } from './fixture';

// A row of 20 m plots along a street at z = 0, from x = 0 eastwards: front edge at z = 5, back at z = 40. Each house is
// 10 m × 10 m in the middle of its plot, and its driveway runs at 3 m into the plot. Each plot fronts a street of its
// own (ri = i), so each takes its own street's style.
function row(count: number, houseX0 = 5): Plot[] {
  return Array.from({ length: count }, (_, i) => {
    const [x0, x1] = [20 * i, 20 * i + 20];
    return {
      key: `p${i}`,
      ri: i,
      side: 1,
      outline: [x0, 5, x1, 5, x1, 40, x0, 40],
      house: [x0 + houseX0, 10, x0 + houseX0 + 10, 10, x0 + houseX0 + 10, 20, x0 + houseX0, 20],
      driveway: { p: [x0 + 3, 2.75, x0 + 3, 15], widthM: 3.2, source: 'inferred' },
    } satisfies Plot;
  });
}
const centre = (): Profile => 'centre';
const xs = (r: BoundaryRun) => r.p.filter((_, i) => i % 2 === 0);
const zs = (r: BoundaryRun) => r.p.filter((_, i) => i % 2 === 1);
const onFront = (r: BoundaryRun) => zs(r).every(z => z === 5);

describe('layoutBoundaries', () => {
  it('closes most street edges, sides and backs, with a mix of kinds on every edge', () => {
    const plots = row(400);
    const runs = layoutBoundaries(plots, centre);
    const closed = (test: (r: BoundaryRun) => boolean) =>
      new Set(runs.filter(test).map(r => r.key)).size / plots.length;
    expect(closed(onFront)).toBeGreaterThan(0.75); // the centre closes 85 %
    expect(closed(onFront)).toBeLessThan(0.95);
    expect(closed(r => zs(r).every(z => z === 40))).toBeGreaterThan(0.7); // and 80 % of backs
    const kindsOn = (test: (r: BoundaryRun) => boolean) => [...new Set(runs.filter(test).map(r => r.kind))].sort();
    expect(kindsOn(onFront)).toEqual([BoundaryKind.HEDGE, BoundaryKind.PICKET, BoundaryKind.BOARD, BoundaryKind.WALL]);
    expect(kindsOn(r => !onFront(r))).toEqual([BoundaryKind.HEDGE, BoundaryKind.PICKET, BoundaryKind.BOARD]);
  });

  it('fences a plot in on every edge, or on none', () => {
    const runs = layoutBoundaries(row(300), centre);
    const byKey = new Map<string, BoundaryRun[]>();
    for (const r of runs) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);
    for (const [key, rs] of byKey) {
      const x0 = 20 * Number(key.slice(1));
      expect(rs.some(onFront)).toBe(true);
      expect(rs.some(r => zs(r).every(z => z === 40))).toBe(true);
      expect(rs.some(r => xs(r).every(x => x === x0))).toBe(true); // west side
      expect(rs.some(r => xs(r).every(x => x === x0 + 20))).toBe(true); // east side
    }
  });

  it('leaves gaps at the driveway and at a gate opposite the house', () => {
    for (const r of layoutBoundaries(row(100), centre).filter(onFront)) {
      const x0 = 20 * Number(r.key.slice(1));
      const [a, b] = [Math.min(...xs(r)), Math.max(...xs(r))];
      expect(a < x0 + 3 && b > x0 + 3).toBe(false); // the driveway's gap, 1.9 m either side of x0 + 3
      expect(a < x0 + 10 && b > x0 + 10).toBe(false); // the gate, opposite the house's middle
    }
  });

  it('lets two neighbours each have a boundary on the line between them, each on its own side, and none on a wall', () => {
    const runs = layoutBoundaries(row(200), centre);
    const sideRuns = runs.filter(r => xs(r).every(x => x === xs(r)[0]) && xs(r)[0] % 20 === 0);
    const byLine = new Map<number, BoundaryRun[]>();
    for (const r of sideRuns) byLine.set(xs(r)[0], [...(byLine.get(xs(r)[0]) ?? []), r]);
    const both = [...byLine.values()].filter(rs => new Set(rs.map(r => r.key)).size === 2);
    expect(both.length).toBeGreaterThan(50);
    // the way each stands off the line along x: right of a line heading +z (south) is -x
    const towardsX = (r: BoundaryRun) => -Math.sign(r.p[3] - r.p[1]) * r.inward;
    for (const rs of both) expect(new Set(rs.map(towardsX)).size).toBe(2); // back to back, each on its own side
    // each house against its plot's west side: nothing on that side of the line, but its neighbour still can
    const againstWalls = layoutBoundaries(row(200, 0), centre);
    for (const r of againstWalls) {
      const x0 = 20 * Number(r.key.slice(1));
      expect(xs(r).every(x => x === x0)).toBe(false);
    }
    expect(againstWalls.some(r => xs(r).every(x => x === xs(r)[0] && x > 0 && x % 20 === 0))).toBe(true);
  });

  it('stands each boundary on the side of the line its plot is on', () => {
    for (const r of layoutBoundaries(row(100), centre)) {
      // the plots lie south of their front edges and between their sides; every line's plot side faces its house
      const x0 = 20 * Number(r.key.slice(1));
      const [dx, dz] = [r.p[2] - r.p[0], r.p[3] - r.p[1]];
      const cross = dx * (15 - r.p[1]) - dz * (x0 + 10 - r.p[0]);
      expect(Math.sign(cross)).toBe(r.inward);
    }
  });

  it('makes a hedge half as thick where a mailbox stands at it, for a metre', () => {
    // a mailbox on each plot's front line, 6 m into the plot, 0.15 m inside the line
    const plots = row(100);
    const mailboxes = plots.map((_, i) => ({ x: 20 * i + 6, z: 5.15 }));
    const runs = layoutBoundaries(plots, centre, mailboxes).filter(r => onFront(r) && r.kind === BoundaryKind.HEDGE);
    expect(runs.length).toBeGreaterThan(5);
    for (const r of runs) {
      const x0 = 20 * Number(r.key.slice(1));
      const [a, b] = [Math.min(...xs(r)), Math.max(...xs(r))];
      const atMailbox = a < x0 + 6 && b > x0 + 6;
      if (r.slim) {
        expect(a).toBeCloseTo(x0 + 5.5, 6);
        expect(b).toBeCloseTo(x0 + 6.5, 6);
      } else expect(atMailbox).toBe(false);
    }
    expect(runs.some(r => r.slim)).toBe(true);
    // without mailboxes, nothing is slim
    expect(layoutBoundaries(plots, centre).some(r => r.slim)).toBe(false);
  });

  it('is the same whatever order the plots come in', () => {
    const plots = row(60);
    const key = (runs: BoundaryRun[]) => runs.map(r => JSON.stringify(r)).sort();
    expect(key(layoutBoundaries([...plots].reverse(), centre))).toEqual(key(layoutBoundaries(plots, centre)));
  });
});

describe('industrialFences', () => {
  // an industrial area 100 m square, x and z from 0 to 100, with a road across its west edge at x = 0 and a road in
  // through its south edge at x = 50, a building on its north edge, and a fenced yard in its north-east corner
  const area = { k: LandUse.INDUSTRIAL, p: square(0, 0, 100) };
  const roads: Road[] = [
    { c: RoadClass.STREET, n: 'Industrivägen', p: [0, -50, 0, 150], i: 1 },
    { c: RoadClass.SERVICE, n: '', p: [50, 150, 50, 60], i: 2 },
  ];
  const workshop = { p: [30, -5, 45, -5, 45, 10, 30, 10], h: 5, k: BuildingKind.OTHER };
  const data = makeWorld({ size: 1000, l: [area], r: roads, b: [workshop] });
  const fences = industrialFences({
    data,
    roads: new RoadNetwork(data, new Heightfield(data)),
    buildings: new BuildingIndex(data),
    keepOut: [square(90, -10, 20)],
  });
  const points = fences.flatMap(r => Array.from({ length: r.p.length / 2 }, (_, i) => [r.p[2 * i], r.p[2 * i + 1]]));

  it('fences the edge with a tall mesh fence, on the area side, leaving gaps at roads, buildings and yards', () => {
    expect(fences.length).toBeGreaterThan(0);
    for (const r of fences) expect(r).toMatchObject({ kind: BoundaryKind.MESH, heightM: 2.5 });
    expect(points.some(([x, z]) => z === 100 && x > 10 && x < 40)).toBe(true); // the south edge runs
    // along Industrivägen on the west edge, the fence stands back from it, inside the area: 4 m clears its 2.75 m half
    // width and 1 m
    expect(points.every(([x]) => x > 2.75 + 1)).toBe(true);
    expect(points.some(([x, z]) => x === 4 && z > 20 && z < 80)).toBe(true);
    expect(points.some(([x, z]) => z === 100 && Math.abs(x - 50) < 1.75 + 1)).toBe(false); // a gap at the entrance
    expect(points.some(([x, z]) => z === 0 && x > 30.5 && x < 44.5)).toBe(false); // none along the workshop
    // none within 15 m of the yard's box: a piece is kept when its middle is outside, so its end can be 1.25 m in
    expect(points.some(([x, z]) => x > 76.25 && z < 23.75)).toBe(false);
    // the fence stands inside the area: right of each run, towards the middle at (50, 50)
    for (const r of fences) {
      const [ax, az, bx, bz] = r.p;
      const cross = (bx - ax) * (50 - az) - (bz - az) * (50 - ax);
      expect(Math.sign(cross)).toBe(r.inward);
    }
  });
});

describe('drivewaySurface', () => {
  it('lays more driveways with asphalt in the centre than on the outskirts, the same for the same plot', () => {
    const plots = row(400);
    const asphalt = (profile: 'centre' | 'outskirts') =>
      plots.filter(p => drivewaySurface(p, profile) === 'asphalt').length / plots.length;
    expect(asphalt('centre')).toBeGreaterThan(0.5);
    expect(asphalt('outskirts')).toBeLessThan(0.25);
    expect(drivewaySurface(plots[7], 'centre')).toBe(drivewaySurface(plots[7], 'centre'));
  });
});
