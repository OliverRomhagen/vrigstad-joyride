// Roadside posts along the country roads (#305): a white post with a black band and a reflector, on both sides of the
// primary and secondary roads outside the built-up area. Pure: no three.js.
import { ROAD_WIDTH_M, RoadClass } from '../data';
import { hash01 } from '../random';
import { nodeKey } from '../roads';
import type { Candidate, Placer } from './placer';

// Artistic values, not a survey: Trafikverket's posts stand about every 50 m on a country road.
/** spacing of the posts along a road (m), ± POST_JITTER_M */
const POST_SPACING_M = 50;
const POST_JITTER_M = 4;
/** a post's middle stands this far out past the carriageway's edge (m) */
const POST_EDGE_M = 0.6;
/** no post closer than this to either end of a road piece (m) */
const ROAD_END_MARGIN_M = 2;
/**
 * nor this close to a junction on its road (m), whatever the side road's class: Placer's own junction keep counts only
 * streets and bigger, and most side roads off a country road are service roads and farm tracks
 */
const POST_JUNCTION_KEEP_M = 10;

/** Post candidates along every outer primary and secondary road, both sides, facing the road. */
export function postCandidates(placer: Placer): Candidate[] {
  const { contexts, roadKeys, arcLengthsByRoad } = placer;
  const out: Candidate[] = [];
  const { lines } = placer.input.roads;
  // how many ways leave each node: a junction has three or more; where OSM only splits a road there are two
  const arms = new Map<string, number>();
  for (const r of lines)
    r.p.forEach((p, i) => {
      const k = nodeKey(p);
      arms.set(k, (arms.get(k) ?? 0) + (i === 0 || i === r.p.length - 1 ? 1 : 2));
    });
  lines.forEach((road, ri) => {
    if (contexts[ri] !== 'outer' || road.c > RoadClass.SECONDARY) return;
    const arcs = arcLengthsByRoad[ri];
    const length = arcs[arcs.length - 1];
    const offsetM = ROAD_WIDTH_M[road.c] / 2 + POST_EDGE_M;
    // how far along this road each junction on it is (m)
    const junctions = road.p.flatMap((p, i) => ((arms.get(nodeKey(p)) ?? 0) >= 3 ? [arcs[i]] : []));
    for (const side of [-1, 1] as const)
      for (let n = 0; ; n++) {
        const id = `gen:roadside-post:${roadKeys[ri]}:${side < 0 ? 'l' : 'r'}${n}`;
        // half a spacing in from the start, so where OSM splits a road the gap across the join is about one spacing
        // n first: fnv1a barely moves the high bits hash01 reads for a change at the end of its key, so hash01(id) would
        // give nearly the same jitter to every post on the road
        const jitter = hash01(n, side, roadKeys[ri]);
        const alongM = POST_SPACING_M / 2 + n * POST_SPACING_M + (jitter - 0.5) * 2 * POST_JITTER_M;
        if (alongM > length - ROAD_END_MARGIN_M) break;
        if (alongM < ROAD_END_MARGIN_M || junctions.some(s => Math.abs(s - alongM) < POST_JUNCTION_KEEP_M)) continue;
        const c = placer.roadside({
          kind: 'roadside-post',
          ri,
          side,
          alongM,
          offsetM,
          id,
          origin: 'outer',
          maxJitterRad: 0,
        });
        if (c) out.push(c);
      }
  });
  return out;
}
