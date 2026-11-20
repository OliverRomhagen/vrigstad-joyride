import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BuildingKind } from '../../../../src/world/data';
import { Heightfield } from '../../../../src/world/heightfield';
import { BuildingShellsByMaterial, PaintedBuildingShells } from '../../../../src/world/mesh/building-shells';
import { makeWorld, square } from '../fixture';

describe('PaintedBuildingShells', () => {
  it('adds what extra emits after the shell, in its colour', () => {
    const world = makeWorld({ b: [{ p: square(0, 0, 10), h: 5, k: BuildingKind.OTHER }] });
    const grey = new THREE.Color(0.5, 0.5, 0.5);
    const red = new THREE.Color(1, 0, 0);
    const material = new THREE.MeshBasicMaterial({ vertexColors: true });
    const plain = new PaintedBuildingShells(world, new Heightfield(world), {
      material,
      colours: () => ({ wall: grey, wallFoot: grey, roof: grey }),
    });
    const shellVertices = plain.mesh.geometry.getAttribute('position').count;
    const shells = new PaintedBuildingShells(world, new Heightfield(world), {
      material,
      colours: () => ({ wall: grey, wallFoot: grey, roof: grey }),
      extra: (_shape, emit) => {
        emit(1, 6, 1, red);
        emit(2, 6, 1, red);
        emit(1, 7, 1, red);
      },
    });
    const pos = shells.mesh.geometry.getAttribute('position');
    const colour = shells.mesh.geometry.getAttribute('color');
    expect(pos.count).toBe(shellVertices + 3);
    expect([pos.getX(shellVertices), pos.getY(shellVertices), pos.getZ(shellVertices)]).toEqual([1, 6, 1]);
    expect([colour.getX(shellVertices + 2), colour.getY(shellVertices + 2), colour.getZ(shellVertices + 2)]).toEqual([
      1, 0, 0,
    ]);
    expect(colour.getX(0)).toBe(0.5);
    plain.dispose();
    shells.dispose();
  });
});

describe('BuildingShellsByMaterial', () => {
  it('frees its geometry on dispose and leaves the materials to their owner', () => {
    const world = makeWorld({ b: [{ p: square(0, 0, 10), h: 5, k: BuildingKind.OTHER }] });
    const materials = { wall: new THREE.MeshBasicMaterial(), roof: new THREE.MeshBasicMaterial() };
    const shells = new BuildingShellsByMaterial(world, new Heightfield(world), {
      materials,
      materialsFor: () => ({ walls: 'wall', roof: 'roof' }),
    });
    const freed: string[] = [];
    for (const mesh of shells.meshes) mesh.geometry.addEventListener('dispose', () => freed.push('geometry'));
    for (const [key, material] of Object.entries(materials))
      material.addEventListener('dispose', () => freed.push(key));
    shells.dispose();
    expect(freed).toEqual(['geometry', 'geometry']);
  });
});
