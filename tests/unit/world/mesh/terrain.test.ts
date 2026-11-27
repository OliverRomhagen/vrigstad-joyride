import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WaterwayKind } from '../../../../src/world/data';
import { Heightfield } from '../../../../src/world/heightfield';
import { TerrainMesh } from '../../../../src/world/mesh/terrain';
import { WaterBodies } from '../../../../src/world/water-shapes';
import { makeValley, makeWorld } from '../fixture';

// uneven, so each cell's two diagonals give different surfaces
const UNEVEN = [1001, 1234, 1587, 1102, 1999, 1313, 1050, 1234, 1587];
const SKIRT_DEPTH_M = 1.5;

describe('TerrainMesh', () => {
  it('is the surface heightAt describes, so what is placed with it sits on the mesh', () => {
    const world = makeWorld({ elev: UNEVEN });
    const field = new Heightfield(world, { exaggeration: 2 });
    const material = new THREE.MeshBasicMaterial();
    const terrain = new TerrainMesh(field, { material, skirtMaterial: material, skirtDepthM: 10 });
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
      // to the centimetre: room for Float32 rounding, while a flipped diagonal misses by tens of metres
      expect(field.heightAt(x, z)).toBeCloseTo(y, 2);
    }
    terrain.dispose();
  });

  it('starts the skirt exactly at the edge of the surface', () => {
    // a different height at every sample, in decimetres
    const world = makeWorld({ elev: [10, 20, 30, 40, 55, 60, 70, 80, 95] });
    const material = new THREE.MeshBasicMaterial();
    const terrain = new TerrainMesh(new Heightfield(world), {
      material,
      skirtMaterial: material,
      skirtDepthM: SKIRT_DEPTH_M,
    });
    const surface = terrain.surface.geometry.getAttribute('position');
    const surfaceHeight = new Map<string, number>();
    for (let i = 0; i < surface.count; i++) surfaceHeight.set(`${surface.getX(i)},${surface.getZ(i)}`, surface.getY(i));
    const skirt = terrain.skirt.geometry.getAttribute('position');
    let tops = 0;
    for (let i = 0; i < skirt.count; i++) {
      if (skirt.getY(i) === -SKIRT_DEPTH_M) continue;
      expect(skirt.getY(i)).toBe(surfaceHeight.get(`${skirt.getX(i)},${skirt.getZ(i)}`));
      tops++;
    }
    // four edges of two walls each, and three of each wall's six vertices are on top
    expect(tops).toBe(24);
    terrain.dispose();
  });

  it('builds a rectangle as nx × nz samples, with UVs from corner to corner and a skirt round all four edges', () => {
    // 100 m east to west, 50 m north to south: 3 × 2 samples, 2 × 1 cells
    const world = makeWorld({ bounds: [-50, 0, 50, 50], nx: 3, nz: 2, elev: [10, 20, 30, 40, 55, 60] });
    const material = new THREE.MeshBasicMaterial();
    const terrain = new TerrainMesh(new Heightfield(world), { material, skirtMaterial: material, skirtDepthM: 1 });
    const geo = terrain.surface.geometry;
    const pos = geo.getAttribute('position');
    const uv = geo.getAttribute('uv');
    expect(pos.count).toBe(6);
    expect(geo.getIndex()?.count).toBe(2 * 2 * 3);
    const xs = new Set<number>();
    const zs = new Set<number>();
    for (let v = 0; v < pos.count; v++) {
      xs.add(pos.getX(v));
      zs.add(pos.getZ(v));
      // the ground texture spans the rectangle: u from the west edge, v from the south edge
      expect(uv.getX(v)).toBeCloseTo((pos.getX(v) + 50) / 100);
      expect(uv.getY(v)).toBeCloseTo(1 - pos.getZ(v) / 50);
    }
    expect([...xs].sort((a, b) => a - b)).toEqual([-50, 0, 50]);
    expect([...zs].sort((a, b) => a - b)).toEqual([0, 50]);
    // one wall per grid step: two along each of the long edges and one along each short one, six vertices each
    expect(terrain.skirt.geometry.getAttribute('position').count).toBe((2 + 2 + 1 + 1) * 6);
    terrain.dispose();
  });

  it('draws refined cells on their finer grid, joined to their neighbours without cracks', () => {
    const world = makeValley({ ww: [{ k: WaterwayKind.RIVER, p: [-180, 10, 180, 10] }] });
    const base = new Heightfield(world);
    const field = new Heightfield(world, { cut: new WaterBodies(world, base) });
    const material = new THREE.MeshBasicMaterial();
    const terrain = new TerrainMesh(field, { material, skirtMaterial: material, skirtDepthM: 10 });
    expect(field.refinedCells).toBeGreaterThan(0);
    expect(terrain.refined.length).toBeGreaterThan(0);
    const at = new Map<string, number>();
    for (const mesh of [terrain.surface, ...terrain.refined]) {
      const pos = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex() as THREE.BufferAttribute;
      const [ox, oz] = [mesh.position.x, mesh.position.z];
      // every triangle's middle is on the heightAt surface
      for (let t = 0; t < index.count; t += 3) {
        let [x, y, z] = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const v = index.getX(t + k);
          x += (pos.getX(v) + ox) / 3;
          y += pos.getY(v) / 3;
          z += (pos.getZ(v) + oz) / 3;
        }
        expect(field.heightAt(x, z)).toBeCloseTo(y, 3);
      }
      for (let v = 0; v < pos.count; v++) {
        const [x, y, z] = [pos.getX(v) + ox, pos.getY(v), pos.getZ(v) + oz];
        // every vertex, those on a cell's edge too, is on the surface the cell next to it describes: no T-junction gaps
        for (const d of [1e-4, -1e-4]) expect(field.heightAt(x + d, z + d)).toBeCloseTo(y, 3);
        // vertices at the same place share a height, so cells and blocks meet without a step
        const key = `${x.toFixed(3)},${z.toFixed(3)}`;
        const seen = at.get(key);
        if (seen === undefined) at.set(key, y);
        else expect(y).toBeCloseTo(seen, 4);
      }
    }
    expect(terrain.triangles).toBeGreaterThan(2 * 16 * 16);
    terrain.dispose();
  });
});
