import { RoadClass, ROAD_WIDTH_M, type WorldData } from './data';
import type { Heightfield } from './heightfield';
import { segmentDistance } from './polygon';

export type Point = [x: number, z: number];

export interface RoadLine {
  p: Point[];
  c: RoadClass;
  n: string;
}

export interface NearestRoad {
  /** distance to the road's edge (m), negative when on it */
  d: number;
  /** index into `lines`, -1 when no road is near */
  ri: number;
}

/** side of a lookup cell (m) */
export const ROAD_CELL_M = 50;
/** how far past a segment's bounding box it is still filed in a cell (m) */
const CELL_MARGIN_M = 14;

/** how high the primary road's ribbon sits above the terrain (m) */
const ROAD_LIFT_M = 0.25;
/** how much lower each smaller class's ribbon sits than the one above it (m) */
const ROAD_LIFT_STEP_M = 0.03;

/** Height of each road class's ribbon above the terrain (m); groundAt puts people and cars on top of it. */
export const roadLiftM = (c: RoadClass) => ROAD_LIFT_M - c * ROAD_LIFT_STEP_M;

/** Key of a junction: road vertices within half a metre of each other share one. */
export const nodeKey = (p: Point) => Math.round(p[0] * 2) + ',' + Math.round(p[1] * 2);

const cellKey = (x: number, z: number) => Math.floor(x / ROAD_CELL_M) + ',' + Math.floor(z / ROAD_CELL_M);

/** The road network, a lookup grid over it and the junction graph that traffic drives. */
export class RoadNetwork {
  readonly lines: RoadLine[];
  /** each cell lists the segments near it, five numbers a segment: ax, az, bx, bz, road index */
  readonly grid = new Map<string, number[]>();
  /** junctions as [road, vertex, road, vertex, ...], by nodeKey */
  readonly junctions = new Map<string, number[]>();
  /** indices of the roads traffic drives on: streets and bigger */
  readonly driveable: number[] = [];
  private readonly heightfield: Pick<Heightfield, 'heightAt'>;
  private readonly near: NearestRoad = { d: 1e9, ri: -1 };

  constructor(data: WorldData, heightfield: Pick<Heightfield, 'heightAt'>) {
    this.heightfield = heightfield;
    this.lines = data.r.map((r) => {
      const p: Point[] = [];
      for (let i = 0; i < r.p.length; i += 2) p.push([r.p[i], r.p[i + 1]]);
      return { p, c: r.c, n: r.n };
    });

    this.lines.forEach((r, ri) => {
      for (let i = 1; i < r.p.length; i++) {
        const a = r.p[i - 1];
        const b = r.p[i];
        const x0 = Math.floor((Math.min(a[0], b[0]) - CELL_MARGIN_M) / ROAD_CELL_M);
        const x1 = Math.floor((Math.max(a[0], b[0]) + CELL_MARGIN_M) / ROAD_CELL_M);
        const z0 = Math.floor((Math.min(a[1], b[1]) - CELL_MARGIN_M) / ROAD_CELL_M);
        const z1 = Math.floor((Math.max(a[1], b[1]) + CELL_MARGIN_M) / ROAD_CELL_M);
        for (let x = x0; x <= x1; x++) {
          for (let z = z0; z <= z1; z++) {
            const k = x + ',' + z;
            let list = this.grid.get(k);
            if (!list) this.grid.set(k, (list = []));
            list.push(a[0], a[1], b[0], b[1], ri);
          }
        }
      }
    });

    this.lines.forEach((r, ri) => {
      if (r.c > RoadClass.STREET || r.p.length < 2) return;
      this.driveable.push(ri);
      r.p.forEach((p, vi) => {
        const k = nodeKey(p);
        let list = this.junctions.get(k);
        if (!list) this.junctions.set(k, (list = []));
        list.push(ri, vi);
      });
    });
  }

  /**
   * The nearest road within the cell around (x, z), written into `near`. Without one, every call returns the same
   * object: copy what you keep.
   */
  nearestRoad(x: number, z: number, near = this.near) {
    near.d = 1e9;
    near.ri = -1;
    const list = this.grid.get(cellKey(x, z));
    if (list) {
      for (let i = 0; i < list.length; i += 5) {
        const d = segmentDistance(x, z, list[i], list[i + 1], list[i + 2], list[i + 3]) - ROAD_WIDTH_M[this.lines[list[i + 4]].c] / 2;
        if (d < near.d) {
          near.d = d;
          near.ri = list[i + 4];
        }
      }
    }
    return near;
  }

  /** Terrain plus the highest road ribbon at (x, z), eased out over the metre past its edge so nothing snaps at the kerb. */
  groundAt(x: number, z: number) {
    let lift = 0;
    const list = this.grid.get(cellKey(x, z));
    if (list) {
      for (let i = 0; i < list.length; i += 5) {
        const c = this.lines[list[i + 4]].c;
        const d = segmentDistance(x, z, list[i], list[i + 1], list[i + 2], list[i + 3]) - ROAD_WIDTH_M[c] / 2;
        if (d < 1) lift = Math.max(lift, roadLiftM(c) * Math.min(1, 1 - d));
      }
    }
    return this.heightfield.heightAt(x, z) + lift;
  }
}
