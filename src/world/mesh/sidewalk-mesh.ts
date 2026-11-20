import '../three-legacy';
import * as THREE from 'three';
import { Surface } from '../data';
import { Part, type Soup, type StreetscapeLayout } from '../streetscape';
import { TILE_M } from './road-ribbons';

/** sRGB colours of the streetscape, by part and surface; warm late-summer greys (#187 §9) */
export interface StreetscapeColours {
  concrete: number;
  paving: number;
  asphalt: number;
  gravel: number;
  curbTop: number;
  curbFace: number;
  verge: number;
  /** the corner wedges and street-side bays, at road level */
  road: number;
}

export const STREETSCAPE_COLOURS: StreetscapeColours = {
  concrete: 0xb9b2a6,
  paving: 0xc2b39f,
  asphalt: 0x8d8a84,
  gravel: 0xb3a78c,
  curbTop: 0xc7c1b6,
  curbFace: 0x8f8a82,
  verge: 0x9db87a,
  road: 0x606365,
};

/** debug tints by source: mapped, derived, inferred */
export const SOURCE_TINTS = [0x3fae5a, 0xe0b23a, 0xd0533f] as const;

/** side of a batching chunk (m), the same chunking as #121 */
const CHUNK_M = 250;
/** the strongest per-strip lightness variation, as a share (±) */
const TONE_SHARE = 0.03;

export interface SidewalkMeshOptions {
  /** `streetscape-surface`: a vertex-coloured material, FrontSide; it stays the caller's */
  surface: THREE.Material;
  /** `streetscape-markings`: a light paint colour; it stays the caller's */
  markings: THREE.Material;
  colours?: StreetscapeColours;
  /** tint every triangle by its evidence (mapped, derived, inferred) instead of its material: the ?debug=streetscape view */
  debugSources?: boolean;
  /**
   * the road ribbons' materials by RoadClass (RoadRibbons.materials), for the corner wedges and street-side bays; they
   * stay the caller's. Without one, a class's patches take the flat `road` colour.
   */
  roadMaterials?: readonly (THREE.Material | undefined)[];
}

/** The colour of a triangle of the streetscape surface, sRGB. */
export function partColour(c: StreetscapeColours, part: Part, surface: Surface) {
  if (part === Part.CURB_FACE) return c.curbFace;
  if (part === Part.CURB_TOP) return c.curbTop;
  if (part === Part.VERGE) return c.verge;
  if (part === Part.ROAD) return c.road;
  if (part === Part.PARKING && (surface === Surface.ASPHALT || surface === Surface.UNKNOWN)) return c.road;
  if (surface === Surface.PAVING) return c.paving;
  if (surface === Surface.ASPHALT) return c.asphalt;
  if (surface === Surface.GRAVEL || surface === Surface.UNPAVED) return c.gravel;
  if (surface === Surface.GRASS) return c.verge;
  return c.concrete;
}

/**
 * Batches a triangle soup into one mesh per `chunkM` chunk, in chunk-local coordinates (each mesh is positioned at its
 * chunk's corner), by each triangle's centroid; an infinite `chunkM` makes one mesh. `colour` gives a triangle's linear
 * RGB, or null for no colour attribute.
 */
export function batchByChunk(
  soup: Soup,
  material: THREE.Material,
  colour: ((t: number, out: THREE.Color) => void) | null,
  chunkM = CHUNK_M,
) {
  const chunks = new Map<string, number[]>();
  const n = soup.part.length;
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const cx = Number.isFinite(chunkM) ? Math.floor((soup.pos[o] + soup.pos[o + 3] + soup.pos[o + 6]) / 3 / chunkM) : 0;
    const cz = Number.isFinite(chunkM)
      ? Math.floor((soup.pos[o + 2] + soup.pos[o + 5] + soup.pos[o + 8]) / 3 / chunkM)
      : 0;
    const k = cx + ',' + cz;
    let list = chunks.get(k);
    if (!list) {
      list = [];
      chunks.set(k, list);
    }
    list.push(t);
  }
  const meshes: THREE.Mesh[] = [];
  const c = new THREE.Color();
  for (const [k, list] of [...chunks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const [cx, cz] = k.split(',').map(Number);
    const ox = cx * (Number.isFinite(chunkM) ? chunkM : 0);
    const oz = cz * (Number.isFinite(chunkM) ? chunkM : 0);
    const pos = new Float32Array(list.length * 9);
    const col = colour ? new Float32Array(list.length * 9) : null;
    list.forEach((t, i) => {
      const o = t * 9;
      for (let v = 0; v < 3; v++) {
        pos[i * 9 + v * 3] = soup.pos[o + v * 3] - ox;
        pos[i * 9 + v * 3 + 1] = soup.pos[o + v * 3 + 1];
        pos[i * 9 + v * 3 + 2] = soup.pos[o + v * 3 + 2] - oz;
      }
      if (col && colour) {
        colour(t, c);
        for (let v = 0; v < 3; v++) col.set([c.r, c.g, c.b], i * 9 + v * 3);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set(ox, 0, oz);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    meshes.push(mesh);
  }
  return meshes;
}

/**
 * Curbs, sidewalks, verges, corners and road markings from a streetscape layout: one surface mesh and one markings mesh
 * per populated chunk. Adds nothing to a scene. `dispose()` frees the geometries it made; the materials stay the
 * caller's. Not flagged for the cel-shaded ink (#207): no outlines round every slab.
 */
export class SidewalkMesh {
  readonly meshes: THREE.Mesh[] = [];

  constructor(
    layout: Pick<StreetscapeLayout, 'surface' | 'roadPatches' | 'markings'>,
    { surface, markings, colours = STREETSCAPE_COLOURS, debugSources = false, roadMaterials = [] }: SidewalkMeshOptions,
  ) {
    const s = layout.surface;
    const lin = new Map<number, THREE.Color>();
    const linear = (srgb: number) => {
      let v = lin.get(srgb);
      if (!v) {
        v = new THREE.Color(srgb).convertSRGBToLinear();
        lin.set(srgb, v);
      }
      return v;
    };
    this.meshes.push(
      ...batchByChunk(s, surface, (t, out) => {
        if (debugSources) {
          out.copy(linear(SOURCE_TINTS[s.src[t]]));
          if (s.part[t] === Part.CURB_FACE || s.part[t] === Part.SKIRT) out.multiplyScalar(0.7);
          return;
        }
        out.copy(linear(partColour(colours, s.part[t], s.surface[t])));
        if (s.part[t] !== Part.ROAD) out.multiplyScalar(1 + s.tone[t] * TONE_SHARE);
      }),
    );
    layout.roadPatches.forEach((patch, c) => {
      if (!patch.part.length) return;
      const material = roadMaterials[c];
      if (!material) {
        this.meshes.push(...batchByChunk(patch, surface, (_, out) => out.copy(linear(colours.road)), Infinity));
        return;
      }
      // the ribbon's own material: UVs in the same TILE_M scale, so the asphalt speckle matches. Patches are small and
      // few, so one mesh per class, as the ribbons have
      for (const m of batchByChunk(patch, material, null, Infinity)) {
        const pos = m.geometry.getAttribute('position');
        const uv = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i++) {
          uv[i * 2] = (pos.getX(i) + m.position.x) / TILE_M;
          uv[i * 2 + 1] = (pos.getZ(i) + m.position.z) / TILE_M;
        }
        m.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        m.renderOrder = 6 - c;
        this.meshes.push(m);
      }
    });
    for (const m of batchByChunk(layout.markings, markings, null)) {
      m.receiveShadow = true;
      m.renderOrder = 9;
      this.meshes.push(m);
    }
  }

  dispose() {
    for (const mesh of this.meshes) mesh.geometry.dispose();
  }
}
