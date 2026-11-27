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
  it('makes a slim hedge half as thick, keeping its inner face, and draws the chain-link fence with its own repeating mesh', () => {
    const slim = new PlotBoundaries([{ ...run(BoundaryKind.HEDGE, [0, 0, 2, 0]), slim: true }], { groundAt: () => 0 });
    const z = slim.meshes[0].geometry.getAttribute('position');
    const zs = Array.from({ length: z.count }, (_, i) => z.getZ(i));
    expect(Math.min(...zs)).toBeCloseTo(0.35, 6); // the room on the line's side
    expect(Math.max(...zs)).toBeCloseTo(0.7, 6);
    slim.dispose();
    const mesh = new PlotBoundaries([run(BoundaryKind.MESH, [0, 0, 2.5, 0])], { groundAt: () => 0 });
    const chain = mesh.meshes.find(m => m.material === mesh.materials.chain)!;
    // blended, so the wires fade to a haze with distance instead of vanishing under a test, and casting no shadow
    expect(mesh.materials.chain.transparent).toBe(true);
    expect(mesh.materials.chain.alphaTest).toBeLessThan(0.1);
    expect(chain.castShadow).toBe(false);
    expect(mesh.meshes.filter(m => m !== chain).every(m => m.castShadow)).toBe(true); // its posts and rail do
    const v = chain.geometry.getAttribute('uv');
    const vs = Array.from({ length: v.count }, (_, i) => v.getY(i));
    expect(Math.max(...vs)).toBeCloseTo((1 * 1 + 0.15) / 0.08, 6); // the mesh repeats up the fence, 8 cm a diamond
    mesh.dispose();
  });

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
