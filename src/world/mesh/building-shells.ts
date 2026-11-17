import '../three-legacy';
import * as THREE from 'three';
import { type BuildingShape, forEachBuilding } from '../buildings';
import type { Building, WorldData } from '../data';
import type { Heightfield } from '../heightfield';

// Walls, roofs and spires of every building. The pages build them differently: the game paints each house in one
// mesh with vertex colours, the map groups them by material so a theme change only recolours the materials.

type Surface = 'wallFoot' | 'wallTop' | 'roof';

/** Emits the shell's triangles, three vertices each: walls, then the roof, then the spire. */
function eachShellVertex(shape: BuildingShape, emit: (x: number, y: number, z: number, surface: Surface) => void) {
  const { ring, yAt, sides, outline, base, top } = shape;
  const m = ring.length;
  for (let i = 0; i < m; i++) {
    const a = ring[i];
    const d = ring[(i + 1) % m];
    const ta = yAt(a);
    const td = yAt(d);
    emit(a.x, base, a.z, 'wallFoot');
    emit(d.x, base, d.z, 'wallFoot');
    emit(d.x, td, d.z, 'wallTop');
    emit(a.x, base, a.z, 'wallFoot');
    emit(d.x, td, d.z, 'wallTop');
    emit(a.x, ta, a.z, 'wallTop');
  }
  for (const side of sides) {
    // triangulateShape wants { x, y } points, and drops a closing point that repeats the first
    const flat = side.map((v) => new THREE.Vector2(v.x, v.z));
    for (const face of THREE.ShapeUtils.triangulateShape(flat, [])) {
      for (const i of face) emit(side[i].x, yAt(side[i]), side[i].z, 'roof');
    }
  }
  const spire = shape.building.s;
  if (spire) {
    const n = outline.length;
    let cx = 0;
    let cz = 0;
    for (const v of outline) {
      cx += v.x / n;
      cz += v.z / n;
    }
    for (let i = 0; i < n; i++) {
      const a = outline[i];
      const d = outline[(i + 1) % n];
      emit(a.x, top, a.z, 'roof');
      emit(d.x, top, d.z, 'roof');
      emit(cx, top + spire, cz, 'roof');
    }
  }
}

const shellMesh = (positions: number[], material: THREE.Material, colours?: number[]) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colours) g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

export interface ShellColours {
  /** wall colour at the top; `wallFoot` at the ground, so walls darken towards it */
  wall: THREE.Color;
  wallFoot: THREE.Color;
  roof: THREE.Color;
}

/** Adds one vertex to the painted shell mesh; every three make a triangle. */
export type EmitVertex = (x: number, y: number, z: number, colour: THREE.Color) => void;

export interface PaintedShellOptions {
  /** a material with `vertexColors` on */
  material: THREE.Material;
  /** called once per building, in `data.b` order, before its shell is built; the colours are read before the next call, so it may reuse them */
  colours: (shape: BuildingShape) => ShellColours;
  /** called after each building's shell, to add triangles to the same mesh (a chimney) or build details of its own */
  extra?: (shape: BuildingShape, emit: EmitVertex) => void;
}

/**
 * Every building's shell in one mesh, coloured per vertex. Adds nothing to a scene. `dispose()` frees the geometry it
 * made; the material stays the caller's.
 */
export class PaintedBuildingShells {
  readonly mesh: THREE.Mesh;

  constructor(data: WorldData, heightfield: Pick<Heightfield, 'heightAt'>, { material, colours, extra }: PaintedShellOptions) {
    const positions: number[] = [];
    const vertexColours: number[] = [];
    const emit: EmitVertex = (x, y, z, c) => {
      positions.push(x, y, z);
      vertexColours.push(c.r, c.g, c.b);
    };
    forEachBuilding(data, heightfield, (shape) => {
      const paint = colours(shape);
      eachShellVertex(shape, (x, y, z, surface) => {
        emit(x, y, z, surface === 'roof' ? paint.roof : surface === 'wallTop' ? paint.wall : paint.wallFoot);
      });
      extra?.(shape, emit);
    });
    this.mesh = shellMesh(positions, material, vertexColours);
  }

  dispose() {
    this.mesh.geometry.dispose();
  }
}

export interface ShellsByMaterialOptions<K extends string> {
  materials: Record<K, THREE.Material>;
  /** the keys of the materials for a building's walls and for its roof and spire */
  materialsFor: (building: Building) => { walls: K; roof: K };
}

/**
 * Every building's shell, one mesh per material. Adds nothing to a scene. `dispose()` frees the geometry it made; the
 * materials stay the caller's.
 */
export class BuildingShellsByMaterial<K extends string> {
  /** one mesh per material, in the order of the `materials` keys, also when no building uses it */
  readonly meshes: THREE.Mesh[];

  constructor(data: WorldData, heightfield: Pick<Heightfield, 'heightAt'>, { materials, materialsFor }: ShellsByMaterialOptions<K>) {
    const keys = Object.keys(materials) as K[];
    const buffers = {} as Record<K, number[]>;
    for (const k of keys) buffers[k] = [];
    forEachBuilding(data, heightfield, (shape) => {
      const { walls, roof } = materialsFor(shape.building);
      eachShellVertex(shape, (x, y, z, surface) => buffers[surface === 'roof' ? roof : walls].push(x, y, z));
    });
    this.meshes = keys.map((k) => shellMesh(buffers[k], materials[k]));
  }

  dispose() {
    for (const mesh of this.meshes) mesh.geometry.dispose();
  }
}
