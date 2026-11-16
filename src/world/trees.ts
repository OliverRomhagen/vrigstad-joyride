import { LandUse, type WorldData } from './data';
import { pointInPolygon, polygonBounds } from './polygon';
import type { Rnd } from './random';
import type { RoadNetwork } from './roads';

export interface TreeSpotOptions {
  /** one try at a tree per this much of each wood's bounding box (m²) */
  squareMetresPerTry: number;
  /** a tree's scale is minScale plus up to scaleSpread */
  minScale: number;
  scaleSpread: number;
  /** when given, a spot is kept only if it is more than roadClearanceM from the edge of the nearest road */
  roads?: Pick<RoadNetwork, 'nearestRoad'>;
  roadClearanceM?: number;
}

/**
 * Spots for trees in the mapped woodland, as flat [x, z, scale, ...] triples. Draws from `rnd` two numbers a try, and a
 * third for the scale of a spot that is kept, so the same stream gives the same trees.
 */
export function treeSpots(data: WorldData, rnd: Rnd, { squareMetresPerTry, minScale, scaleSpread, roads, roadClearanceM = 0 }: TreeSpotOptions) {
  const spots: number[] = [];
  for (const wood of data.l) {
    if (wood.k !== LandUse.FOREST) continue;
    const p = wood.p;
    const { x0, x1, z0, z1 } = polygonBounds(p);
    // divide by the area per try, not multiply by a density, which can round to a different count
    for (let t = Math.round(((x1 - x0) * (z1 - z0)) / squareMetresPerTry); t > 0; t--) {
      const x = x0 + rnd() * (x1 - x0);
      const z = z0 + rnd() * (z1 - z0);
      if (pointInPolygon(p, x, z) && (!roads || roads.nearestRoad(x, z).d > roadClearanceM)) spots.push(x, z, minScale + rnd() * scaleSpread);
    }
  }
  return spots;
}
