import type * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { WORKSHOP_PAINTS } from '../../../../src/game/sim/paint-jobs';
import '../../../../src/world/three-legacy';

// models.ts draws its blob shadow on a canvas as it loads: one whose 2D context draws nothing, as the look is checked in the game
let models: typeof import('../../../../src/game/render/models');
beforeAll(async () => {
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop: () => {} }) });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
  models = await import('../../../../src/game/render/models');
});

const gold = WORKSHOP_PAINTS.find(p => p.metallic)!.paint;

describe('the procedural stand-in in a metallic paint', () => {
  it('wears the metallic material on its painted parts only, so glass, tyres and lamps stay as they are', () => {
    for (const type of ['traktor', 'volvo'] as const) {
      const g = models.carGeo(type, gold),
        mats = models.carMatFor(gold) as THREE.Material[];
      expect(mats).toHaveLength(2);
      expect(mats[0]).toBe(models.carMat);
      const count = g.attributes.position!.count,
        painted = g.groups.filter(gr => gr.materialIndex === 1).reduce((n, gr) => n + gr.count, 0);
      expect(g.groups.reduce((n, gr) => n + gr.count, 0)).toBe(count); // every triangle drawn, once
      expect(painted).toBeGreaterThan(0);
      expect(painted).toBeLessThan(count);
    }
  });

  it('stays one geometry with the glossy material in any other paint', () => {
    expect(models.carGeo('traktor', '#4f7a34').groups).toEqual([]);
    expect(models.carMatFor('#4f7a34')).toBe(models.carMat);
  });
});
