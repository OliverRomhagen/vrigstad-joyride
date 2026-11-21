import '../three-legacy';
import * as THREE from 'three';
import { type BuildingShape, forEachBuilding } from '../buildings';
import type { Building, WorldData } from '../data';
import type { Heightfield } from '../heightfield';

// Walls, roofs and spires of every building. The pages build them differently: the game paints each house in one
// mesh with vertex colours, the map groups them by material so a theme change only recolours the materials.

type Surface = 'wallFoot' | 'wallTop' | 'roof';

/**
 * The footprint's points counter-clockwise on a north-up map (x east, z south), the order that puts each wall's outside
 * on the right as you walk it, so a wall drawn from one point to the next, then up, faces out.
 */
const counterClockwise = <T>(points: T[], winding: number) => (winding > 0 ? [...points].reverse() : points);

/**
 * Emits the shell's triangles, three vertices each: walls, then the roof, then the spire. Front faces point out of the
 * building, whichever way round the footprint is listed: an inverted-hull outline needs that (#206).
 */
function eachShellVertex(shape: BuildingShape, emit: (x: number, y: number, z: number, surface: Surface) => void) {
  const { ring, yAt, sides, outline, base, top, winding } = shape;
  const corners = counterClockwise(ring, winding);
  const m = corners.length;
  for (let i = 0; i < m; i++) {
    const start = corners[i];
    const end = corners[(i + 1) % m];
    const startTop = yAt(start);
    const endTop = yAt(end);
    emit(start.x, base, start.z, 'wallFoot');
    emit(end.x, base, end.z, 'wallFoot');
    emit(end.x, endTop, end.z, 'wallTop');
    emit(start.x, base, start.z, 'wallFoot');
    emit(end.x, endTop, end.z, 'wallTop');
    emit(start.x, startTop, start.z, 'wallTop');
  }
  for (const side of sides) {
    // triangulateShape wants { x, y } points, and drops a closing point that repeats the first
    const flat = side.map(v => new THREE.Vector2(v.x, v.z));
    // triangulateShape's faces come out facing down either way round, so take each one backwards
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(flat, [])) {
      emit(side[k].x, yAt(side[k]), side[k].z, 'roof');
      emit(side[j].x, yAt(side[j]), side[j].z, 'roof');
      emit(side[i].x, yAt(side[i]), side[i].z, 'roof');
    }
  }
  const spire = shape.building.s;
  if (spire) {
    const rim = counterClockwise(outline, winding);
    const n = rim.length;
    let cx = 0;
    let cz = 0;
    for (const v of outline) {
      cx += v.x / n;
      cz += v.z / n;
    }
    for (let i = 0; i < n; i++) {
      const start = rim[i];
      const end = rim[(i + 1) % n];
      emit(start.x, top, start.z, 'roof');
      emit(end.x, top, end.z, 'roof');
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

  constructor(
    data: WorldData,
    heightfield: Pick<Heightfield, 'heightAt'>,
    { material, colours, extra }: PaintedShellOptions,
  ) {
    const positions: number[] = [];
    const vertexColours: number[] = [];
    const emit: EmitVertex = (x, y, z, c) => {
      positions.push(x, y, z);
      vertexColours.push(c.r, c.g, c.b);
    };
    forEachBuilding(data, heightfield, shape => {
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

  constructor(
    data: WorldData,
    heightfield: Pick<Heightfield, 'heightAt'>,
    { materials, materialsFor }: ShellsByMaterialOptions<K>,
  ) {
    const keys = Object.keys(materials) as K[];
    const buffers = {} as Record<K, number[]>;
    for (const k of keys) buffers[k] = [];
    forEachBuilding(data, heightfield, shape => {
      const { walls, roof } = materialsFor(shape.building);
      eachShellVertex(shape, (x, y, z, surface) => buffers[surface === 'roof' ? roof : walls].push(x, y, z));
    });
    this.meshes = keys.map(k => shellMesh(buffers[k], materials[k]));
  }

  dispose() {
    for (const mesh of this.meshes) mesh.geometry.dispose();
  }
}
