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
  it('builds each kind from boxes, one mesh per 250 m chunk, standing on the ground', () => {
    const draw = new PlotBoundaries(
      [
        run(BoundaryKind.HEDGE, [0, 0, 3.2, 0]), // two 1.6 m pieces of 5 faces: 20 triangles
        run(BoundaryKind.WALL, [0, 10, 1, 10]), // one 1 m piece: 10
        run(BoundaryKind.BOARD, [300, 0, 302.4, 0]), // one 2.4 m piece in the next chunk: 10
        run(BoundaryKind.PICKET, [0, 20, 2, 20]), // four pickets and a rail, each of 2 faces: 20
      ],
      { groundAt: x => x / 100 },
    );
    expect(draw.meshes).toHaveLength(2);
    expect(draw.triangles).toBe(20 + 10 + 10 + 20);
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
    expect(draw.meshes.every(m => m.castShadow && m.material === draw.material)).toBe(true);
    draw.dispose();
  });
});
