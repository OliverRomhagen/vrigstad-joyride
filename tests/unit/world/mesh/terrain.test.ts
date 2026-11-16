import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Heightfield } from '../../../../src/world/heightfield';
import { TerrainMesh } from '../../../../src/world/mesh/terrain';
import { makeWorld } from '../fixture';

// uneven, so each cell's two diagonals give different surfaces
const UNEVEN = [1001, 1234, 1587, 1102, 1999, 1313, 1050, 1234, 1587];

describe('TerrainMesh', () => {
  it('is the surface heightAt describes, so what is placed with it sits on the mesh', () => {
    const world = makeWorld({ elev: UNEVEN });
    const field = new Heightfield(world, { exaggeration: 2 });
    const material = new THREE.MeshBasicMaterial();
    const terrain = new TerrainMesh(world, field, { material, skirtMaterial: material, skirtDepthM: 10 });
    const pos = terrain.surface.geometry.getAttribute('position');
    const index = terrain.surface.geometry.getIndex();
    if (!index) throw new Error('the terrain is indexed');
    for (let t = 0; t < index.count; t += 3) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (let k = 0; k < 3; k++) {
        const v = index.getX(t + k);
        x += pos.getX(v) / 3;
        y += pos.getY(v) / 3;
        z += pos.getZ(v) / 3;
      }
      expect(field.heightAt(x, z)).toBeCloseTo(y, 4);
    }
    terrain.dispose();
  });
});
