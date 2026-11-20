// Where street lamps, benches and waste bins stand (#144). Pure: no three.js, no DOM. OpenStreetMap objects stand where
// they are mapped; overrides add local knowledge; documented rules fill in the rest, deterministically, and every
// generated object is labelled `procedural`. Placement knows each kind's footprint, never how it is modelled.

import { BUILDING_CELL_M } from '../buildings';
import { FurnitureCode, type FurniturePoint, LandUse, ROAD_WIDTH_M, RoadClass, type WorldData } from '../data';
import { pointInPolygon, segmentDistance, segmentParam } from '../polygon';
import { fnv1a, hash01 } from '../random';
import { nodeKey, ROAD_CELL_M, type RoadLine } from '../roads';
import { sidewalkCentreM } from '../streetscape';
import type { SideSpec, StreetSides } from '../streetscape-rules';
import { roadContexts, type TorgetArea, torgetArea } from './context';
import {
  FURNITURE,
  type FurnitureContext,
  type FurnitureKind,
  type FurnitureSource,
  SHORT_LAMP_EMITTER,
  SHORT_LAMP_MODEL,
} from './definitions';
import { type HouseFront, houseFronts } from './houses';
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

/** what a generated candidate was turned down for, in the order the checks run */
export type Rejection =
  | 'duplicate'
  | 'edge'
  | 'slope'
  | 'carriageway'
  | 'junction'
  | 'tree'
  | 'furniture'
  | 'building'
  | 'water'
  | 'reserved'
  | 'exclusion';

export interface FurnitureInput {
  data: WorldData;
  roads: { readonly lines: readonly RoadLine[]; readonly grid: ReadonlyMap<string, readonly number[]> };
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
    readonly openings: readonly { ri: number; side: -1 | 1; s: number; half: number; kind: string }[];
    readonly lots: readonly { ai: number }[];
  };
  /** game-side objects to keep clear of, such as the kiosk and safehouse doors */
  exclusions?: readonly { x: number; z: number; r: number }[];
  overrides?: readonly FurnitureOverride[];
}

export interface FurnitureLayout {
  placements: FurniturePlacement[];
  torget: TorgetArea | null;
  /** generated candidates turned down, per check */
  rejected: Record<Rejection, number>;
  /** generated objects placed, per kind and where they came from (a road context, 'bus stop' or 'public space') */
  generated: Record<string, Record<FurnitureKind, number>>;
}

// Spacing of lamps along a road by context (m), ± the jitter. Artistic values, not a survey of Vrigstad.
const LAMP_SPACING_M: Partial<Record<FurnitureContext, number>> = { centre: 30, main: 35, residential: 45, path: 25 };
const LAMP_JITTER_M: Partial<Record<FurnitureContext, number>> = { centre: 3, main: 4, residential: 5, path: 3 };
/** residential streets shorter than this get no lamps (m) */
const RESIDENTIAL_LAMP_MIN_M = 60;
/** a lamp stands this far out from a carriageway's edge where there is no sidewalk (m), past the walkers' 0.8 m line */
const LAMP_EDGE_M = 1.5;
/** ... and this far past a sidewalk's outer edge (m) */
const LAMP_PAST_SIDEWALK_M = 0.3;
/** a verge this wide takes the lamp in its middle (m): the pole and its 0.5 m from the carriageway on each side */
const LAMP_VERGE_MIN_M = 1.4;
/** a road with this many mapped lamps within LAMP_MAPPED_REACH_M of its centre line counts as mapped for lamps */
const LAMP_MAPPED_MIN = 2;
const LAMP_MAPPED_REACH_M = 15;
/** benches and bins stand at least this far from a carriageway's edge without a sidewalk (m) */
const SEAT_EDGE_M = 2.0;
/** ... and this far past a sidewalk's outer edge, so it stays clear (m) */
const SEAT_PAST_SIDEWALK_M = 0.2;
/** no lamp within this of another carriageway's edge (m) */
const OTHER_CARRIAGEWAY_M = 3;
/** Torget's benches: how many, set back from the outline, apart, and away from a building wall (m) */
const TORGET_BENCHES = { min: 4, max: 6 };
const TORGET_SETBACK_M = 1.5;
const TORGET_BENCH_GAP_M = 6;
const TORGET_WALL_M = 3;
/** candidates along an outline every this far (m) */
const OUTLINE_STEP_M = 3;
/** Torget's bins: how many, and each this far from its bench's end */
const TORGET_BINS = { min: 2, max: 3 };
const BIN_BESIDE_BENCH_M = 0.8;
/** bus stops: the bench this far back from the kerb, the bin this far along from the bench's end (m) */
const BUS_BENCH_BACK_M = 2;
const BUS_BIN_M = 1;
/** a bus stop finds its road within this (m) */
const BUS_ROAD_REACH_M = 30;
/** parks within this of Torget get benches, at most this many each (m) */
const PUBLIC_REACH_M = 300;
const PUBLIC_BENCHES = 2;
const PUBLIC_FACE_REACH_M = 40;
/** benches round the church: on these rings round its label, at most this many */
const CHURCH_RINGS_M = [16, 22];
const CHURCH_BENCHES = 2;
/** roadside bins: one about every this far (m), kept with this chance */
const BIN_EVERY_M: Partial<Record<FurnitureContext, number>> = { centre: 150, main: 300 };
const BIN_DENSITY: Partial<Record<FurnitureContext, number>> = { centre: 0.7, main: 0.5 };
/** rotation jitter (rad) */
const BENCH_JITTER_RAD = (5 * Math.PI) / 180;
const BIN_JITTER_RAD = (20 * Math.PI) / 180;
/** furniture stays this far inside the world's edge (m) */
const EDGE_KEEP_M = 20;
// #305: by the houses. Artistic values, not a survey of Vrigstad.
/** the property line: this far past a sidewalk's outer edge, or past the carriageway's edge without one (m) */
const HOUSE_PAST_SIDEWALK_M = 0.3;
const HOUSE_LINE_M = 1.4;
/** without a mapped driveway, the bins and the mailbox stand this far either side of the point opposite the house (m) */
const HOUSE_SPLIT_M = 1.2;
/** the wheelie bins stand this far out from the house's wall, about this far along it from the point nearest the street (m) */
const BIN_WALL_GAP_M = 0.25;
const BIN_ALONG_WALL_M = 1.2;
/** a second wheelie bin with this chance, this far along from the first (m) */
const SECOND_BIN_SHARE = 0.6;
const BIN_GAP_M = 0.75;
/** a street cabinet after every this many houses along a street, from MIN to MIN + SPREAD - 1, by hash */
const CABINET_EVERY_MIN = 4;
const CABINET_EVERY_SPREAD = 3;
/** in the outskirts, houses this close along a road share one mailbox stand when there are at least STAND_MIN (m) */
const STAND_REACH_M = 150;
const STAND_MIN = 3;
const STAND_MAX = 6;
/** wheelie bins: green or black, by hash */
const WHEELIE_MODELS = ['wheelie-bin-green', 'wheelie-bin-black'] as const;
/** mailboxes: green, grey or black, by hash */
const MAILBOX_MODELS = ['mailbox-green', 'mailbox-grey', 'mailbox-black'] as const;

/** grid cells for the trees and furniture already placed (m) */
const CELL_M = 10;

const KIND_ORDER: readonly FurnitureKind[] = [
  'street-lamp',
  'bench',
  'waste-bin',
  'wheelie-bin',
  'mailbox',
  'mailbox-stand',
  'street-cabinet',
];
const MAPPED_KIND: Partial<Record<FurnitureCode, FurnitureKind>> = {
  [FurnitureCode.STREET_LAMP]: 'street-lamp',
  [FurnitureCode.BENCH]: 'bench',
  [FurnitureCode.WASTE_BASKET]: 'waste-bin',
  [FurnitureCode.STREET_CABINET]: 'street-cabinet',
};

interface Candidate extends FurniturePlacement {
  /** lower goes first among candidates of a kind, then id */
  rank: number;
  /** what counts it in `generated` */
  origin: string;
  /** a roadside candidate: its road, so another road's carriageway can be told apart */
  ri: number;
}

/** A unit vector's heading as rotationY: the rotation that turns +z towards (dx, dz). */
const heading = (dx: number, dz: number) => Math.atan2(dx, dz);

function roadKey(data: WorldData, ri: number) {
  const r = data.r[ri];
  if (r.i !== undefined) return `${r.i}.${r.j ?? 0}`;
  const p = r.p;
  return 'h' + fnv1a(r.c, p[0].toFixed(1), p[1].toFixed(1), p[p.length - 2].toFixed(1), p[p.length - 1].toFixed(1));
}

/** A polyline measured by arc length: where s metres along it is, and its direction there. */
class Measured {
  readonly s: number[] = [0];
  constructor(readonly p: readonly (readonly [number, number])[]) {
    for (let i = 1; i < p.length; i++)
      this.s.push(this.s[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  }
  get length() {
    return this.s[this.s.length - 1];
  }
  at(s: number) {
    let i = 1;
    while (i < this.s.length - 1 && this.s[i] < s) i++;
    const a = this.p[i - 1];
    const b = this.p[i];
    const len = this.s[i] - this.s[i - 1] || 1;
    const u = Math.max(0, Math.min(1, (s - this.s[i - 1]) / len));
    return {
      x: a[0] + (b[0] - a[0]) * u,
      z: a[1] + (b[1] - a[1]) * u,
      tx: (b[0] - a[0]) / len,
      tz: (b[1] - a[1]) / len,
    };
  }
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
 * The outline's edge nearest (x, z): its start, unit tangent, length, outward normal (towards (x, z)) and how far along
 * it the nearest point is. Null for a degenerate outline.
 */
function nearestWall(p: readonly number[], x: number, z: number) {
  let best: {
    ax: number;
    az: number;
    tx: number;
    tz: number;
    nx: number;
    nz: number;
    len: number;
    u: number;
    d: number;
  } | null = null;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const ax = p[j];
    const az = p[j + 1];
    const len = Math.hypot(p[i] - ax, p[i + 1] - az);
    if (len < 1) continue;
    const tx = (p[i] - ax) / len;
    const tz = (p[i + 1] - az) / len;
    const u = Math.max(0, Math.min(len, (x - ax) * tx + (z - az) * tz));
    const d = Math.hypot(ax + tx * u - x, az + tz * u - z);
    if (best && d >= best.d) continue;
    const toward = (x - ax) * -tz + (z - az) * tx > 0 ? 1 : -1; // the normal on the side of (x, z)
    best = { ax, az, tx, tz, nx: -tz * toward, nz: tx * toward, len, u, d };
  }
  return best;
}

/** Places street furniture: mapped objects first, then overrides, then the rules. The same input gives the same array. */
export function placeFurniture(inp: FurnitureInput): FurnitureLayout {
  const { data, roads, heightfield, buildings, water, street } = inp;
  const half = data.size / 2;
  const torget = torgetArea(data, roads);
  const contexts = roadContexts(data, roads, street.sides, torget);
  const measured = roads.lines.map(l => new Measured(l.p));
  const torgetRoads = new Set(torget?.roads ?? []);
  const keys = roads.lines.map((_, ri) => roadKey(data, ri));
  const rejected = Object.fromEntries(
    (
      [
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
      ] as const
    ).map(k => [k, 0]),
  ) as Record<Rejection, number>;
  const generated: Record<string, Record<FurnitureKind, number>> = {};

  // ---------- queries ----------
  /** distance from (x, z) to the nearest carriageway's edge (class TRACK or bigger), skipping road `except` */
  const carriagewayGap = (x: number, z: number, except = -1) => {
    let best = Infinity;
    const list = roads.grid.get(Math.floor(x / ROAD_CELL_M) + ',' + Math.floor(z / ROAD_CELL_M));
    if (list)
      for (let i = 0; i < list.length; i += 5) {
        const ri = list[i + 4];
        const c = roads.lines[ri].c;
        if (c > RoadClass.TRACK || ri === except || torgetRoads.has(ri)) continue;
        best = Math.min(
          best,
          segmentDistance(x, z, list[i], list[i + 1], list[i + 2], list[i + 3]) - ROAD_WIDTH_M[c] / 2,
        );
      }
    return best;
  };
  /** the nearest point on a road of class ≤ maxClass within the lookup cell, and the side (x, z) is on */
  const nearestRoadPoint = (x: number, z: number, maxClass: RoadClass) => {
    let best: { ri: number; d: number; px: number; pz: number } | null = null;
    const list = roads.grid.get(Math.floor(x / ROAD_CELL_M) + ',' + Math.floor(z / ROAD_CELL_M));
    if (list)
      for (let i = 0; i < list.length; i += 5) {
        const ri = list[i + 4];
        if (roads.lines[ri].c > maxClass) continue;
        const t = segmentParam(x, z, list[i], list[i + 1], list[i + 2], list[i + 3]);
        const px = list[i] + (list[i + 2] - list[i]) * t;
        const pz = list[i + 1] + (list[i + 3] - list[i + 1]) * t;
        const d = Math.hypot(x - px, z - pz);
        if (!best || d < best.d) best = { ri, d, px, pz };
      }
    return best;
  };
  // junctions: road vertices that two or more pieces of carriageway share
  const junctions = new PointGrid<{ x: number; z: number }>();
  {
    const seen = new Map<string, number>();
    roads.lines.forEach(l => {
      if (l.c > RoadClass.STREET) return;
      for (const p of l.p) seen.set(nodeKey(p), (seen.get(nodeKey(p)) ?? 0) + 1);
    });
    for (const [k, n] of seen) {
      if (n < 2) continue;
      const [x, z] = k.split(',').map(Number);
      junctions.add({ x: x / 2, z: z / 2 });
    }
  }
  const trees = new PointGrid<{ x: number; z: number }>();
  for (let i = 0; i < inp.trees.length; i += 3) trees.add({ x: inp.trees[i], z: inp.trees[i + 1] });
  const lots = street.lots.map(l => data.pa?.[l.ai]?.p).filter((p): p is number[] => !!p);
  const placed = new PointGrid<FurniturePlacement & { box: ReturnType<typeof corners> }>();
  const _n = { x: 0, y: 1, z: 0 };

  /** The first check a generated candidate fails, or null when it may stand. */
  const check = (c: Candidate): Rejection | null => {
    const d = FURNITURE[c.kind];
    const { x, z } = c;
    if (Math.abs(x) > half - EDGE_KEEP_M || Math.abs(z) > half - EDGE_KEEP_M) return 'edge';
    heightfield.normalAt(x, z, _n);
    if (_n.y < Math.cos((d.maxSlopeDeg * Math.PI) / 180)) return 'slope';
    const box = corners(c.kind, x, z, c.rotationY);
    if (carriagewayGap(x, z) < 0 || box.some(([bx, bz]) => carriagewayGap(bx, bz) < d.carriagewayClearanceM))
      return 'carriageway';
    if (c.kind === 'street-lamp') {
      if (carriagewayGap(x, z, c.ri) < OTHER_CARRIAGEWAY_M) return 'junction';
    } else
      for (const j of junctions.near(x, z, d.junctionKeepM))
        if (Math.hypot(j.x - x, j.z - z) < d.junctionKeepM) return 'junction';
    // the cheap checks first: most candidates that fail, fail on a tree or other furniture
    for (const t of trees.near(x, z, d.treeClearanceM))
      if (Math.hypot(t.x - x, t.z - z) < d.treeClearanceM) return 'tree';
    const grown = corners(c.kind, x, z, c.rotationY, d.clearanceM / 2);
    for (const o of placed.near(x, z, 4)) if (rectsOverlap(grown, o.box)) return 'furniture';
    if ([...box, [x, z] as const].some(([bx, bz]) => buildings.collide({ x: bx, z: bz }, d.clearanceM)))
      return 'building';
    // the water test scans every lake: the middle is enough for something smaller than a metre
    const wet =
      Math.max(d.widthM, d.depthM) < 1
        ? water.inWater(x, z)
        : [...box, [x, z] as const].some(([bx, bz]) => water.inWater(bx, bz));
    if (wet) return 'water';
    if (lots.some(p => pointInPolygon(p, x, z))) return 'reserved';
    for (const e of inp.exclusions ?? []) if (Math.hypot(e.x - x, e.z - z) < e.r) return 'exclusion';
    return null;
  };
  const accept = (p: FurniturePlacement) =>
    placed.add({ ...p, box: corners(p.kind, p.x, p.z, p.rotationY, FURNITURE[p.kind].clearanceM / 2) });
  const out: FurniturePlacement[] = [];
  const strip = ({ id, kind, modelId, x, z, rotationY, scale, source }: FurniturePlacement): FurniturePlacement => ({
    id,
    kind,
    modelId,
    x,
    z,
    rotationY,
    scale,
    source,
  });

  // ---------- 1. mapped objects, authoritative: drawn where mapped, never moved or checked ----------
  const mapped = (data.fu ?? []).filter(f => MAPPED_KIND[f.k]);
  const mappedFacing = (f: FurniturePoint) => {
    if (f.d !== undefined) {
      const a = (f.d * Math.PI) / 180;
      return heading(Math.sin(a), -Math.cos(a)); // degrees clockwise from north, and north is -z
    }
    const r = nearestRoadPoint(f.x, f.z, RoadClass.PATH);
    return r && r.d > 0.01 ? heading((r.px - f.x) / r.d, (r.pz - f.z) / r.d) : 0;
  };
  for (const f of mapped) {
    const kind = MAPPED_KIND[f.k]!;
    const p: FurniturePlacement = {
      id: `osm:${f.i}`,
      kind,
      modelId: FURNITURE[kind].modelId,
      x: f.x,
      z: f.z,
      rotationY: kind === 'street-lamp' ? lampFacing(f.x, f.z) : mappedFacing(f),
      scale: 1,
      source: 'osm',
    };
    out.push(p);
    accept(p);
  }
  function lampFacing(x: number, z: number) {
    const r = nearestRoadPoint(x, z, RoadClass.TRACK);
    return r && r.d > 0.01 ? heading((r.px - x) / r.d, (r.pz - z) / r.d) : 0;
  }

  // ---------- 2. overrides: additions ----------
  for (const o of inp.overrides ?? []) {
    if (o.op !== 'add') continue;
    const p: FurniturePlacement = {
      id: `ovr:${o.key}`,
      kind: o.kind,
      modelId: FURNITURE[o.kind].modelId,
      x: o.x,
      z: o.z,
      rotationY: o.rotationY,
      scale: 1,
      source: 'override',
    };
    out.push(p);
    accept(p);
  }
  const authoritative = [...out];
  const duplicate = (c: Candidate) =>
    authoritative.some(a => a.kind === c.kind && Math.hypot(a.x - c.x, a.z - c.z) < FURNITURE[c.kind].dedupeRadiusM);

  // ---------- 3. the rules, kind by kind: lamps, then benches, then bins ----------
  const sideSpec = (ri: number, side: -1 | 1): SideSpec => (side < 0 ? street.sides[ri].left : street.sides[ri].right);
  const hasSidewalk = (ri: number, side: -1 | 1) => street.sides[ri] && sideSpec(ri, side).sidewalk === 'present';
  const lampOffset = (ri: number, side: -1 | 1) => {
    const c = roads.lines[ri].c;
    if (!hasSidewalk(ri, side)) return ROAD_WIDTH_M[c] / 2 + LAMP_EDGE_M;
    const spec = sideSpec(ri, side);
    const centre = sidewalkCentreM(spec, c)!;
    if (spec.vergeM >= LAMP_VERGE_MIN_M) return centre - spec.widthM / 2 - spec.vergeM / 2;
    return centre + spec.widthM / 2 + LAMP_PAST_SIDEWALK_M;
  };
  const seatOffset = (ri: number, side: -1 | 1, kind: FurnitureKind) => {
    const c = roads.lines[ri].c;
    const depth = FURNITURE[kind].depthM / 2;
    if (!hasSidewalk(ri, side)) return ROAD_WIDTH_M[c] / 2 + SEAT_EDGE_M + depth;
    const spec = sideSpec(ri, side);
    return sidewalkCentreM(spec, c)! + spec.widthM / 2 + SEAT_PAST_SIDEWALK_M + depth;
  };
  const reservedOpening = (ri: number, side: -1 | 1, s: number) =>
    street.openings.some(o => o.ri === ri && o.side === side && Math.abs(o.s - s) < o.half + 1);
  /** a candidate beside road ri, `offset` m out on `side`, s m along it; `face` 1 turns its front to the road */
  const roadside = (
    kind: FurnitureKind,
    ri: number,
    side: -1 | 1,
    s: number,
    offset: number,
    id: string,
    origin: string,
    jitter: number,
  ): Candidate | null => {
    const at = measured[ri].at(s);
    const nx = -at.tz * side; // the right of the way's direction is (-tz, tx): x east, z south
    const nz = at.tx * side;
    if (reservedOpening(ri, side, s)) {
      rejected.reserved++;
      return null;
    }
    return {
      id,
      kind,
      modelId: FURNITURE[kind].modelId,
      x: at.x + nx * offset,
      z: at.z + nz * offset,
      rotationY: heading(-nx, -nz) + (hash01(id, 'turn') - 0.5) * 2 * jitter,
      scale: 1,
      source: 'procedural',
      rank: 0,
      origin,
      ri,
    };
  };

  // lamp side: the one with a sidewalk, else the one with more building frontage within 30 m; never flips along a road
  const frontage = (ri: number) => {
    const road = roads.lines[ri];
    let left = 0;
    let right = 0;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const [x, z] of road.p) {
      x0 = Math.min(x0, x - 30);
      x1 = Math.max(x1, x + 30);
      z0 = Math.min(z0, z - 30);
      z1 = Math.max(z1, z + 30);
    }
    const seen = new Set<number>();
    for (let gx = Math.floor(x0 / BUILDING_CELL_M); gx <= Math.floor(x1 / BUILDING_CELL_M); gx++)
      for (let gz = Math.floor(z0 / BUILDING_CELL_M); gz <= Math.floor(z1 / BUILDING_CELL_M); gz++)
        for (const bi of buildings.grid.get(gx + ',' + gz) ?? []) {
          if (seen.has(bi)) continue;
          seen.add(bi);
          const b = buildings.footprints[bi];
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
          if (best > 30) continue;
          if (sign > 0) right++;
          else left++;
        }
    return { left, right };
  };
  const mappedLamps = mapped.filter(f => f.k === FurnitureCode.STREET_LAMP);
  const lampSides = (ri: number): (-1 | 1)[] => {
    const c = roads.lines[ri].c;
    if (contexts[ri] === 'centre' && c <= RoadClass.SECONDARY) return [1, -1]; // staggered on both sides
    const l = hasSidewalk(ri, -1);
    const r = hasSidewalk(ri, 1);
    if (l !== r) return [l ? -1 : 1];
    const f = frontage(ri);
    if (f.left !== f.right) return [f.left > f.right ? -1 : 1];
    return [hash01(keys[ri], 'lamp side') < 0.5 ? -1 : 1];
  };
  const lampCandidates: Candidate[] = [];
  roads.lines.forEach((road, ri) => {
    const r = data.r[ri];
    const ctx = contexts[ri];
    if (r.lt === 2) return;
    const lit = r.lt === 1;
    const spaced: FurnitureContext | undefined = ctx === 'path' ? 'path' : lit ? 'main' : ctx;
    const spacing = spaced && LAMP_SPACING_M[spaced];
    if (!spacing || (ctx === 'torget' && !lit)) return;
    const len = measured[ri].length;
    if (ctx === 'residential' && len < RESIDENTIAL_LAMP_MIN_M) return;
    const near = mappedLamps.filter(f => {
      for (let i = 1; i < road.p.length; i++)
        if (
          segmentDistance(f.x, f.z, road.p[i - 1][0], road.p[i - 1][1], road.p[i][0], road.p[i][1]) <
          LAMP_MAPPED_REACH_M
        )
          return true;
      return false;
    });
    if (near.length >= LAMP_MAPPED_MIN) return;
    const jitter = LAMP_JITTER_M[spaced!] ?? 0;
    const model = ctx === 'residential' || ctx === 'path' ? SHORT_LAMP_MODEL : FURNITURE['street-lamp'].modelId;
    const sides = lampSides(ri);
    sides.forEach((side, k) => {
      const offset = lampOffset(ri, side);
      for (let n = 0; ; n++) {
        const id = `gen:street-lamp:${keys[ri]}:${side < 0 ? 'l' : 'r'}${n}`;
        const s = spacing / 2 + (k * spacing) / sides.length + n * spacing + (hash01(id) - 0.5) * 2 * jitter;
        if (s > len - 2) break;
        if (s < 2) continue;
        const c = roadside('street-lamp', ri, side, s, offset, id, ctx, 0);
        if (c) lampCandidates.push({ ...c, modelId: model });
      }
    });
  });

  const benchCandidates: Candidate[] = [];
  const binCandidates: Candidate[] = [];
  // Torget: benches along the inside of the outline, facing the middle
  if (torget) {
    const ring = torget.ring;
    const n = ring.length / 2;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const ax = ring[i * 2];
      const az = ring[i * 2 + 1];
      const bx = ring[((i + 1) % n) * 2];
      const bz = ring[((i + 1) % n) * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let s = OUTLINE_STEP_M / 2; s < len; s += OUTLINE_STEP_M, k++) {
        const ex = ax + ((bx - ax) * s) / len;
        const ez = az + ((bz - az) * s) / len;
        let nx = -(bz - az) / len;
        let nz = (bx - ax) / len;
        if (!pointInPolygon(ring, ex + nx * TORGET_SETBACK_M, ez + nz * TORGET_SETBACK_M)) {
          nx = -nx;
          nz = -nz;
        }
        if (buildings.collide({ x: ex, z: ez }, TORGET_WALL_M)) continue; // a building's front: no bench before its door
        const x = ex + nx * TORGET_SETBACK_M;
        const z = ez + nz * TORGET_SETBACK_M;
        const id = `gen:bench:torget:${k}`;
        const fx = torget.cx - x;
        const fz = torget.cz - z;
        const fl = Math.hypot(fx, fz) || 1;
        benchCandidates.push({
          id,
          kind: 'bench',
          modelId: FURNITURE.bench.modelId,
          x,
          z,
          rotationY: heading(fx / fl, fz / fl) + (hash01(id, 'turn') - 0.5) * 2 * BENCH_JITTER_RAD,
          scale: 1,
          source: 'procedural',
          rank: 1 + hash01(id, 'order'), // in a hash order, so the first accepted spread round the square
          origin: 'torget',
          ri: -1,
        });
      }
    }
  }
  // bus stops: a bench back from the kerb, facing the road, and a bin beside it
  for (const f of data.fu ?? []) {
    if (f.k !== FurnitureCode.BUS_STOP) continue;
    const r = nearestRoadPoint(f.x, f.z, RoadClass.STREET);
    if (!r || r.d > BUS_ROAD_REACH_M) continue;
    const road = roads.lines[r.ri];
    const ux = r.d > 0.01 ? (f.x - r.px) / r.d : 1;
    const uz = r.d > 0.01 ? (f.z - r.pz) / r.d : 0;
    const back = ROAD_WIDTH_M[road.c] / 2 + BUS_BENCH_BACK_M + FURNITURE.bench.depthM / 2;
    const id = `gen:bench:bus:${f.i}`;
    const bench: Candidate = {
      id,
      kind: 'bench',
      modelId: FURNITURE.bench.modelId,
      x: r.px + ux * back,
      z: r.pz + uz * back,
      rotationY: heading(-ux, -uz),
      scale: 1,
      source: 'procedural',
      rank: 0,
      origin: 'bus stop',
      ri: r.ri,
    };
    benchCandidates.push(bench);
    const along = FURNITURE.bench.widthM / 2 + BUS_BIN_M; // along the kerb, past the bench's end
    binCandidates.push({
      ...bench,
      id: `gen:waste-bin:bus:${f.i}`,
      kind: 'waste-bin',
      modelId: FURNITURE['waste-bin'].modelId,
      x: bench.x + uz * along,
      z: bench.z - ux * along,
    });
  }
  // parks near Torget, and round the church: at most a couple of benches each, facing a road or the place's middle
  const label = (t: string) => data.labels.find(l => l.t === t);
  const torgetLabel = label('Torget');
  const facingFrom = (x: number, z: number, cx: number, cz: number) => {
    const r = nearestRoadPoint(x, z, RoadClass.PATH);
    const [tx, tz] = r && r.d < PUBLIC_FACE_REACH_M ? [r.px, r.pz] : [cx, cz];
    const l = Math.hypot(tx - x, tz - z) || 1;
    return heading((tx - x) / l, (tz - z) / l);
  };
  data.l.forEach((area, ai) => {
    if (area.k !== LandUse.GRASS || !torgetLabel) return;
    const p = area.p;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < p.length; i += 2) {
      cx += p[i];
      cz += p[i + 1];
    }
    cx /= p.length / 2;
    cz /= p.length / 2;
    if (Math.hypot(cx - torgetLabel.x, cz - torgetLabel.z) > PUBLIC_REACH_M) return;
    const n = p.length / 2;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const ax = p[i * 2];
      const az = p[i * 2 + 1];
      const bx = p[((i + 1) % n) * 2];
      const bz = p[((i + 1) % n) * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let s = OUTLINE_STEP_M; s < len; s += OUTLINE_STEP_M * 2, k++) {
        let nx = -(bz - az) / len;
        let nz = (bx - ax) / len;
        const ex = ax + ((bx - ax) * s) / len;
        const ez = az + ((bz - az) * s) / len;
        if (!pointInPolygon(p, ex + nx * TORGET_SETBACK_M, ez + nz * TORGET_SETBACK_M)) {
          nx = -nx;
          nz = -nz;
        }
        const x = ex + nx * TORGET_SETBACK_M;
        const z = ez + nz * TORGET_SETBACK_M;
        const id = `gen:bench:park${ai}:${k}`;
        benchCandidates.push({
          id,
          kind: 'bench',
          modelId: FURNITURE.bench.modelId,
          x,
          z,
          rotationY: facingFrom(x, z, cx, cz) + (hash01(id, 'turn') - 0.5) * 2 * BENCH_JITTER_RAD,
          scale: 1,
          source: 'procedural',
          rank: 1 + hash01(id, 'order'),
          origin: `park${ai}`,
          ri: -1,
        });
      }
    }
  });
  const church = label('Vrigstad Kyrka');
  if (church)
    CHURCH_RINGS_M.forEach((radius, ring) => {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const x = church.x + Math.cos(a) * radius;
        const z = church.z + Math.sin(a) * radius;
        const id = `gen:bench:church:${ring}.${k}`;
        benchCandidates.push({
          id,
          kind: 'bench',
          modelId: FURNITURE.bench.modelId,
          x,
          z,
          rotationY: heading(-Math.cos(a), -Math.sin(a)) + (hash01(id, 'turn') - 0.5) * 2 * BENCH_JITTER_RAD, // facing the church
          scale: 1,
          source: 'procedural',
          rank: 1 + hash01(id, 'order'),
          origin: 'church',
          ri: -1,
        });
      }
    });
  // roadside bins in the centre and on main roads, on the lamp side, now and then
  roads.lines.forEach((_, ri) => {
    const ctx = contexts[ri];
    const every = BIN_EVERY_M[ctx];
    if (!every) return;
    const side = lampSides(ri)[0];
    const len = measured[ri].length;
    const offset = seatOffset(ri, side, 'waste-bin');
    for (let n = 0; ; n++) {
      const id = `gen:waste-bin:${keys[ri]}:${n}`;
      const s = every / 2 + n * every + (hash01(id, 'at') - 0.5) * every * 0.3;
      if (s > len - 2) break;
      if (hash01(id) >= BIN_DENSITY[ctx]!) continue;
      const c = roadside('waste-bin', ri, side, s, offset, id, ctx, BIN_JITTER_RAD);
      if (c) binCandidates.push(c);
    }
  });

  // ---------- accept candidates in order: each kind by rank, then id; the first accepted wins ----------
  const byOrder = (a: Candidate, b: Candidate) => a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const count = (c: Candidate) => {
    generated[c.origin] ??= Object.fromEntries(KIND_ORDER.map(k => [k, 0])) as Record<FurnitureKind, number>;
    generated[c.origin][c.kind]++;
  };
  const caps: Record<string, number> = { torget: TORGET_BENCHES.max, church: CHURCH_BENCHES };
  const benchesAt: Record<string, number> = {};
  const torgetBenches: Candidate[] = [];
  const tryPlace = (c: Candidate) => {
    if (duplicate(c)) {
      rejected.duplicate++;
      return false;
    }
    if (c.kind === 'bench') {
      const cap = caps[c.origin] ?? (c.origin.startsWith('park') ? PUBLIC_BENCHES : Infinity);
      if ((benchesAt[c.origin] ?? 0) >= cap) return false;
      if (c.origin === 'torget' && torgetBenches.some(b => Math.hypot(b.x - c.x, b.z - c.z) < TORGET_BENCH_GAP_M)) {
        rejected.furniture++;
        return false;
      }
    }
    const why = check(c);
    if (why) {
      rejected[why]++;
      return false;
    }
    accept(c);
    out.push(c);
    count(c);
    if (c.kind === 'bench') {
      benchesAt[c.origin] = (benchesAt[c.origin] ?? 0) + 1;
      if (c.origin === 'torget') torgetBenches.push(c);
    }
    return true;
  };
  for (const c of lampCandidates.sort(byOrder)) tryPlace(c);
  for (const c of benchCandidates.sort(byOrder)) tryPlace(c);
  // Torget's bins: beside a few of its benches, chosen by hash, not every bench
  let torgetBins = 0;
  for (const b of [...torgetBenches].sort((a, b) => hash01(a.id, 'bin') - hash01(b.id, 'bin'))) {
    if (torgetBins >= TORGET_BINS.max) break;
    for (const end of [1, -1]) {
      const along = (FURNITURE.bench.widthM / 2 + BIN_BESIDE_BENCH_M) * end; // along the bench's own x axis
      const id = `gen:waste-bin:torget:${b.id.split(':').pop()}${end < 0 ? 'l' : 'r'}`;
      const c: Candidate = {
        ...b,
        id,
        kind: 'waste-bin',
        modelId: FURNITURE['waste-bin'].modelId,
        x: b.x + Math.cos(b.rotationY) * along,
        z: b.z - Math.sin(b.rotationY) * along,
        rotationY: b.rotationY + (hash01(id, 'turn') - 0.5) * 2 * BIN_JITTER_RAD,
        rank: 0,
      };
      if (tryPlace(c)) {
        torgetBins++;
        break;
      }
    }
  }
  for (const c of binCandidates.sort(byOrder)) tryPlace(c);

  // ---------- by the houses (#305): a mailbox and wheelie bins at each house's street, cabinets now and then ----------
  const houseLine = (ri: number, side: -1 | 1, kind: FurnitureKind) => {
    const c = roads.lines[ri].c;
    const depth = FURNITURE[kind].depthM / 2;
    if (!hasSidewalk(ri, side)) return ROAD_WIDTH_M[c] / 2 + HOUSE_LINE_M + depth;
    const spec = sideSpec(ri, side);
    return sidewalkCentreM(spec, c)! + spec.widthM / 2 + HOUSE_PAST_SIDEWALK_M + depth;
  };
  const fronts = houseFronts(data, roads, ri => contexts[ri] !== 'path');
  /** how far either side of the front the house's things stand: past the driveway's lowered curb when there is one */
  const split = (f: HouseFront) => {
    const o = street.openings.find(
      o => o.ri === f.ri && o.side === f.side && Math.abs(o.s - f.s) < 6 && o.kind === 'driveway',
    );
    return o ? o.half + 1 : HOUSE_SPLIT_M;
  };
  const houseCandidates: Candidate[] = [];
  const outskirts = new Map<string, HouseFront[]>();
  for (const f of fronts) {
    if (contexts[f.ri] === 'outer') {
      const k = `${f.ri}:${f.side}`;
      outskirts.set(k, [...(outskirts.get(k) ?? []), f]);
      continue;
    }
    const gap = split(f);
    const mailbox = roadside(
      'mailbox',
      f.ri,
      f.side,
      f.s - gap - FURNITURE.mailbox.widthM / 2,
      houseLine(f.ri, f.side, 'mailbox'),
      `gen:mailbox:${f.key}`,
      'house',
      0,
    );
    if (mailbox)
      houseCandidates.push({ ...mailbox, modelId: MAILBOX_MODELS[Math.floor(hash01(mailbox.id, 'colour') * 3)] });
  }
  for (const f of fronts) {
    // the wheelie bins stand at the house, back to the wall that faces the street; they go out to the kerb only on collection day
    const at = measured[f.ri].at(f.s);
    const wall = nearestWall(f.p, at.x, at.z);
    if (!wall) continue;
    const bins = hash01(f.key, 'bins') < SECOND_BIN_SHARE ? 2 : 1;
    const way = hash01(f.key, 'bin side') < 0.5 ? -1 : 1;
    const standOff = BIN_WALL_GAP_M + FURNITURE['wheelie-bin'].depthM / 2;
    for (let n = 0; n < bins; n++) {
      const id = `gen:wheelie-bin:${f.key}:${n}`;
      // along the wall from its point nearest the street, kept on the wall
      const u = Math.max(0.4, Math.min(wall.len - 0.4, wall.u + way * (BIN_ALONG_WALL_M + n * BIN_GAP_M)));
      houseCandidates.push({
        id,
        kind: 'wheelie-bin',
        modelId: WHEELIE_MODELS[hash01(id, 'colour') < 0.5 ? 0 : 1],
        x: wall.ax + wall.tx * u + wall.nx * standOff,
        z: wall.az + wall.tz * u + wall.nz * standOff,
        rotationY: heading(wall.nx, wall.nz) + (hash01(id, 'turn') - 0.5) * BIN_JITTER_RAD,
        scale: 1,
        source: 'procedural',
        rank: 1,
        origin: 'house',
        ri: f.ri,
      });
    }
  }
  // in the outskirts, a stand of mailboxes where a few houses share a stretch of road; one each where they don't
  for (const list of outskirts.values()) {
    list.sort((a, b) => a.s - b.s);
    for (let i = 0; i < list.length; ) {
      let j = i;
      while (j + 1 < list.length && list[j + 1].s - list[i].s <= STAND_REACH_M) j++;
      const group = list.slice(i, j + 1);
      const f = group[0];
      if (group.length >= STAND_MIN) {
        const n = Math.min(STAND_MAX, group.length);
        const c = roadside(
          'mailbox-stand',
          f.ri,
          f.side,
          f.s,
          houseLine(f.ri, f.side, 'mailbox-stand'),
          `gen:mailbox-stand:${f.key}`,
          'outskirts',
          0,
        );
        if (c) houseCandidates.push({ ...c, modelId: `mailbox-stand-${n}` });
      } else
        for (const g of group) {
          const c = roadside(
            'mailbox',
            g.ri,
            g.side,
            g.s - split(g),
            houseLine(g.ri, g.side, 'mailbox'),
            `gen:mailbox:${g.key}`,
            'outskirts',
            0,
          );
          if (c) houseCandidates.push({ ...c, modelId: MAILBOX_MODELS[Math.floor(hash01(c.id, 'colour') * 3)] });
        }
      i = j + 1;
    }
  }
  // a street cabinet in the verge after every few houses along a street, between two of them
  const byStreet = new Map<number, HouseFront[]>();
  for (const f of fronts) if (contexts[f.ri] !== 'outer') byStreet.set(f.ri, [...(byStreet.get(f.ri) ?? []), f]);
  for (const [ri, list] of byStreet) {
    list.sort((a, b) => a.s - b.s);
    const every = CABINET_EVERY_MIN + Math.floor(hash01(keys[ri], 'cabinets') * CABINET_EVERY_SPREAD);
    for (let n = every - 1; n + 1 < list.length; n += every) {
      const a = list[n];
      const s = (a.s + list[n + 1].s) / 2;
      const c = roadside(
        'street-cabinet',
        ri,
        a.side,
        s,
        houseLine(ri, a.side, 'street-cabinet'),
        `gen:street-cabinet:${keys[ri]}:${n}`,
        'street',
        0,
      );
      if (c) houseCandidates.push({ ...c, rank: 2 });
    }
  }
  for (const c of houseCandidates.sort(byOrder)) tryPlace(c);

  // ---------- 4. overrides: removals and moves of generated objects ----------
  let result = out.map(strip);
  for (const o of inp.overrides ?? []) {
    if (o.op === 'remove') result = result.filter(p => p.id !== o.id);
    else if (o.op === 'move')
      result = result.map(p => (p.id === o.id ? { ...p, x: o.x, z: o.z, source: 'override' as const } : p));
  }
  result.sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return { placements: result, torget, rejected, generated };
}

/** How many Torget should have, for the report and tests. */
export const TORGET_TARGETS = { benches: TORGET_BENCHES, bins: TORGET_BINS } as const;

/** Where each lamp's light comes from, in world space, for the day and night cycle (#99); y is above the ground. */
export function lampEmitters(placements: readonly FurniturePlacement[]) {
  return placements
    .filter(p => p.kind === 'street-lamp')
    .map(p => {
      const e = p.modelId === SHORT_LAMP_MODEL ? SHORT_LAMP_EMITTER : FURNITURE['street-lamp'].emitter!;
      const c = Math.cos(p.rotationY);
      const s = Math.sin(p.rotationY);
      const [ox, oy, oz] = e.offset;
      return {
        id: p.id,
        x: p.x + ox * c + oz * s,
        y: oy * p.scale,
        z: p.z - ox * s + oz * c,
        direction: e.direction,
        coneDeg: e.coneDeg,
        rangeM: e.rangeM,
      };
    });
}
