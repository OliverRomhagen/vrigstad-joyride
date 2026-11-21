// Street lamps along the roads (#144): spacing and sides by context. Pure: no three.js.
import { FurnitureCode, RoadUse } from '../data';
import { segmentDistance } from '../polygon';
import { hash01 } from '../random';
import { FURNITURE, type FurnitureContext, SHORT_LAMP_MODEL } from './definitions';
import type { Candidate, Placer } from './placer';

// Spacing of lamps along a road by context (m), ± the jitter. Artistic values, not a survey of Vrigstad.
const LAMP_SPACING_M: Partial<Record<FurnitureContext, number>> = { centre: 30, main: 35, residential: 45, path: 25 };
const LAMP_JITTER_M: Partial<Record<FurnitureContext, number>> = { centre: 3, main: 4, residential: 5, path: 3 };
/** residential streets shorter than this get no lamps (m) */
const RESIDENTIAL_LAMP_MIN_M = 60;
/** a road with this many mapped lamps within LAMP_MAPPED_REACH_M of its centre line counts as mapped for lamps */
const LAMP_MAPPED_MIN = 2;
const LAMP_MAPPED_REACH_M = 15;
/** no lamp closer than this to either end of a road piece (m) */
const ROAD_END_MARGIN_M = 2;

/** How many mapped lamps stand within LAMP_MAPPED_REACH_M of each road, worked out once from the lamps' side. */
function mappedLampsPerRoad(placer: Placer) {
  const count = new Map<number, number>();
  for (const f of placer.data.fu ?? []) {
    if (f.k !== FurnitureCode.STREET_LAMP) continue;
    const roads = new Set<number>();
    placer.inp.roads.forEachSegmentNear(f.x, f.z, LAMP_MAPPED_REACH_M, (ax, az, bx, bz, ri) => {
      if (segmentDistance(f.x, f.z, ax, az, bx, bz) < LAMP_MAPPED_REACH_M) roads.add(ri);
    });
    for (const ri of roads) count.set(ri, (count.get(ri) ?? 0) + 1);
  }
  return count;
}

/** Lamp candidates along every road whose context (or lit=yes) gives it lamps. */
export function lampCandidates(placer: Placer): Candidate[] {
  const { data, contexts, keys, arcs } = placer;
  const mapped = mappedLampsPerRoad(placer);
  const out: Candidate[] = [];
  placer.inp.roads.lines.forEach((_, ri) => {
    const road = data.r[ri];
    const context = contexts[ri];
    // lit=no; or a sidewalk or crossing mapped beside its street, whose own lamps light it
    if (road.lt === 2 || road.s === RoadUse.SIDEWALK || road.s === RoadUse.CROSSING) return;
    const isLit = road.lt === 1;
    const spacingContext: FurnitureContext | undefined = context === 'path' ? 'path' : isLit ? 'main' : context;
    const spacing = spacingContext && LAMP_SPACING_M[spacingContext];
    if (!spacing || (context === 'torget' && !isLit)) return;
    const length = arcs[ri][arcs[ri].length - 1];
    if (context === 'residential' && length < RESIDENTIAL_LAMP_MIN_M) return;
    if ((mapped.get(ri) ?? 0) >= LAMP_MAPPED_MIN) return;
    const jitter = LAMP_JITTER_M[spacingContext!] ?? 0;
    const model = context === 'residential' || context === 'path' ? SHORT_LAMP_MODEL : FURNITURE['street-lamp'].modelId;
    const sides = placer.lampSides(ri);
    sides.forEach((side, sideIndex) => {
      const offset = placer.lampOffset(ri, side);
      for (let n = 0; ; n++) {
        const id = `gen:street-lamp:${keys[ri]}:${side < 0 ? 'l' : 'r'}${n}`;
        // half a spacing in from the start, so where OSM splits a street the gap across the join is about one spacing
        const s = spacing / 2 + (sideIndex * spacing) / sides.length + n * spacing + (hash01(id) - 0.5) * 2 * jitter;
        if (s > length - ROAD_END_MARGIN_M) break;
        if (s < ROAD_END_MARGIN_M) continue;
        const c = placer.roadside('street-lamp', ri, side, s, offset, id, context, 0);
        if (c) out.push({ ...c, modelId: model });
      }
    });
  });
  return out;
}
