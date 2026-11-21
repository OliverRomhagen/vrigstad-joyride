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

// Front faces point out of the building, as three expects: an inverted-hull outline pushes the back faces out
// along their normals (#206). The pages draw the shells double-sided, so the winding doesn't change their look.
describe('shell winding', () => {
  const grey = new THREE.Color(0.5, 0.5, 0.5);
  const colours = () => ({ wall: grey, wallFoot: grey, roof: grey });
  const flat = { p: square(0, 0, 10), h: 5, k: BuildingKind.OTHER };
  const reversed = { ...flat, p: [0, 0, 0, 10, 10, 10, 10, 0] };
  const pitched = { ...flat, g: [0, 5, 10, 5, 5] as [number, number, number, number, number] };
  const spire = { ...flat, s: 8 };

  it.each([
    ['a flat roof', flat],
    ['a footprint listed the other way round', reversed],
    ['a pitched roof', pitched],
    ['a spire', spire],
  ])('every triangle faces out of the building, with %s', (_, building) => {
    const world = makeWorld({ b: [building] });
    const mesh = new PaintedBuildingShells(world, new Heightfield(world), {
      material: new THREE.MeshBasicMaterial(),
      colours,
    }).mesh;
    const positions = mesh.geometry.getAttribute('position');
    const centre = new THREE.Vector3(5, 0, 5);
    const corner1 = new THREE.Vector3();
    const corner2 = new THREE.Vector3();
    const corner3 = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const middle = new THREE.Vector3();
    const inwardTriangles: number[] = [];
    for (let i = 0; i < positions.count; i += 3) {
      corner1.fromBufferAttribute(positions, i);
      corner2.fromBufferAttribute(positions, i + 1);
      corner3.fromBufferAttribute(positions, i + 2);
      THREE.Triangle.getNormal(corner1, corner2, corner3, normal);
      middle.copy(corner1).add(corner2).add(corner3).divideScalar(3);
      // walls point away from the footprint's centre; roofs and spires point up
      const outwardness = Math.abs(normal.y) < 0.5 ? normal.dot(middle.sub(centre).setY(0)) : normal.y;
      if (!(outwardness > 0)) inwardTriangles.push(i / 3);
    }
    expect(inwardTriangles).toEqual([]);
    mesh.geometry.dispose();
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
