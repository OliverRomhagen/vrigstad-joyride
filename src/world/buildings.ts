import type { WorldData } from './data';
import { type Bounds, pointInPolygon, polygonBounds, segmentParam } from './polygon';

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
