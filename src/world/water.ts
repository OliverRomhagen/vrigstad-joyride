import { WaterwayKind, type WorldData } from './data';
import { pointInPolygon, segmentDistance } from './polygon';
import type { Roads } from './roads';

/** half the width of a river, as the game treats it (m) */
const RIVER_HALF_WIDTH_M = 2.6;
/** a road within this distance of its edge is a bridge over the water (m) */
const BRIDGE_REACH_M = 1;

/** Lakes and rivers, for asking whether a point is in water. */
export function createWater(data: WorldData, nearestRoad: Roads['nearestRoad']) {
  const lakes = data.w.map((rings) => {
    let x0 = 1e9;
    let x1 = -1e9;
    let z0 = 1e9;
    let z1 = -1e9;
    for (const r of rings) {
      for (let i = 0; i < r.length; i += 2) {
        x0 = Math.min(x0, r[i]);
        x1 = Math.max(x1, r[i]);
        z0 = Math.min(z0, r[i + 1]);
        z1 = Math.max(z1, r[i + 1]);
      }
    }
    return { rings, x0, x1, z0, z1 };
  });

  function inWater(x: number, z: number) {
    if (nearestRoad(x, z).d < BRIDGE_REACH_M) return false;
    for (const l of lakes) {
      if (x < l.x0 || x > l.x1 || z < l.z0 || z > l.z1) continue;
      // islands are rings too: inside an odd number of rings is water
      let inside = false;
      for (const r of l.rings) if (pointInPolygon(r, x, z)) inside = !inside;
      if (inside) return true;
    }
    for (const w of data.ww) {
      if (w.k !== WaterwayKind.RIVER) continue;
      for (let i = 2; i < w.p.length; i += 2) {
        if (segmentDistance(x, z, w.p[i - 2], w.p[i - 1], w.p[i], w.p[i + 1]) < RIVER_HALF_WIDTH_M) return true;
      }
    }
    return false;
  }

  return { inWater };
}
