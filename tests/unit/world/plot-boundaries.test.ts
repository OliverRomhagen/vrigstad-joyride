import { describe, expect, it } from 'vitest';
import { BoundaryKind, type BoundaryRun, layoutBoundaries } from '../../../src/world/plot-boundaries';
import type { Plot } from '../../../src/world/plots';
import type { Profile } from '../../../src/world/streetscape-rules';

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

  it('is the same whatever order the plots come in', () => {
    const plots = row(60);
    const key = (runs: BoundaryRun[]) => runs.map(r => JSON.stringify(r)).sort();
    expect(key(layoutBoundaries([...plots].reverse(), centre))).toEqual(key(layoutBoundaries(plots, centre)));
  });
});
