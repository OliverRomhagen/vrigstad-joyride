// Which context each road is in, for what furniture it gets, and where Torget is (#144). Pure: no three.js. The street
// profile comes from the streetscape's classification (#187), so this doesn't classify streets a second time.
import { RoadClass, RoadUse, type WorldData } from '../data';
import { pointInPolygon, segmentDistance, signedPolygonArea, vertexCentre } from '../polygon';
import { arcLengths, pointAtArc } from '../polyline';
import type { Point, RoadLine } from '../roads';
import type { StreetSides } from '../streetscape-rules';
import type { FurnitureContext } from './definitions';

/** Torget is mapped as one pedestrian area, which tools/process.py writes as road pieces with this name */
const TORGET_ROAD = 'Torget Vrigstad';
/** a road whose middle is within this of Torget's outline is part of the square (m) */
const TORGET_REACH_M = 25;
/** without a closed outline, Torget is a circle this big round its label (m) */
const TORGET_FALLBACK_M = 35;
/** pieces whose ends are this close join (m) */
const JOIN_M = 0.5;

/** Torget's outline, flat [x, z, ...], and whether it came from the data or the fallback circle. */
export interface TorgetArea {
  ring: number[];
  /** the road pieces that draw Torget's outline: a pedestrian area, not a carriageway to keep clear of */
  roads: number[];
  fromData: boolean;
  /** the middle of the outline's vertices */
  cx: number;
  cz: number;
}

/** Joins the pieces of Torget end to end into one closed ring; a circle round the label when they don't close. */
export function torgetArea(data: WorldData, roads: { readonly lines: readonly RoadLine[] }): TorgetArea | null {
  const torgetRoads = roads.lines.flatMap((_, ri) => (data.r[ri].n === TORGET_ROAD ? [ri] : []));
  const ring = joinRing(torgetRoads.map(ri => roads.lines[ri].p.slice()));
  if (ring) return withCentre(ring.flat(), torgetRoads, true);
  const label = data.labels.find(l => l.t === 'Torget');
  if (!label) return null;
  const circle: number[] = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    circle.push(label.x + Math.cos(a) * TORGET_FALLBACK_M, label.z + Math.sin(a) * TORGET_FALLBACK_M);
  }
  return withCentre(circle, torgetRoads, false);
}

function withCentre(ring: number[], roads: number[], fromData: boolean): TorgetArea {
  const { x, z } = vertexCentre(ring);
  return { ring, roads, fromData, cx: x, cz: z };
}

const samePoint = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]) < JOIN_M;

/** The pieces joined end to end (any direction) into one ring without its closing vertex, or null if they don't close. */
function joinRing(pieces: Point[][]): Point[] | null {
  if (!pieces.length) return null;
  const remaining = pieces.slice(1);
  const ring = pieces[0].slice();
  while (remaining.length) {
    const end = ring[ring.length - 1];
    const k = remaining.findIndex(p => samePoint(p[0], end) || samePoint(p[p.length - 1], end));
    if (k < 0) return null;
    const [p] = remaining.splice(k, 1);
    const next = samePoint(p[0], end) ? p : p.slice().reverse();
    ring.push(...next.slice(1));
  }
  if (!samePoint(ring[0], ring[ring.length - 1]) || ring.length < 4) return null;
  ring.pop();
  // the same ring whatever order or direction the pieces came in: one winding, starting at the lowest x (then z)
  if (signedPolygonArea(ring.flat()) < 0) ring.reverse();
  let start = 0;
  ring.forEach((p, i) => {
    const s = ring[start];
    if (p[0] < s[0] || (p[0] === s[0] && p[1] < s[1])) start = i;
  });
  return [...ring.slice(start), ...ring.slice(0, start)];
}

/** Distance from (x, z) to the outline; 0 inside it. */
function distanceToArea(ring: number[], x: number, z: number) {
  if (pointInPolygon(ring, x, z)) return 0;
  let best = Infinity;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2)
    best = Math.min(best, segmentDistance(x, z, ring[j], ring[j + 1], ring[i], ring[i + 1]));
  return best;
}

function midpoint(p: readonly Point[]) {
  const arcs = arcLengths(p);
  return pointAtArc(p, arcs, arcs[arcs.length - 1] / 2);
}

/**
 * Each road's context, first match:
 * - a lit footway, path or cycleway is `path`, but not a sidewalk or crossing mapped beside its street, which has its own lamps;
 * - a road whose middle is within TORGET_REACH_M of Torget is `torget`, or `centre` for a carriageway round the square;
 * - a street or bigger (service roads, tracks and unlit paths are `outer`) takes the streetscape's profile: `centre`,
 *   `main` for primary and secondary roads in residential areas, `residential` for streets there, `outer` in the outskirts.
 */
export function roadContexts(
  data: WorldData,
  roads: { readonly lines: readonly RoadLine[] },
  sides: readonly Pick<StreetSides, 'profile'>[],
  torget: TorgetArea | null,
): FurnitureContext[] {
  return roads.lines.map((road, ri): FurnitureContext => {
    const r = data.r[ri];
    const beside = r.s === RoadUse.SIDEWALK || r.s === RoadUse.CROSSING;
    if (road.c === RoadClass.PATH) return r.lt === 1 && !beside ? 'path' : 'outer';
    if (road.p.length < 2) return 'outer';
    const { x: mx, z: mz } = midpoint(road.p);
    const carriageway = road.c <= RoadClass.STREET && !beside;
    if (torget && distanceToArea(torget.ring, mx, mz) <= TORGET_REACH_M) return carriageway ? 'centre' : 'torget'; // the streets round the square are the centre's, and keep their lamps
    if (!carriageway) return 'outer';
    const profile = sides[ri]?.profile ?? 'outskirts';
    if (profile === 'centre') return 'centre';
    if (profile === 'outskirts') return 'outer';
    return road.c === RoadClass.STREET ? 'residential' : 'main';
  });
}
