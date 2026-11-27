import { describe, expect, it } from 'vitest';
import { PlotBoundaries } from '../../../../src/world/mesh/plot-boundaries';
import { BoundaryKind, type BoundaryRun } from '../../../../src/world/plot-boundaries';

const run = (kind: BoundaryKind, p: number[]): BoundaryRun => ({
  kind,
  p,
  heightM: 1,
  variant: 0,
  key: 'p0',
  inward: 1,
});

describe('PlotBoundaries', () => {
  it('builds hedges and walls from boxes and fences from textured panels on posts, two meshes per 250 m chunk', () => {
    const draw = new PlotBoundaries(
      [
        run(BoundaryKind.HEDGE, [0, 0, 4.8, 0]), // two 2.4 m pieces of 5 faces: 20 triangles
        run(BoundaryKind.WALL, [0, 10, 1, 10]), // one 1 m piece: 10
        run(BoundaryKind.BOARD, [300, 0, 302.4, 0]), // one panel and a post at each end, in the next chunk: 2 + 2 × 10
        run(BoundaryKind.PICKET, [0, 20, 2, 20]), // the same: 22
      ],
      { groundAt: x => x / 100 },
    );
    expect(draw.meshes).toHaveLength(4);
    expect(draw.triangles).toBe(20 + 10 + 22 + 22);
    const position = draw.meshes[0].geometry.getAttribute('position');
    let lowest = Infinity;
    for (let i = 0; i < position.count; i++) lowest = Math.min(lowest, position.getY(i));
    expect(lowest).toBeCloseTo(-0.15, 6); // sunk below the ground at x = 0
    // the hedge along +x stands to its right, at z = 0 to 0.7: its outer face on the line
    let [zMin, zMax] = [Infinity, -Infinity];
    for (let i = 0; i < 6 * 5 * 2; i++)
      [zMin, zMax] = [Math.min(zMin, position.getZ(i)), Math.max(zMax, position.getZ(i))];
    expect(zMin).toBeCloseTo(0, 6);
    expect(zMax).toBeCloseTo(0.7, 6);
    expect(draw.meshes.every(m => m.castShadow)).toBe(true);
    // the panels are textured along the run: the picket fence's 2 m repeat 0.15 m apart, see-through between
    const panels = draw.meshes.filter(m => m.material === draw.materials.panels);
    expect(panels).toHaveLength(2);
    expect(draw.materials.panels.alphaTest).toBeGreaterThan(0);
    const uv = panels[0].geometry.getAttribute('uv');
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
    expect(Math.max(...us)).toBeCloseTo(2 / 0.15, 6);
    draw.dispose();
  });
});
