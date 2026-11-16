import type { Building, WorldData } from './data';
import type { Heightfield } from './heightfield';
import { type Bounds, pointInPolygon, polygonBounds, segmentParam, signedPolygonArea } from './polygon';

export interface PointXZ {
  x: number;
  z: number;
}

/** roof rise per metre of the ridge's half width, and the most a roof rises (m) */
const ROOF_PITCH = 0.7;
const MAX_ROOF_RISE_M = 5;
/** walls start this far below the lowest corner, so no gap shows under them on a slope (m) */
const WALL_FOOT_BELOW_GROUND_M = 1;

export interface RoofParts {
  /** the outline, with a corner added wherever it crosses the ridge */
  ring: PointXZ[];
  /** height of the wall top, which is the roof's edge, at a point on the ring (m) */
  yAt: (v: PointXZ) => number;
  /** the roof's faces: the flat roof, or the two halves either side of the ridge */
  sides: PointXZ[][];
}

/**
 * Walls and roof halves of an outline. A pitched roof (`ridge`, over the bounding rectangle) is cut to the outline,
 * which gets a corner wherever it crosses the ridge.
 */
export function roofParts(outline: PointXZ[], ridge: Building['g'], top: number): RoofParts {
  if (!ridge) return { ring: outline, yAt: () => top, sides: [outline] };
  const [ax, az, bx, bz, halfWidth] = ridge;
  const length = Math.hypot(bx - ax, bz - az);
  const nx = (az - bz) / length;
  const nz = (bx - ax) / length;
  const rise = Math.min(halfWidth * ROOF_PITCH, MAX_ROOF_RISE_M);
  const offset = (v: PointXZ) => (v.x - ax) * nx + (v.z - az) * nz;
  const yAt = (v: PointXZ) => top + rise * Math.max(0, 1 - Math.abs(offset(v)) / halfWidth);
  const ring: PointXZ[] = [];
  const offsets: number[] = [];
  outline.forEach((a, i) => {
    const d = outline[(i + 1) % outline.length];
    const oa = offset(a);
    const od = offset(d);
    ring.push(a);
    offsets.push(oa);
    if (oa * od < 0) {
      const t = oa / (oa - od);
      ring.push({ x: a.x + (d.x - a.x) * t, z: a.z + (d.z - a.z) * t });
      offsets.push(0);
    }
  });
  const sides = [1, -1].map((s) => ring.filter((_, i) => s * offsets[i] >= 0)).filter((side) => side.length > 2);
  return { ring, yAt, sides };
}

/** One building as the meshes need it: its outline on the terrain, wall heights and roof. */
export interface BuildingShape extends RoofParts {
  building: Building;
  /** the footprint's corners, in data order */
  outline: PointXZ[];
  /** lowest and highest ground under the corners (m) */
  lo: number;
  hi: number;
  /** foot and top of the walls (m) */
  base: number;
  top: number;
  /** footprint area (m²) */
  area: number;
  /** +1 or -1 with the outline's winding, to find the outside of each wall */
  winding: number;
}

/** Calls `visit` once per building, in `data.b` order, so a caller that rolls dice per building rolls them in that order. */
export function forEachBuilding(data: WorldData, heightfield: Pick<Heightfield, 'heightAt'>, visit: (shape: BuildingShape) => void) {
  for (const building of data.b) {
    const p = building.p;
    const n = p.length / 2;
    const outline: PointXZ[] = [];
    let lo = 1e9;
    let hi = -1e9;
    for (let i = 0; i < n; i++) {
      const x = p[i * 2];
      const z = p[i * 2 + 1];
      const h = heightfield.heightAt(x, z);
      outline.push({ x, z });
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    const base = lo - WALL_FOOT_BELOW_GROUND_M;
    const top = hi + building.h;
    const signedArea = signedPolygonArea(p);
    visit({
      building,
      outline,
      lo,
      hi,
      base,
      top,
      area: Math.abs(signedArea),
      winding: Math.sign(signedArea),
      ...roofParts(outline, building.g, top),
    });
  }
}

export interface Footprint extends Bounds {
  p: number[];
}

/** side of a collision cell (m) */
export const BUILDING_CELL_M = 40;

/** Building footprints, a grid over them, and collision against them. */
export class BuildingIndex {
  readonly footprints: Footprint[] = [];
  /** each cell lists the indices of the footprints whose bounding box touches it */
  readonly grid = new Map<string, number[]>();

  constructor(data: WorldData) {
    for (const b of data.b) this.addFootprint(b.p);
  }

  /** Adds an outline that things collide with; returns its index in `footprints`. */
  addFootprint(p: number[]) {
    const { x0, x1, z0, z1 } = polygonBounds(p);
    const index = this.footprints.length;
    this.footprints.push({ p, x0, x1, z0, z1 });
    for (let x = Math.floor(x0 / BUILDING_CELL_M); x <= Math.floor(x1 / BUILDING_CELL_M); x++) {
      for (let z = Math.floor(z0 / BUILDING_CELL_M); z <= Math.floor(z1 / BUILDING_CELL_M); z++) {
        const k = x + ',' + z;
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(index);
      }
    }
    return index;
  }

  /** Pushes the circle `o` (radius r, m) out of any footprint it overlaps. True on contact. */
  collide(o: { x: number; z: number }, r: number) {
    let hit = false;
    for (let gx = Math.floor((o.x - r) / BUILDING_CELL_M); gx <= Math.floor((o.x + r) / BUILDING_CELL_M); gx++) {
      for (let gz = Math.floor((o.z - r) / BUILDING_CELL_M); gz <= Math.floor((o.z + r) / BUILDING_CELL_M); gz++) {
        const list = this.grid.get(gx + ',' + gz);
        if (!list) continue;
        for (const bi of list) {
          const b = this.footprints[bi];
          if (o.x < b.x0 - r || o.x > b.x1 + r || o.z < b.z0 - r || o.z > b.z1 + r) continue;
          const p = b.p;
          let best = 1e9;
          let qx = 0;
          let qz = 0;
          for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
            const t = segmentParam(o.x, o.z, p[j], p[j + 1], p[i], p[i + 1]);
            const cx = p[j] + (p[i] - p[j]) * t;
            const cz = p[j + 1] + (p[i + 1] - p[j + 1]) * t;
            const d = Math.hypot(o.x - cx, o.z - cz);
            if (d < best) {
              best = d;
              qx = cx;
              qz = cz;
            }
          }
          const inside = pointInPolygon(p, o.x, o.z);
          if (!inside && best >= r) continue;
          let nx = o.x - qx;
          let nz = o.z - qz;
          const length = Math.hypot(nx, nz) || 1;
          nx /= length;
          nz /= length;
          if (inside) {
            nx = -nx;
            nz = -nz;
          }
          o.x = qx + nx * r;
          o.z = qz + nz * r;
          hit = true;
        }
      }
    }
    return hit;
  }
}
