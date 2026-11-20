import '../three-legacy';
import * as THREE from 'three';
import { RoadClass, Surface, type WorldData } from '../data';
import type { Heightfield } from '../heightfield';
import { pointInPolygon } from '../polygon';
import { roadLiftM } from '../roads';
import {
  cutToTerrain,
  type GridLike,
  Part,
  SKIRT_BELOW_M,
  SOURCES,
  type Soup,
  type StreetscapeLayout,
} from '../streetscape';
import { batchByChunk, partColour, SOURCE_TINTS, STREETSCAPE_COLOURS, type StreetscapeColours } from './sidewalk-mesh';

export interface ParkingMeshOptions {
  /** a vertex-coloured material, FrontSide; it stays the caller's */
  surface: THREE.Material;
  /** the stall lines' paint; it stays the caller's */
  markings: THREE.Material;
  colours?: StreetscapeColours;
  debugSources?: boolean;
}

/**
 * Parking-area surfaces cut to the terrain, so they lie on the ground whatever their size, at the height of a service
 * road so aisles and driveways meet them flush; their holes kept; a skirt round every ring; and stall lines. One
 * surface and one markings mesh per populated chunk. Adds nothing to a scene; `dispose()` frees its geometries.
 */
export class ParkingMesh {
  readonly meshes: THREE.Mesh[] = [];
  /** the surface triangles, for tests and the map */
  readonly soup: Soup;

  constructor(
    layout: Pick<StreetscapeLayout, 'lots' | 'lotMarkings'>,
    data: Pick<WorldData, 'pa'>,
    heightfield: Pick<Heightfield, 'heightAt'> & GridLike,
    { surface, markings, colours = STREETSCAPE_COLOURS, debugSources = false }: ParkingMeshOptions,
  ) {
    this.soup = parkingSurfaces(layout, data, heightfield);
    const s = this.soup;
    const linear = (srgb: number) => new THREE.Color(srgb).convertSRGBToLinear();
    const cache = new Map<string, THREE.Color>();
    this.meshes.push(
      ...batchByChunk(s, surface, (t, out) => {
        const key = s.part[t] + ':' + s.surface[t] + ':' + s.src[t];
        let c = cache.get(key);
        if (!c) {
          c = linear(debugSources ? SOURCE_TINTS[s.src[t]] : partColour(colours, Part.PARKING, s.surface[t]));
          if (s.part[t] === Part.SKIRT) c.multiplyScalar(0.8);
          cache.set(key, c);
        }
        out.copy(c);
      }),
    );
    for (const m of batchByChunk(layout.lotMarkings, markings, null)) {
      m.renderOrder = 9;
      this.meshes.push(m);
    }
  }

  dispose() {
    for (const mesh of this.meshes) mesh.geometry.dispose();
  }
}

/** The parking areas' surface and skirt triangles, wound outward. */
export function parkingSurfaces(
  layout: Pick<StreetscapeLayout, 'lots'>,
  data: Pick<WorldData, 'pa'>,
  heightfield: Pick<Heightfield, 'heightAt'> & GridLike,
): Soup {
  const out: Soup = { pos: [], part: [], src: [], surface: [], tone: [] };
  const lift = roadLiftM(RoadClass.SERVICE);
  const v2 = (p: number[]) => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < p.length; i += 2) pts.push(new THREE.Vector2(p[i], p[i + 1]));
    return pts;
  };
  for (const lot of layout.lots) {
    const a = data.pa![lot.ai];
    const sf = a.sf ?? Surface.UNKNOWN;
    const src = SOURCES.indexOf(lot.source);
    const contour = v2(a.p);
    const holes = (a.h ?? []).map(v2);
    const all = [...contour, ...holes.flat()];
    const flat: number[] = [];
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holes))
      flat.push(all[i].x, all[i].y, all[j].x, all[j].y, all[k].x, all[k].y);
    const cut = cutToTerrain(flat, heightfield);
    for (let t = 0; t < cut.length; t += 6) {
      const v = [0, 2, 4].map(o => [
        cut[t + o],
        heightfield.heightAt(cut[t + o], cut[t + o + 1]) + lift,
        cut[t + o + 1],
      ]);
      // wind up: (b - a) × (c - a) has +y when the triangle runs counter-clockwise seen from above
      const cross = (v[1][0] - v[0][0]) * (v[2][2] - v[0][2]) - (v[1][2] - v[0][2]) * (v[2][0] - v[0][0]);
      const [p, q, r] = cross < 0 ? [v[0], v[1], v[2]] : [v[0], v[2], v[1]];
      out.pos.push(...p, ...q, ...r);
      out.part.push(Part.PARKING);
      out.src.push(src);
      out.surface.push(sf);
      out.tone.push(0);
    }
    const onSurface = (x: number, z: number) =>
      pointInPolygon(a.p, x, z) && !(a.h ?? []).some(h => pointInPolygon(h, x, z));
    for (const ring of [a.p, ...(a.h ?? [])]) {
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const pts = splitAtTerrain(ring[j], ring[j + 1], ring[i], ring[i + 1], heightfield);
        for (let k = 1; k < pts.length; k++) {
          const [ax, az] = pts[k - 1];
          const [bx, bz] = pts[k];
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 1e-6) continue;
          let nx = (bz - az) / len;
          let nz = -(bx - ax) / len;
          // outward is away from the parking surface
          if (onSurface((ax + bx) / 2 + nx * 0.05, (az + bz) / 2 + nz * 0.05)) {
            nx = -nx;
            nz = -nz;
          }
          const top = (x: number, z: number) => [x, heightfield.heightAt(x, z) + lift, z];
          const bottom = (x: number, z: number) => [x, heightfield.heightAt(x, z) - SKIRT_BELOW_M, z];
          const quad = [top(ax, az), bottom(ax, az), bottom(bx, bz), top(bx, bz)];
          for (const [p, q, r] of [
            [quad[0], quad[1], quad[2]],
            [quad[0], quad[2], quad[3]],
          ]) {
            const ux = q[0] - p[0],
              uy = q[1] - p[1],
              uz = q[2] - p[2],
              wx = r[0] - p[0],
              wy = r[1] - p[1],
              wz = r[2] - p[2];
            const cx = uy * wz - uz * wy;
            const cz = ux * wy - uy * wx;
            const flip = cx * nx + cz * nz < 0;
            out.pos.push(...p, ...(flip ? r : q), ...(flip ? q : r));
            out.part.push(Part.SKIRT);
            out.src.push(src);
            out.surface.push(sf);
            out.tone.push(0);
          }
        }
      }
    }
  }
  return out;
}

/** The segment split wherever it crosses a terrain triangle's edge, so a skirt's top follows the cut surface exactly. */
function splitAtTerrain(ax: number, az: number, bx: number, bz: number, grid: GridLike): [number, number][] {
  const x0 = grid.sampleCoord(0);
  const cell = grid.sampleCoord(1) - x0;
  const ua = (ax - x0) / cell,
    va = (az - x0) / cell,
    ub = (bx - x0) / cell,
    vb = (bz - x0) / cell;
  const ts = new Set<number>([0, 1]);
  const cross = (fa: number, fb: number) => {
    for (let k = Math.ceil(Math.min(fa, fb)); k <= Math.floor(Math.max(fa, fb)); k++)
      if (fa !== fb) ts.add((k - fa) / (fb - fa));
  };
  cross(ua, ub);
  cross(va, vb);
  cross(ua + va, ub + vb);
  return [...ts]
    .filter(t => t >= 0 && t <= 1)
    .sort((p, q) => p - q)
    .map(t => [ax + (bx - ax) * t, az + (bz - az) * t]);
}
