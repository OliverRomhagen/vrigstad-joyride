import { describe, expect, it } from 'vitest';
import { PlotOutlines } from '../../../../src/world/mesh/plot-outlines';
import type { Plot } from '../../../../src/world/plots';

const plot: Plot = {
  key: 'h0.0',
  ri: 0,
  side: 1,
  outline: [0, 5, 4, 5, 4, 9, 0, 9],
  driveway: { p: [2, 2, 2, 6], widthM: 2, source: 'inferred' },
};

describe('PlotOutlines', () => {
  it('drapes the outline and the driveway over the ground, in pieces of at most 2 m', () => {
    const outlines = new PlotOutlines([plot], (x, z) => x + z);
    const position = outlines.mesh.geometry.getAttribute('position');
    // the outline: four 4 m sides of 2 pieces; the driveway: two 4 m sides of 2 pieces and two 2 m ends of 1
    expect(position.count).toBe(2 * (4 * 2 + 2 * 2 + 2));
    expect(position.getY(0)).toBeCloseTo(0 + 5 + 0.25, 6);
    outlines.dispose();
  });
});
