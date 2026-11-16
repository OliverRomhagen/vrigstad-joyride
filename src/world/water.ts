import { WaterwayKind, type WorldData } from './data';
import { type Bounds, pointInPolygon, polygonBounds, segmentDistance } from './polygon';
import type { NearestRoad, Roads } from './roads';

/** half the width of a river, as the game treats it (m) */
const RIVER_HALF_WIDTH_M = 2.6;
/** a road within this distance of its edge is a bridge over the water (m) */
const BRIDGE_REACH_M = 1;

/** Lakes and rivers, for asking whether a point is in water. */
export function createWater(data: WorldData, nearestRoad: Roads['nearestRoad']) {
  const lakes = data.w.map((rings) => {
    const bounds: Bounds = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
    for (const r of rings) polygonBounds(r, bounds);
    return { rings, ...bounds };
  });
  const rivers = data.ww.filter((w) => w.k === WaterwayKind.RIVER);
  const near: NearestRoad = { d: 1e9, ri: -1 };

  function overWater(x: number, z: number) {
    for (const l of lakes) {
      if (x < l.x0 || x > l.x1 || z < l.z0 || z > l.z1) continue;
      // islands are rings too: inside an odd number of rings is water
      let inside = false;
      for (const r of l.rings) if (pointInPolygon(r, x, z)) inside = !inside;
      if (inside) return true;
    }
    for (const w of rivers) {
      for (let i = 2; i < w.p.length; i += 2) {
        if (segmentDistance(x, z, w.p[i - 2], w.p[i - 1], w.p[i], w.p[i + 1]) < RIVER_HALF_WIDTH_M) return true;
      }
    }
    return false;
  }

  /** True over a lake or a river, unless a road crosses there as a bridge. */
  function inWater(x: number, z: number) {
    // the road lookup is one grid cell, the water scan every lake and river segment: most callers are cars on roads
    return nearestRoad(x, z, near).d >= BRIDGE_REACH_M && overWater(x, z);
  }

  return { inWater };
}
