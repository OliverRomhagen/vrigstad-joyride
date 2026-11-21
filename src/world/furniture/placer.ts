// What every street furniture rule shares (#144): the types, the queries over the world, the geometric checks and the
// order candidates are accepted in. Pure: no three.js, no DOM. The rules themselves are in lamps.ts, seats.ts and
// bins.ts; placement.ts runs them in order.
import { BUILDING_CELL_M } from '../buildings';
import { type FurniturePoint, ROAD_WIDTH_M, RoadClass, type WorldData } from '../data';
import { pointInPolygon, polygonBounds, segmentDistance, segmentParam } from '../polygon';
import { arcLengths, pointAtArc } from '../polyline';
import { fnv1a, hash01 } from '../random';
import { nodeKey, type Point, type RoadLine } from '../roads';
import { sidewalkCentreM } from '../streetscape';
import { type SideSpec, type StreetSides, sideSpecOf } from '../streetscape-rules';
import { roadContexts, type TorgetArea, torgetArea } from './context';
import { FURNITURE, type FurnitureContext, type FurnitureKind, type FurnitureSource } from './definitions';
import type { FurnitureOverride } from './overrides';

export interface FurniturePlacement {
  /** stable: 'osm:<id>', 'ovr:<key>' or 'gen:<kind>:<where>:<n>' */
  id: string;
  kind: FurnitureKind;
  modelId: string;
  x: number;
  z: number;
  /** radians about +y; 0 turns the model's +z (a bench's front, a lamp's arm) towards world +z, south */
  rotationY: number;
  scale: number;
  source: FurnitureSource;
}

export interface FurnitureInput {
  data: WorldData;
  roads: {
    readonly lines: readonly RoadLine[];
    forEachSegmentNear(
      x: number,
      z: number,
      reachM: number,
      visit: (ax: number, az: number, bx: number, bz: number, ri: number) => void,
    ): void;
  };
  heightfield: { normalAt(x: number, z: number, out: { x: number; y: number; z: number }): unknown };
  /** collide pushes the given point out of a building and says whether it touched one; placement only passes copies */
  buildings: {
    readonly footprints: readonly { x0: number; x1: number; z0: number; z1: number }[];
    readonly grid: ReadonlyMap<string, readonly number[]>;
    collide(o: { x: number; z: number }, r: number): boolean;
  };
  water: { inWater(x: number, z: number): boolean };
  /** tree spots, flat [x, z, scale, ...] */
  trees: readonly number[];
  /** the streetscape's classification and what it reserved (#187) */
  street: {
    readonly sides: readonly StreetSides[];
    readonly openings: readonly { ri: number; side: -1 | 1; s: number; half: number }[];
    readonly lots: readonly { ai: number }[];
  };
  /** game-side objects to keep clear of, such as the kiosk and safehouse doors */
  exclusions?: readonly { x: number; z: number; r: number }[];
  overrides?: readonly FurnitureOverride[];
}

/** A generated object before it's accepted. */
export interface Candidate extends FurniturePlacement {
  /** lower goes first among candidates of a kind, then id */
  rank: number;
  /** what counts it in `generated`: a road context, 'torget', 'bus stop', 'church' or a park */
  origin: string;
  /** a roadside candidate's road, so the lamp check can tell another carriageway from its own; -1 for none */
  ri: number;
}

/** What a generated candidate can be turned down for, in the order the checks run: the cheap ones first. */
const REJECTIONS = [
  'duplicate',
  'edge',
  'slope',
  'carriageway',
  'junction',
  'tree',
  'furniture',
  'building',
  'water',
  'reserved',
  'exclusion',
] as const;
export type Rejection = (typeof REJECTIONS)[number];

/** furniture stays this far inside the world's edge (m) */
const EDGE_KEEP_M = 20;
/** grid cells for the trees and the furniture already placed (m) */
const CELL_M = 10;
/** carriageway checks look this far round a point, past the widest half road plus the biggest clearance (m) */
const CARRIAGEWAY_REACH_M = 10;
/** no lamp within this of another carriageway's edge (m) */
const OTHER_CARRIAGEWAY_M = 3;
/** a road piece that carries straight on from another's end, within this angle, is the same street (rad) */
const SAME_STREET_RAD = (30 * Math.PI) / 180;
/** a candidate this close to a lowered curb's ends is in the opening (m) */
const OPENING_MARGIN_M = 1;
/** buildings within this of a road count as its frontage, for which side its lamps go on (m) */
const FRONTAGE_REACH_M = 30;
/** a lamp stands this far out from a carriageway's edge without a sidewalk (m), past the walkers' 0.8 m line */
const LAMP_EDGE_M = 1.5;
/** ... and this far past a sidewalk's outer edge (m) */
const LAMP_PAST_SIDEWALK_M = 0.3;
/** a verge this wide takes the lamp in its middle (m): the pole and its 0.5 m from the carriageway each side */
const LAMP_VERGE_MIN_M = 1.4;
/** benches and bins stand at least this far from a carriageway's edge without a sidewalk (m) */
const SEAT_EDGE_M = 2.0;
/** ... and this far past a sidewalk's outer edge, so it stays clear (m) */
const SEAT_PAST_SIDEWALK_M = 0.2;
/** the furthest two footprints, each grown by half its clearance, can reach towards each other (m) */
const NEIGHBOUR_REACH_M =
  2 * Math.max(...Object.values(FURNITURE).map(d => Math.hypot(d.widthM, d.depthM) / 2 + d.clearanceM / 2));

/** A unit vector's heading as rotationY: the rotation that turns +z towards (dx, dz). */
export const heading = (dx: number, dz: number) => Math.atan2(dx, dz);
/** A stable rotation jitter in ±maxRad for this id. */
export const jitterRad = (id: string, maxRad: number) => (hash01(id, 'turn') - 0.5) * 2 * maxRad;

/** A road's stable key: its OSM way and piece, or a hash of its class and ends in a hand-made fixture. */
function roadKey(data: WorldData, ri: number) {
  const r = data.r[ri];
  if (r.i !== undefined) return `${r.i}.${r.j ?? 0}`;
  const p = r.p;
  return 'h' + fnv1a(r.c, p[0].toFixed(1), p[1].toFixed(1), p[p.length - 2].toFixed(1), p[p.length - 1].toFixed(1));
}

class PointGrid<T extends { x: number; z: number }> {
  private readonly cells = new Map<string, T[]>();
  add(o: T) {
    const k = Math.floor(o.x / CELL_M) + ',' + Math.floor(o.z / CELL_M);
    let list = this.cells.get(k);
    if (!list) {
      list = [];
      this.cells.set(k, list);
    }
    list.push(o);
  }
  *near(x: number, z: number, r: number) {
    for (let gx = Math.floor((x - r) / CELL_M); gx <= Math.floor((x + r) / CELL_M); gx++)
      for (let gz = Math.floor((z - r) / CELL_M); gz <= Math.floor((z + r) / CELL_M); gz++)
        yield* this.cells.get(gx + ',' + gz) ?? [];
  }
}

/** The footprint's corners, grown by `grow` on every side, in world space. */
function corners(kind: FurnitureKind, x: number, z: number, rot: number, grow = 0) {
  const d = FURNITURE[kind];
  const hw = d.widthM / 2 + grow;
  const hd = d.depthM / 2 + grow;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c] as const);
}

/** Whether two oriented rectangles overlap (separating axes). */
function rectsOverlap(a: readonly (readonly [number, number])[], b: readonly (readonly [number, number])[]) {
  for (const poly of [a, b])
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = poly[i];
      const [x1, z1] = poly[(i + 1) % 4];
      const nx = z1 - z0;
      const nz = x0 - x1;
      let aMin = Infinity;
      let aMax = -Infinity;
      let bMin = Infinity;
      let bMax = -Infinity;
      for (const [x, z] of a) {
        const v = x * nx + z * nz;
        aMin = Math.min(aMin, v);
        aMax = Math.max(aMax, v);
      }
      for (const [x, z] of b) {
        const v = x * nx + z * nz;
        bMin = Math.min(bMin, v);
        bMax = Math.max(bMax, v);
      }
      if (aMax <= bMin || bMax <= aMin) return false;
    }
  return true;
}

/**
 * Spots along the inside of an outline, every `stepM` from `startM` on each edge, set back `setbackM` from it: the
 * point, its inward normal, the point on the edge, and a running count for ids.
 */
export function* insideOutlineSpots(ring: number[], stepM: number, startM: number, setbackM: number) {
  const n = ring.length / 2;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const ax = ring[i * 2];
    const az = ring[i * 2 + 1];
    const bx = ring[((i + 1) % n) * 2];
    const bz = ring[((i + 1) % n) * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    for (let s = startM; s < len; s += stepM, count++) {
      const ex = ax + ((bx - ax) * s) / len;
      const ez = az + ((bz - az) * s) / len;
      let nx = -(bz - az) / len;
      let nz = (bx - ax) / len;
      if (!pointInPolygon(ring, ex + nx * setbackM, ez + nz * setbackM)) {
        nx = -nx;
        nz = -nz;
      }
      yield { x: ex + nx * setbackM, z: ez + nz * setbackM, nx, nz, ex, ez, count };
    }
  }
}

/** The world queries, the checks and the accepted placements, shared by every rule. */
export class Placer {
  readonly data: WorldData;
  readonly torget: TorgetArea | null;
  readonly contexts: FurnitureContext[];
  /** a stable key per road, for ids and hashes */
  readonly keys: string[];
  /** arc length (m) at each vertex, per road */
  readonly arcs: number[][];
  readonly out: FurniturePlacement[] = [];
  readonly rejected = Object.fromEntries(REJECTIONS.map(k => [k, 0])) as Record<Rejection, number>;
  readonly generated: Record<string, Record<FurnitureKind, number>> = {};
  private readonly half: number;
  private readonly torgetRoads: Set<number>;
  /** per road: the pieces that carry straight on from its ends, the same street where OSM split the way */
  private readonly sameStreet: Set<number>[];
  private readonly junctions = new PointGrid<{ x: number; z: number }>();
  private readonly trees = new PointGrid<{ x: number; z: number }>();
  private readonly lots: { p: number[]; x0: number; x1: number; z0: number; z1: number }[];
  private readonly placed = new PointGrid<FurniturePlacement & { box: ReturnType<typeof corners> }>();
  /** mapped and override objects, by kind: what a generated one mustn't duplicate */
  private readonly authoritative = new Map<FurnitureKind, PointGrid<FurniturePlacement>>();
  private readonly lampSideMemo = new Map<number, (-1 | 1)[]>();
  private readonly _normal = { x: 0, y: 1, z: 0 };

  constructor(readonly inp: FurnitureInput) {
    const { data, roads, street } = inp;
    this.data = data;
    this.half = data.size / 2;
    this.torget = torgetArea(data, roads);
    this.torgetRoads = new Set(this.torget?.roads ?? []);
    this.contexts = roadContexts(data, roads, street.sides, this.torget);
    this.keys = roads.lines.map((_, ri) => roadKey(data, ri));
    this.arcs = roads.lines.map(l => arcLengths(l.p));
    this.sameStreet = sameStreetPieces(roads.lines);
    // junctions: road vertices that two or more pieces of carriageway share
    const shared = new Map<string, number>();
    for (const l of roads.lines)
      if (l.c <= RoadClass.STREET) for (const p of l.p) shared.set(nodeKey(p), (shared.get(nodeKey(p)) ?? 0) + 1);
    for (const [k, n] of shared) {
      if (n < 2) continue;
      const [x, z] = k.split(',').map(Number);
      this.junctions.add({ x: x / 2, z: z / 2 });
    }
    for (let i = 0; i < inp.trees.length; i += 3) this.trees.add({ x: inp.trees[i], z: inp.trees[i + 1] });
    this.lots = street.lots.flatMap(l => {
      const p = data.pa?.[l.ai]?.p;
      return p ? [{ p, ...polygonBounds(p) }] : [];
    });
  }

  // ---------- queries ----------
  /** distance from (x, z) to the nearest carriageway's edge (class TRACK or bigger), skipping the roads in `except` */
  carriagewayGap(x: number, z: number, except?: ReadonlySet<number>) {
    let best = Infinity;
    this.inp.roads.forEachSegmentNear(x, z, CARRIAGEWAY_REACH_M, (ax, az, bx, bz, ri) => {
      const c = this.inp.roads.lines[ri].c;
      if (c > RoadClass.TRACK || except?.has(ri) || this.torgetRoads.has(ri)) return;
      best = Math.min(best, segmentDistance(x, z, ax, az, bx, bz) - ROAD_WIDTH_M[c] / 2);
    });
    return best;
  }

  /** the nearest point within `reachM` on a road of class ≤ maxClass, its distance and the road's direction there */
  nearestRoadPoint(x: number, z: number, maxClass: RoadClass, reachM: number) {
    let nearest: { ri: number; d: number; px: number; pz: number; tx: number; tz: number } | null = null;
    this.inp.roads.forEachSegmentNear(x, z, reachM, (ax, az, bx, bz, ri) => {
      if (this.inp.roads.lines[ri].c > maxClass) return;
      const t = segmentParam(x, z, ax, az, bx, bz);
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      const d = Math.hypot(x - px, z - pz);
      if (d > reachM || (nearest && d >= nearest.d)) return;
      const len = Math.hypot(bx - ax, bz - az) || 1;
      nearest = { ri, d, px, pz, tx: (bx - ax) / len, tz: (bz - az) / len };
    });
    return nearest as { ri: number; d: number; px: number; pz: number; tx: number; tz: number } | null;
  }

  /** the rotation that faces (x, z) to the nearest road of class ≤ maxClass within reachM, else `fallback` */
  faceNearestRoad(x: number, z: number, maxClass: RoadClass, reachM: number, fallback: number) {
    const nearest = this.nearestRoadPoint(x, z, maxClass, reachM);
    return nearest && nearest.d > 0.01 ? heading((nearest.px - x) / nearest.d, (nearest.pz - z) / nearest.d) : fallback;
  }

  sideSpec(ri: number, side: -1 | 1): SideSpec {
    return sideSpecOf(this.inp.street.sides[ri], side);
  }
  hasSidewalk(ri: number, side: -1 | 1) {
    return !!this.inp.street.sides[ri] && this.sideSpec(ri, side).sidewalk === 'present';
  }
  /** how far out from road ri's centre line a lamp stands on `side` (m) */
  lampOffset(ri: number, side: -1 | 1) {
    const c = this.inp.roads.lines[ri].c;
    if (!this.hasSidewalk(ri, side)) return ROAD_WIDTH_M[c] / 2 + LAMP_EDGE_M;
    const spec = this.sideSpec(ri, side);
    const centre = sidewalkCentreM(spec, c)!;
    if (spec.vergeM >= LAMP_VERGE_MIN_M) return centre - spec.widthM / 2 - spec.vergeM / 2;
    return centre + spec.widthM / 2 + LAMP_PAST_SIDEWALK_M;
  }
  /** how far out from road ri's centre line a bench or bin stands on `side`, to its middle (m) */
  seatOffset(ri: number, side: -1 | 1, kind: FurnitureKind) {
    const c = this.inp.roads.lines[ri].c;
    const halfDepth = FURNITURE[kind].depthM / 2;
    if (!this.hasSidewalk(ri, side)) return ROAD_WIDTH_M[c] / 2 + SEAT_EDGE_M + halfDepth;
    const spec = this.sideSpec(ri, side);
    return sidewalkCentreM(spec, c)! + spec.widthM / 2 + SEAT_PAST_SIDEWALK_M + halfDepth;
  }
  private inReservedOpening(ri: number, side: -1 | 1, s: number) {
    return this.inp.street.openings.some(
      o => o.ri === ri && o.side === side && Math.abs(o.s - s) < o.half + OPENING_MARGIN_M,
    );
  }

  /** A candidate beside road ri, `offset` m out on `side`, `s` m along it, its front to the road; null in an opening. */
  roadside(
    kind: FurnitureKind,
    ri: number,
    side: -1 | 1,
    s: number,
    offset: number,
    id: string,
    origin: string,
    maxJitterRad: number,
  ): Candidate | null {
    if (this.inReservedOpening(ri, side, s)) {
      this.rejected.reserved++;
      return null;
    }
    const at = pointAtArc(this.inp.roads.lines[ri].p, this.arcs[ri], s);
    const nx = -at.tz * side; // the right of the way's direction is (-tz, tx): x east, z south
    const nz = at.tx * side;
    return {
      id,
      kind,
      modelId: FURNITURE[kind].modelId,
      x: at.x + nx * offset,
      z: at.z + nz * offset,
      rotationY: heading(-nx, -nz) + jitterRad(id, maxJitterRad),
      scale: 1,
      source: 'procedural',
      rank: 0,
      origin,
      ri,
    };
  }

  /**
   * The side(s) road ri's lamps go on, worked out once per road: both, staggered, on a primary or secondary road in the
   * centre; else the side with a sidewalk, else the side with more building frontage, else by hash. Never flips.
   */
  lampSides(ri: number): (-1 | 1)[] {
    const known = this.lampSideMemo.get(ri);
    if (known) return known;
    const c = this.inp.roads.lines[ri].c;
    let sides: (-1 | 1)[];
    if (this.contexts[ri] === 'centre' && c <= RoadClass.SECONDARY) sides = [1, -1];
    else {
      const leftHasSidewalk = this.hasSidewalk(ri, -1);
      const rightHasSidewalk = this.hasSidewalk(ri, 1);
      const buildingsBySide = this.frontage(ri);
      if (leftHasSidewalk !== rightHasSidewalk) sides = [leftHasSidewalk ? -1 : 1];
      else if (buildingsBySide.left !== buildingsBySide.right)
        sides = [buildingsBySide.left > buildingsBySide.right ? -1 : 1];
      else sides = [hash01(this.keys[ri], 'lamp side') < 0.5 ? -1 : 1];
    }
    this.lampSideMemo.set(ri, sides);
    return sides;
  }

  /** How many buildings stand within FRONTAGE_REACH_M of road ri on each side, scanning the cells along each segment. */
  private frontage(ri: number) {
    const road = this.inp.roads.lines[ri];
    const { footprints, grid } = this.inp.buildings;
    const near = new Set<number>();
    for (let i = 1; i < road.p.length; i++) {
      const [ax, az] = road.p[i - 1];
      const [bx, bz] = road.p[i];
      for (
        let gx = Math.floor((Math.min(ax, bx) - FRONTAGE_REACH_M) / BUILDING_CELL_M);
        gx <= Math.floor((Math.max(ax, bx) + FRONTAGE_REACH_M) / BUILDING_CELL_M);
        gx++
      )
        for (
          let gz = Math.floor((Math.min(az, bz) - FRONTAGE_REACH_M) / BUILDING_CELL_M);
          gz <= Math.floor((Math.max(az, bz) + FRONTAGE_REACH_M) / BUILDING_CELL_M);
          gz++
        )
          for (const bi of grid.get(gx + ',' + gz) ?? []) near.add(bi);
    }
    let left = 0;
    let right = 0;
    for (const bi of near) {
      const b = footprints[bi];
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      let best = Infinity;
      let sign = 0;
      for (let i = 1; i < road.p.length; i++) {
        const [ax, az] = road.p[i - 1];
        const [bx, bz] = road.p[i];
        const d = segmentDistance(cx, cz, ax, az, bx, bz);
        if (d < best) {
          best = d;
          sign = Math.sign((bx - ax) * (cz - az) - (bz - az) * (cx - ax)); // > 0: right of the way, x east and z south
        }
      }
      if (best > FRONTAGE_REACH_M) continue;
      if (sign > 0) right++;
      else left++;
    }
    return { left, right };
  }

  // ---------- accepting ----------
  /** The first check a generated candidate fails, or null when it may stand. */
  private check(c: Candidate): Rejection | null {
    const d = FURNITURE[c.kind];
    const { x, z } = c;
    if (Math.abs(x) > this.half - EDGE_KEEP_M || Math.abs(z) > this.half - EDGE_KEEP_M) return 'edge';
    this.inp.heightfield.normalAt(x, z, this._normal);
    if (this._normal.y < Math.cos((d.maxSlopeDeg * Math.PI) / 180)) return 'slope';
    const box = corners(c.kind, x, z, c.rotationY);
    if (this.carriagewayGap(x, z) < 0 || box.some(([bx, bz]) => this.carriagewayGap(bx, bz) < d.carriagewayClearanceM))
      return 'carriageway';
    if (c.kind === 'street-lamp') {
      const own = this.sameStreet[c.ri] ?? new Set<number>();
      if (this.carriagewayGap(x, z, own) < OTHER_CARRIAGEWAY_M) return 'junction';
    } else
      for (const j of this.junctions.near(x, z, d.junctionKeepM))
        if (Math.hypot(j.x - x, j.z - z) < d.junctionKeepM) return 'junction';
    for (const t of this.trees.near(x, z, d.treeClearanceM))
      if (Math.hypot(t.x - x, t.z - z) < d.treeClearanceM) return 'tree';
    const grown = corners(c.kind, x, z, c.rotationY, d.clearanceM / 2);
    for (const o of this.placed.near(x, z, NEIGHBOUR_REACH_M)) if (rectsOverlap(grown, o.box)) return 'furniture';
    const { buildings, water } = this.inp;
    if ([...box, [x, z] as const].some(([bx, bz]) => buildings.collide({ x: bx, z: bz }, d.clearanceM)))
      return 'building';
    // the water test scans every lake: the middle is enough for something smaller than a metre
    const isWet =
      Math.max(d.widthM, d.depthM) < 1
        ? water.inWater(x, z)
        : [...box, [x, z] as const].some(([bx, bz]) => water.inWater(bx, bz));
    if (isWet) return 'water';
    if (this.lots.some(l => x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1 && pointInPolygon(l.p, x, z)))
      return 'reserved';
    for (const e of this.inp.exclusions ?? []) if (Math.hypot(e.x - x, e.z - z) < e.r) return 'exclusion';
    return null;
  }

  private isDuplicate(c: Candidate) {
    const r = FURNITURE[c.kind].dedupeRadiusM;
    for (const a of this.authoritative.get(c.kind)?.near(c.x, c.z, r) ?? [])
      if (Math.hypot(a.x - c.x, a.z - c.z) < r) return true;
    return false;
  }

  private occupy(p: FurniturePlacement) {
    this.placed.add({ ...p, box: corners(p.kind, p.x, p.z, p.rotationY, FURNITURE[p.kind].clearanceM / 2) });
  }

  /** A mapped or override object: drawn where it is, never checked, and generated ones of its kind keep clear. */
  placeAuthoritative(p: FurniturePlacement) {
    this.out.push(p);
    this.occupy(p);
    let grid = this.authoritative.get(p.kind);
    if (!grid) {
      grid = new PointGrid();
      this.authoritative.set(p.kind, grid);
    }
    grid.add(p);
  }

  /** Accepts a generated candidate if it passes every check; counts why when it doesn't. */
  tryPlace(c: Candidate) {
    if (this.isDuplicate(c)) {
      this.rejected.duplicate++;
      return false;
    }
    const why = this.check(c);
    if (why) {
      this.rejected[why]++;
      return false;
    }
    this.occupy(c);
    this.out.push(c);
    this.generated[c.origin] ??= Object.fromEntries(Object.keys(FURNITURE).map(k => [k, 0])) as Record<
      FurnitureKind,
      number
    >;
    this.generated[c.origin][c.kind]++;
    return true;
  }
}

/** The candidates' order: each kind by rank, then id. */
export const byOrder = (a: Candidate, b: Candidate) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Mapped objects' rotations: a bench's mapped direction, else facing the nearest road or path. */
export function mappedFacing(placer: Placer, f: FurniturePoint, maxClass: RoadClass, reachM: number) {
  if (f.d !== undefined) {
    const a = (f.d * Math.PI) / 180;
    return heading(Math.sin(a), -Math.cos(a)); // degrees clockwise from north, and north is -z
  }
  return placer.faceNearestRoad(f.x, f.z, maxClass, reachM, 0);
}

/** For each road, the other pieces of carriageway that carry straight on from one of its ends, in the same class. */
function sameStreetPieces(lines: readonly RoadLine[]) {
  const ends = new Map<string, { ri: number; dx: number; dz: number }[]>();
  const outward = (p: readonly Point[], atStart: boolean) => {
    const [a, b] = atStart ? [p[0], p[1]] : [p[p.length - 1], p[p.length - 2]];
    const len = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    return { dx: (a[0] - b[0]) / len, dz: (a[1] - b[1]) / len }; // pointing out of the road at that end
  };
  lines.forEach((l, ri) => {
    if (l.p.length < 2 || l.c > RoadClass.TRACK) return;
    for (const atStart of [true, false]) {
      const k = nodeKey(atStart ? l.p[0] : l.p[l.p.length - 1]);
      ends.set(k, [...(ends.get(k) ?? []), { ri, ...outward(l.p, atStart) }]);
    }
  });
  const out = lines.map((_, ri) => new Set<number>([ri]));
  for (const list of ends.values())
    for (const a of list)
      for (const b of list) {
        if (a.ri === b.ri || lines[a.ri].c !== lines[b.ri].c) continue;
        // carrying straight on: the two outward directions point (nearly) opposite ways
        if (a.dx * b.dx + a.dz * b.dz < -Math.cos(SAME_STREET_RAD)) out[a.ri].add(b.ri);
      }
  return out;
}
