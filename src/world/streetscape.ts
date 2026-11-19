// The streetscape's layout (#187): curbs, sidewalks and verges along the roads, filleted junction corners, lowered
// curbs at driveways and crossings, street parking, parking-lot stalls and street-tree spots, as plain numbers.
// Pure: no three.js, no DOM. The mesh builders in mesh/ batch the triangles it makes; the map paints its outlines;
// StreetscapeIndex answers how high the walkable surface is under a point.
import type { BuildingIndex } from './buildings';
import {
  CrossingKind,
  Kerb,
  ParkingOrientation,
  RoadClass,
  RoadUse,
  ROAD_WIDTH_M,
  StreetParking,
  Surface,
  type WorldData,
} from './data';
import type { Heightfield } from './heightfield';
import { pointInPolygon, polygonBounds, segmentDistance } from './polygon';
import { mitreAt, resample, ribbonEdges, STEP_M } from './polyline';
import { hash01 } from './random';
import { nodeKey, type Point, type RoadNetwork, roadLiftM } from './roads';
import type { SideSpec, Source, StreetSides } from './streetscape-rules';

// ---------- cross-section and junction constants (game-design values; mapped values win where OSM has them) ----------
/** width of the curb's top, between the face and the verge or sidewalk (m) */
export const CURB_TOP_M = 0.15;
/** a lowered or flush curb still stands this high (m) */
export const LOWERED_CURB_M = 0.02;
/** a lowered curb eases back to full height over this, each side of the opening (m) */
const OPENING_EASE_M = 1.5;
/** a strip that ends ramps down to LOWERED_CURB_M over this (m) */
const RAMP_M = 1.5;
/** the outer skirt reaches this far below the terrain (m) */
export const SKIRT_BELOW_M = 0.1;
/** fillet radius of a junction corner's curb: streets, and corners on a primary or secondary road (m) */
const FILLET_STREET_M = 4;
const FILLET_MAJOR_M = 6;
/** arms meeting at less than this get no fillet: both strips just end (degrees) */
const MIN_CORNER_DEG = 30;
/** arms at least this far apart run straight on: no corner, no cut (degrees) */
const STRAIGHT_DEG = 150;
/** points of the fillet's curve */
const CORNER_SEGMENTS = 8;
/** a strip keeps clear of another road's carriageway by this (m) */
const CARRIAGEWAY_MARGIN_M = 0.3;
/** a building in the way narrows the sidewalk to this before the strip gives up (m) */
const MIN_NARROW_WIDTH_M = 1;
/** roads meeting this one are ignored by the carriageway test this close to their shared node; the junction rules handle them (m) */
const JOINED_REACH_M = 12;
/** half the opening a crossing lowers the curb over (m) */
const CROSSING_HALF_M = 1.5;
/** a driveway's opening is its width plus this (m) */
const DRIVEWAY_EXTRA_M = 1;
/** half the opening a lowered kerb node makes, and how far from the road it may be to count (m) */
const KERB_HALF_M = 1;
const KERB_REACH_M = 4;
/** zebra bars: width across the road, gap between them, length along it, lift above the road (m) */
const ZEBRA_BAR_M = 0.5;
const ZEBRA_GAP_M = 0.5;
const ZEBRA_LENGTH_M = 3;
export const MARKING_LIFT_M = 0.02;
const MARKING_LINE_M = 0.1;
/** street parking: bay depth by orientation (m), and how far bays stop short of junctions, crossings and driveways (m) */
const BAY_DEPTH_M = { [ParkingOrientation.UNKNOWN]: 2, [ParkingOrientation.PARALLEL]: 2, [ParkingOrientation.DIAGONAL]: 4.5, [ParkingOrientation.PERPENDICULAR]: 5 };
const BAY_LENGTH_M = { [ParkingOrientation.UNKNOWN]: 5.5, [ParkingOrientation.PARALLEL]: 5.5, [ParkingOrientation.DIAGONAL]: 3, [ParkingOrientation.PERPENDICULAR]: 2.5 };
const BAY_CLEAR_JUNCTION_M = 10;
const BAY_CLEAR_CROSSING_M = 5;
const BAY_CLEAR_DRIVEWAY_M = 3;
/** parking lots: stall size, aisle width, inset from the edge, clearance from an entering road, fewest stalls worth marking (m) */
const STALL_W_M = 2.5;
const STALL_L_M = 5;
const AISLE_M = 6;
const LOT_INSET_M = 1;
const LOT_ENTRY_CLEAR_M = 3;
const MIN_STALLS = 4;
/** street trees: spacing (m) plus up to the jitter, and the clearances of #187 §10 (m) */
const TREE_SPACING_M = 12;
const TREE_JITTER_M = 6;
const TREE_CLEAR_JUNCTION_M = 10;
const TREE_CLEAR_DRIVEWAY_M = 3;
const TREE_CLEAR_BUILDING_M = 4;
const TREE_CLEAR_TREE_M = 4;
/** lookup cell of StreetscapeIndex (m) */
const INDEX_CELL_M = 25;

/** what a triangle is, for its colour */
export const Part = { CURB_FACE: 0, CURB_TOP: 1, VERGE: 2, SIDEWALK: 3, SKIRT: 4, ROAD: 5, PARKING: 6, MARKING: 7 } as const;
export type Part = (typeof Part)[keyof typeof Part];
export const SOURCES: readonly Source[] = ['mapped', 'derived', 'inferred'];

/** Triangles as flat arrays: 9 position numbers (x, y, z × 3) and one part, source, surface and tone per triangle. */
export interface Soup {
  pos: number[];
  part: Part[];
  /** index into SOURCES */
  src: number[];
  surface: Surface[];
  /** lightness variation, -1..1, from the way's hash */
  tone: number[];
}
const soup = (): Soup => ({ pos: [], part: [], src: [], surface: [], tone: [] });

/** One continuous strip: one side of one road between two ends. Outlines are flat [x, z, ...] along the road. */
export interface Strip {
  ri: number;
  /** -1 left, +1 right of the OSM way's direction */
  side: -1 | 1;
  source: Source;
  /** the carriageway edge (the curb line) and the strip's outer edge, station by station */
  inner: number[];
  outer: number[];
  /** length along the road (m) */
  lengthM: number;
}

export interface Corner {
  /** the curb's curve and the corner's outer edge, flat [x, z, ...], both from arm A's end to arm B's */
  inner: number[];
  outer: number[];
  source: Source;
}

export interface ParkingLot {
  /** index into data.pa */
  ai: number;
  source: Source;
  /** stall marking quads, flat [x, z × 4, ...]; mapped spaces or an inferred layout */
  stalls: number[];
  stallSource: Source | null;
  stallCount: number;
}

export interface Opening {
  ri: number;
  side: -1 | 1;
  /** where along the road (m) */
  s: number;
  half: number;
  kind: 'driveway' | 'crossing' | 'kerb';
}

export interface StreetTree {
  x: number;
  z: number;
  source: Source;
}

export interface StreetscapeLayout {
  /** the classification it was built from, one per road */
  sides: StreetSides[];
  strips: Strip[];
  corners: Corner[];
  openings: Opening[];
  /** raised strips, curbs, corners and their skirts */
  surface: Soup;
  /**
   * road-level fill by road class: the wedge between a corner's curve and the corner the two ribbons leave open, and
   * street-side parking bays; drawn as that class's road
   */
  roadPatches: Soup[];
  /** zebra bars and street parking bay lines */
  markings: Soup;
  lots: ParkingLot[];
  /** stall lines in the parking lots */
  lotMarkings: Soup;
  /** mapped crossing nodes the streetscape drew (markings or lowered curbs) */
  crossings: number;
  /** street trees: mapped ones first, then inferred */
  trees: StreetTree[];
  /** sidewalk length by source (m) */
  sidewalkM: Record<Source, number>;
}

export interface StreetscapeInputs {
  data: WorldData;
  roads: Pick<RoadNetwork, 'lines' | 'grid'>;
  heightfield: Pick<Heightfield, 'heightAt'>;
  buildings: Pick<BuildingIndex, 'footprints' | 'grid'>;
  water?: { inWater(x: number, z: number): boolean };
  sides: StreetSides[];
  /** tree spots already taken (forest trees), flat [x, z, ...]; street trees keep TREE_CLEAR_TREE_M from them */
  avoidTrees?: number[];
  /** street trees keep this from any other road's carriageway edge (m) */
  treeRoadClearanceM?: number;
}

// ---------- small geometry helpers ----------
type V2 = [number, number];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const lerp2 = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const bezier = (a: V2, k: V2, b: V2, t: number): V2 => lerp2(lerp2(a, k, t), lerp2(k, b, t), t);
const isCarriageway = (c: RoadClass, use: number | undefined) => c <= RoadClass.TRACK && use !== RoadUse.SIDEWALK && use !== RoadUse.CROSSING;
const isMinor = (c: RoadClass, use: number | undefined) => c >= RoadClass.SERVICE || (use !== undefined && use !== RoadUse.NONE);

/** Intersection of the lines p + d·t and q + e·u, or null when they are parallel. */
function intersect(p: V2, d: V2, q: V2, e: V2): V2 | null {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/**
 * Adds the quad a0, a1, b1, b0 (each [x, y, z]) as two triangles wound so their normal points along `want` (any
 * direction with a positive component the right way): outward winding, so FrontSide materials work.
 */
function quad(out: Soup, a0: number[], a1: number[], b1: number[], b0: number[], want: number[], part: Part, src: number, surf: Surface, tone: number) {
  tri(out, a0, a1, b1, want, part, src, surf, tone);
  tri(out, a0, b1, b0, want, part, src, surf, tone);
}

function tri(out: Soup, a: number[], b: number[], c: number[], want: number[], part: Part, src: number, surf: Surface, tone: number) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const area = Math.hypot(nx, ny, nz);
  if (area < 1e-6) return; // degenerate: skipped, never emitted
  if (nx * want[0] + ny * want[1] + nz * want[2] < 0) out.pos.push(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2]);
  else out.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  out.part.push(part);
  out.src.push(src);
  out.surface.push(surf);
  out.tone.push(tone);
}

// ---------- per-road sampling ----------
interface RoadSamples {
  q: Point[];
  /** arc length at each sample (m) */
  s: number[];
  /** arc length at each original vertex (m) */
  vs: number[];
  /** ribbon edge [left, right] at each sample, with its road height */
  edge: [V2, V2][];
  edgeY: [number, number][];
  /** mitred unit normal to the right and its scale, per sample */
  mn: V2[];
  ms: number[];
}

function sampleRoad(p: readonly Point[], c: RoadClass, heightfield: Pick<Heightfield, 'heightAt'>): RoadSamples {
  const q = resample(p, STEP_M);
  const s: number[] = [0];
  for (let i = 1; i < q.length; i++) s.push(s[i - 1] + Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]));
  // resample cuts each span into the same number of steps as this, so vertex v is sample `i` (its last point is
  // a + (b - a), which need not equal b to the last bit, so the vertices can't be found by comparing coordinates)
  const vs: number[] = [0];
  for (let v = 1, i = 0; v < p.length; v++) {
    i += Math.max(1, Math.ceil(Math.hypot(p[v][0] - p[v - 1][0], p[v][1] - p[v - 1][1]) / STEP_M));
    vs.push(s[i]);
  }
  const W = ROAD_WIDTH_M[c];
  const lift = roadLiftM(c);
  const edge: [V2, V2][] = [];
  const edgeY: [number, number][] = [];
  const mn: V2[] = [];
  const ms: number[] = [];
  for (let i = 0; i < q.length; i++) {
    const e = ribbonEdges(q, i, W);
    edge.push([[e.lx, e.lz], [e.rx, e.rz]]);
    edgeY.push([heightfield.heightAt(e.lx, e.lz) + lift, heightfield.heightAt(e.rx, e.rz) + lift]);
    const m = mitreAt(q, i);
    mn.push([m.nx, m.nz]);
    ms.push(m.scale);
  }
  return { q, s, vs, edge, edgeY, mn, ms };
}

/** sample segment and fraction at arc length s */
function locate(rs: RoadSamples, s: number): [number, number] {
  const n = rs.s.length;
  if (s <= 0 || n < 2) return [0, 0];
  if (s >= rs.s[n - 1]) return [n - 2, 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rs.s[mid] <= s) lo = mid;
    else hi = mid;
  }
  const span = rs.s[lo + 1] - rs.s[lo];
  return [lo, span > 0 ? (s - rs.s[lo]) / span : 0];
}

// ---------- the junction graph over every carriageway, driveways included ----------
interface Arm {
  ri: number;
  v: number;
  /** +1 when the road runs away from the node with rising vertex index */
  dir: 1 | -1;
  /** unit direction away from the node */
  d: V2;
  angle: number;
  half: number;
  minor: boolean;
}

/** A cut: no strip on (ri, side) over [s0, s1], at a junction. */
interface Cut {
  ri: number;
  side: -1 | 1;
  s0: number;
  s1: number;
}

interface CornerPlan {
  a: { ri: number; side: -1 | 1; s: number };
  b: { ri: number; side: -1 | 1; s: number };
  k: V2;
  kOuter: V2 | null;
  liftA: number;
  liftB: number;
  /** the bigger road's class: the wedge is drawn as that road */
  cls: RoadClass;
  /**
   * a half corner: arm b has no sidewalk on this side, so the corner turns into it and ramps down there. Its end on
   * b's curb line, and the outer point as deep as arm a's strip.
   */
  stub: { inner: V2; outer: V2 } | null;
}

/**
 * Builds the streetscape's layout. Deterministic: the same inputs give the same numbers, in the same order, and
 * nothing here calls rnd() or Math.random().
 */
export function buildStreetscape(inp: StreetscapeInputs): StreetscapeLayout {
  const { data, roads, heightfield, buildings, water, sides } = inp;
  const lines = roads.lines;
  const samples = lines.map((r) => (r.p.length > 1 ? sampleRoad(r.p, r.c, heightfield) : null));
  const surface = soup();
  const markings = soup();
  const lotMarkings = soup();
  const roadPatches = ROAD_WIDTH_M.map(() => soup());
  const openings: Opening[] = [];
  const cuts: Cut[] = [];
  const plans: CornerPlan[] = [];
  /** road ends that continue straight into another road: no ramp there */
  const joinedEnds = new Set<string>();
  /** node positions of junctions between streets, for the bay and tree clearances */
  const junctionPoints: V2[] = [];
  const crossingPoints: V2[] = [];
  let crossingCount = 0;

  const sideSpec = (ri: number, side: -1 | 1) => (side < 0 ? sides[ri].left : sides[ri].right);
  const hasStrip = (ri: number, side: -1 | 1) => sideSpec(ri, side).sidewalk === 'present';
  /** distance from the carriageway edge to the strip's outer edge (m) */
  const depthOf = (ri: number, side: -1 | 1) => {
    const sp = sideSpec(ri, side);
    return sp.sidewalk === 'present' ? CURB_TOP_M + sp.vergeM + sp.widthM + bayDepth(ri, side) : 0;
  };
  const bayDepth = (ri: number, side: -1 | 1) => {
    const sp = sideSpec(ri, side);
    return sp.parking === StreetParking.STREET_SIDE ? BAY_DEPTH_M[sp.orientation] : 0;
  };

  // ---------- junctions: arms, corners, cuts and driveway openings ----------
  const nodes = new Map<string, { ri: number; v: number }[]>();
  lines.forEach((r, ri) => {
    if (!isCarriageway(r.c, data.r[ri].s) || r.p.length < 2) return;
    r.p.forEach((p, v) => {
      const k = nodeKey(p);
      let l = nodes.get(k);
      if (!l) nodes.set(k, (l = []));
      l.push({ ri, v });
    });
  });
  const keys = [...nodes.keys()];
  for (const key of keys) {
    const at = nodes.get(key)!;
    const arms: Arm[] = [];
    for (const { ri, v } of at) {
      const p = lines[ri].p;
      for (const dir of [-1, 1] as const) {
        let w = v + dir;
        if (w < 0 || w >= p.length) continue;
        while (w + dir >= 0 && w + dir < p.length && Math.hypot(p[w][0] - p[v][0], p[w][1] - p[v][1]) < 0.5) w += dir;
        const len = Math.hypot(p[w][0] - p[v][0], p[w][1] - p[v][1]);
        if (len < 1e-6) continue;
        const d: V2 = [(p[w][0] - p[v][0]) / len, (p[w][1] - p[v][1]) / len];
        arms.push({ ri, v, dir, d, angle: Math.atan2(d[1], d[0]), half: ROAD_WIDTH_M[lines[ri].c] / 2, minor: isMinor(lines[ri].c, data.r[ri].s) });
      }
    }
    if (arms.length < 2) continue;
    const J = lines[at[0].ri].p[at[0].v] as V2;
    let major = arms.filter((a) => !a.minor);
    const minor = arms.filter((a) => a.minor);
    if (!major.length) major = arms;
    if (major.length >= 3) junctionPoints.push(J);

    // a driveway or service road meeting a street lowers the street's curb on its side, and the strip runs on across it
    if (major !== arms) {
      for (const m of minor) {
        if (major.some((a) => a.ri === m.ri)) continue;
        for (const a of major) {
          const rs = samples[a.ri];
          if (!rs) continue;
          // which side of the major road (its own direction) the minor arm leaves on
          const t: V2 = [a.d[0] * a.dir, a.d[1] * a.dir];
          const side = (Math.sign(-t[1] * m.d[0] + t[0] * m.d[1]) || 1) as -1 | 1;
          const s = rs.vs[a.v];
          if (!openings.some((o) => o.ri === a.ri && o.side === side && Math.abs(o.s - s) < 0.5))
            openings.push({ ri: a.ri, side, s, half: (ROAD_WIDTH_M[lines[m.ri].c] + DRIVEWAY_EXTRA_M) / 2, kind: 'driveway' });
        }
      }
    }

    if (major.length < 2) continue;
    if (major.length === 2) {
      let between = Math.abs(major[0].angle - major[1].angle);
      if (between > Math.PI) between = Math.PI * 2 - between;
      if (between >= (STRAIGHT_DEG * Math.PI) / 180) {
        // one road running on into the next: the strips meet, no corner, no ramp
        for (const a of major) joinedEnds.add(a.ri + ':' + a.v);
        continue;
      }
    }
    major.sort((a, b) => a.angle - b.angle);
    for (let i = 0; i < major.length; i++) {
      const A = major[i];
      const B = major[(i + 1) % major.length];
      let theta = B.angle - A.angle;
      if (theta <= 0) theta += Math.PI * 2;
      // arm A's side facing the sector is its right looking away from the node; B's is its left
      const sideA = (A.dir > 0 ? 1 : -1) as -1 | 1;
      const sideB = (B.dir > 0 ? -1 : 1) as -1 | 1;
      if (theta >= (STRAIGHT_DEG * Math.PI) / 180) {
        joinedEnds.add(A.ri + ':' + A.v + ':' + sideA);
        joinedEnds.add(B.ri + ':' + B.v + ':' + sideB);
        continue;
      }
      const stripA = hasStrip(A.ri, sideA);
      const stripB = hasStrip(B.ri, sideB);
      if (!stripA && !stripB) continue;
      const nA: V2 = [-A.d[1], A.d[0]];
      const nB: V2 = [B.d[1], -B.d[0]];
      const K = intersect([J[0] + nA[0] * A.half, J[1] + nA[1] * A.half], A.d, [J[0] + nB[0] * B.half, J[1] + nB[1] * B.half], B.d);
      if (!K) continue;
      const filleted = theta >= (MIN_CORNER_DEG * Math.PI) / 180;
      // a half corner: the arm without a sidewalk gets a stub as deep as the other's, so the corner rounds into it
      let depthA = stripA ? depthOf(A.ri, sideA) : 0;
      let depthB = stripB ? depthOf(B.ri, sideB) : 0;
      if (filleted && !stripA) depthA = depthB;
      if (filleted && !stripB) depthB = depthA;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      const R = lines[A.ri].c <= RoadClass.SECONDARY || lines[B.ri].c <= RoadClass.SECONDARY ? FILLET_MAJOR_M : FILLET_STREET_M;
      // how far past K each strip must start so it clears the other arm's strip (or curb line), plus the fillet
      const clearA = (depthB + Math.max(0, depthA * cos)) / sin + 0.2;
      const clearB = (depthA + Math.max(0, depthB * cos)) / sin + 0.2;
      const tangent = filleted ? R / Math.tan(theta / 2) : 0;
      const aA = Math.max(clearA, tangent);
      const aB = Math.max(clearB, tangent);
      const kA = dot(sub(K, J), A.d);
      const kB = dot(sub(K, J), B.d);
      const cutA = Math.max(0, kA + aA);
      const cutB = Math.max(0, kB + aB);
      const rsA = samples[A.ri]!;
      const rsB = samples[B.ri]!;
      const sA = rsA.vs[A.v];
      const sB = rsB.vs[B.v];
      const endA = A.dir > 0 ? sA + cutA : sA - cutA;
      const endB = B.dir > 0 ? sB + cutB : sB - cutB;
      if (stripA) cuts.push({ ri: A.ri, side: sideA, s0: Math.min(sA, endA), s1: Math.max(sA, endA) });
      if (stripB) cuts.push({ ri: B.ri, side: sideB, s0: Math.min(sB, endB), s1: Math.max(sB, endB) });
      if (filleted) {
        const kOuter = intersect(
          [J[0] + nA[0] * (A.half + depthA), J[1] + nA[1] * (A.half + depthA)],
          A.d,
          [J[0] + nB[0] * (B.half + depthB), J[1] + nB[1] * (B.half + depthB)],
          B.d,
        );
        const a = { ri: A.ri, side: sideA, s: endA };
        const b = { ri: B.ri, side: sideB, s: endB };
        const cls = Math.min(lines[A.ri].c, lines[B.ri].c) as RoadClass;
        if (stripA && stripB) plans.push({ a, b, k: K, kOuter, liftA: roadLiftM(lines[A.ri].c), liftB: roadLiftM(lines[B.ri].c), cls, stub: null });
        else {
          // keep the real strip as a; the stub ends on the other arm's curb line, past K by the same clearance a strip would need
          const [real, other, n, d, aOther, depth] = stripA ? [a, b, nB, B.d, aB, depthA] : [b, a, nA, A.d, aA, depthB];
          const inner: V2 = [K[0] + d[0] * aOther, K[1] + d[1] * aOther];
          const stub = { inner, outer: [inner[0] + n[0] * depth, inner[1] + n[1] * depth] as V2 };
          const liftReal = roadLiftM(lines[real.ri].c);
          plans.push({ a: real, b: other, k: K, kOuter, liftA: liftReal, liftB: roadLiftM(lines[other.ri].c), cls, stub });
        }
      }
    }
  }

  // ---------- crossings: mapped nodes on a road, crossing ways meeting one, lowered kerb nodes ----------
  for (const x of data.x ?? []) {
    if (x.r === undefined || x.v === undefined || !samples[x.r]) continue;
    const s = samples[x.r]!.vs[x.v];
    for (const side of [-1, 1] as const) openings.push({ ri: x.r, side, s, half: CROSSING_HALF_M, kind: 'crossing' });
    crossingPoints.push([x.x, x.z]);
    crossingCount++;
    if (x.k === CrossingKind.MARKED) zebra(x.r, s);
  }
  lines.forEach((r, ri) => {
    if (data.r[ri].s !== RoadUse.CROSSING) return;
    for (const p of r.p) {
      for (const { ri: rj, v } of nodes.get(nodeKey(p)) ?? []) {
        if (isMinor(lines[rj].c, data.r[rj].s) && lines[rj].c > RoadClass.SERVICE) continue;
        const s = samples[rj]!.vs[v];
        if (openings.some((o) => o.ri === rj && o.kind === 'crossing' && Math.abs(o.s - s) < 1)) continue;
        for (const side of [-1, 1] as const) openings.push({ ri: rj, side, s, half: CROSSING_HALF_M, kind: 'crossing' });
        crossingPoints.push([p[0], p[1]]);
      }
    }
  });
  for (const k of data.kb ?? []) {
    if (k.kb !== Kerb.LOWERED && k.kb !== Kerb.FLUSH) continue;
    const near = nearestSide(k.x, k.z);
    if (near) openings.push({ ...near, half: KERB_HALF_M, kind: 'kerb' });
  }
  for (const x of data.x ?? []) {
    if (x.r !== undefined || (x.kb !== Kerb.LOWERED && x.kb !== Kerb.FLUSH)) continue;
    const near = nearestSide(x.x, x.z);
    if (near) openings.push({ ...near, half: KERB_HALF_M, kind: 'kerb' });
  }

  /** the road side nearest (x, z), if the point is within KERB_REACH_M of a carriageway edge */
  function nearestSide(x: number, z: number): { ri: number; side: -1 | 1; s: number } | null {
    let best: { ri: number; side: -1 | 1; s: number } | null = null;
    let bestD = KERB_REACH_M;
    const list = roads.grid.get(Math.floor(x / 50) + ',' + Math.floor(z / 50)) ?? [];
    for (let i = 0; i < list.length; i += 5) {
      const ri = list[i + 4];
      if (!isCarriageway(lines[ri].c, data.r[ri].s) || !samples[ri]) continue;
      const d = segmentDistance(x, z, list[i], list[i + 1], list[i + 2], list[i + 3]) - ROAD_WIDTH_M[lines[ri].c] / 2;
      if (d >= bestD) continue;
      const rs = samples[ri]!;
      // nearest sample segment gives the arc length and side
      let bs = 0;
      let bd = Infinity;
      let side: -1 | 1 = 1;
      for (let k = 1; k < rs.q.length; k++) {
        const [ax, az] = rs.q[k - 1];
        const [bx, bz] = rs.q[k];
        const dd = segmentDistance(x, z, ax, az, bx, bz);
        if (dd < bd) {
          bd = dd;
          const len = Math.hypot(bx - ax, bz - az) || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (len * len)));
          bs = rs.s[k - 1] + t * len;
          side = (Math.sign(-(bz - az) * (x - ax) + (bx - ax) * (z - az)) || 1) as -1 | 1;
        }
      }
      bestD = d;
      best = { ri, side, s: bs };
    }
    return best;
  }

  /** zebra bars across road ri at arc length s, along the road's direction */
  function zebra(ri: number, s: number) {
    const rs = samples[ri]!;
    const [i, f] = locate(rs, s);
    const c = lerp2(rs.q[i] as V2, rs.q[i + 1] as V2, f);
    const t = sub(rs.q[i + 1] as V2, rs.q[i] as V2);
    const tl = Math.hypot(t[0], t[1]) || 1;
    const d: V2 = [t[0] / tl, t[1] / tl];
    const n: V2 = [-d[1], d[0]];
    const half = ROAD_WIDTH_M[lines[ri].c] / 2;
    const lift = roadLiftM(lines[ri].c) + MARKING_LIFT_M;
    for (let o = -half + ZEBRA_GAP_M; o + ZEBRA_BAR_M <= half - ZEBRA_GAP_M + 1e-9; o += ZEBRA_BAR_M + ZEBRA_GAP_M) {
      const corners = [
        [o, -ZEBRA_LENGTH_M / 2],
        [o + ZEBRA_BAR_M, -ZEBRA_LENGTH_M / 2],
        [o + ZEBRA_BAR_M, ZEBRA_LENGTH_M / 2],
        [o, ZEBRA_LENGTH_M / 2],
      ].map(([a, b]) => {
        const x = c[0] + n[0] * a + d[0] * b;
        const z = c[1] + n[1] * a + d[1] * b;
        return [x, heightfield.heightAt(x, z) + lift, z];
      });
      quad(markings, corners[0], corners[1], corners[2], corners[3], [0, 1, 0], Part.MARKING, 0, Surface.UNKNOWN, 0);
    }
  }

  // ---------- carriageway, building and water tests for a strip point ----------
  const joinedNodes = lines.map(() => [] as V2[]);
  for (const at of nodes.values()) {
    if (at.length < 2) continue;
    for (const a of at) joinedNodes[a.ri].push(lines[a.ri].p[a.v] as V2);
  }
  function inOtherCarriageway(ri: number, x: number, z: number) {
    const list = roads.grid.get(Math.floor(x / 50) + ',' + Math.floor(z / 50));
    if (!list) return false;
    for (let i = 0; i < list.length; i += 5) {
      const rj = list[i + 4];
      if (rj === ri || !isCarriageway(lines[rj].c, data.r[rj].s)) continue;
      const d = segmentDistance(x, z, list[i], list[i + 1], list[i + 2], list[i + 3]) - ROAD_WIDTH_M[lines[rj].c] / 2;
      if (d >= CARRIAGEWAY_MARGIN_M) continue;
      // a road joined to this one near here is the junction rules' business
      if (joinedNodes[rj].some((p) => Math.hypot(p[0] - x, p[1] - z) < JOINED_REACH_M && joinedNodes[ri].some((q) => q[0] === p[0] && q[1] === p[1]))) continue;
      return true;
    }
    return false;
  }
  // the water test scans every lake and river segment: ask it only in cells near water
  const WATER_CELL_M = 25;
  const wetCells = new Set<string>();
  const markWet = (x0: number, z0: number, x1: number, z1: number) => {
    for (let x = Math.floor((x0 - 6) / WATER_CELL_M); x <= Math.floor((x1 + 6) / WATER_CELL_M); x++)
      for (let z = Math.floor((z0 - 6) / WATER_CELL_M); z <= Math.floor((z1 + 6) / WATER_CELL_M); z++) wetCells.add(x + ',' + z);
  };
  for (const lake of data.w) for (const ring of lake) {
    const b = polygonBounds(ring);
    markWet(b.x0, b.z0, b.x1, b.z1);
  }
  for (const w of data.ww) for (let i = 2; i < w.p.length; i += 2) markWet(Math.min(w.p[i - 2], w.p[i]), Math.min(w.p[i - 1], w.p[i + 1]), Math.max(w.p[i - 2], w.p[i]), Math.max(w.p[i - 1], w.p[i + 1]));
  const inWater = (x: number, z: number) => !!water && wetCells.has(Math.floor(x / WATER_CELL_M) + ',' + Math.floor(z / WATER_CELL_M)) && water.inWater(x, z);

  function buildingAt(x: number, z: number) {
    const list = buildings.grid.get(Math.floor(x / 40) + ',' + Math.floor(z / 40));
    if (!list) return false;
    for (const bi of list) {
      const b = buildings.footprints[bi];
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && pointInPolygon(b.p, x, z)) return true;
    }
    return false;
  }
  function buildingDistance(x: number, z: number, reach: number) {
    let best = Infinity;
    for (let gx = Math.floor((x - reach) / 40); gx <= Math.floor((x + reach) / 40); gx++) {
      for (let gz = Math.floor((z - reach) / 40); gz <= Math.floor((z + reach) / 40); gz++) {
        for (const bi of buildings.grid.get(gx + ',' + gz) ?? []) {
          const b = buildings.footprints[bi];
          if (x < b.x0 - reach || x > b.x1 + reach || z < b.z0 - reach || z > b.z1 + reach) continue;
          if (pointInPolygon(b.p, x, z)) return 0;
          const p = b.p;
          for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) best = Math.min(best, segmentDistance(x, z, p[j], p[j + 1], p[i], p[i + 1]));
        }
      }
    }
    return best;
  }

  // ---------- strips ----------
  interface Station {
    s: number;
    i: number;
    f: number;
    width: number;
    curb: number;
    bay: number;
  }
  const strips: Strip[] = [];
  const sidewalkM: Record<Source, number> = { mapped: 0, derived: 0, inferred: 0 };
  /** strip end cross-sections by "ri:side:s", for the corners: inner and outer point and the heights there */
  const ends = new Map<string, { inner: V2; outer: V2; curb: number; innerY: number }>();
  const endKey = (ri: number, side: number, s: number) => ri + ':' + side + ':' + Math.round(s * 100);
  const runs: { ri: number; side: -1 | 1; run: Station[]; rs: RoadSamples; L: number }[] = [];

  lines.forEach((r, ri) => {
    const rs = samples[ri];
    if (!rs) return;
    const L = rs.s[rs.s.length - 1];
    for (const side of [-1, 1] as const) {
      const sp = sideSpec(ri, side);
      if (sp.sidewalk !== 'present') continue;
      const k = side < 0 ? 0 : 1;
      const myCuts = cuts.filter((c) => c.ri === ri && c.side === side);
      const myOpenings = openings.filter((o) => o.ri === ri && o.side === side);
      // stations: every sample, plus every cut edge and opening edge
      const at = new Set<number>(rs.s);
      for (const c of myCuts) for (const v of [c.s0, c.s1]) if (v > 0 && v < L) at.add(v);
      for (const o of myOpenings) {
        for (const v of [o.s - o.half - OPENING_EASE_M, o.s - o.half, o.s + o.half, o.s + o.half + OPENING_EASE_M]) if (v > 0 && v < L) at.add(v);
      }
      const ss = [...at].sort((a, b) => a - b);
      const bay = bayDepth(ri, side);
      const sep = sp.separate;
      const kept: (Station | null)[] = ss.map((s) => {
        if (myCuts.some((c) => s > c.s0 + 1e-6 && s < c.s1 - 1e-6)) return null;
        const [i, f] = locate(rs, s);
        if (sep && sep[f < 0.5 ? i : i + 1]) return null;
        if (!(rs.ms[i] > 0) || !(rs.ms[Math.min(i + 1, rs.ms.length - 1)] > 0)) return null; // past the mitre limit: split
        let width = sp.widthM;
        const st: Station = { s, i, f, width, curb: sp.curbM, bay };
        const out = crossPoint(rs, st, side, ri, CURB_TOP_M + sp.vergeM + width + bay);
        const mid = crossPoint(rs, st, side, ri, CURB_TOP_M + sp.vergeM + bay);
        if (inOtherCarriageway(ri, out[0], out[1]) || inOtherCarriageway(ri, mid[0], mid[1])) return null;
        if (buildingAt(mid[0], mid[1])) return null;
        if (buildingAt(out[0], out[1])) {
          width = Math.min(width, MIN_NARROW_WIDTH_M);
          const o2 = crossPoint(rs, st, side, ri, CURB_TOP_M + sp.vergeM + width + bay);
          if (buildingAt(o2[0], o2[1])) return null;
          st.width = width;
        }
        if (inWater(out[0], out[1])) return null;
        return st;
      });
      // curb height: lowered at openings, eased back over OPENING_EASE_M
      for (const st of kept) {
        if (!st) continue;
        for (const o of myOpenings) {
          const d = Math.abs(st.s - o.s) - o.half;
          const h = d <= 0 ? LOWERED_CURB_M : d >= OPENING_EASE_M ? sp.curbM : LOWERED_CURB_M + ((sp.curbM - LOWERED_CURB_M) * d) / OPENING_EASE_M;
          st.curb = Math.min(st.curb, h);
        }
      }
      // runs of kept stations; emitted once every run is known, so a corner is only counted on when both its ends exist
      let run: Station[] = [];
      const flush = () => {
        if (run.length >= 2 && run[run.length - 1].s - run[0].s > 0.5) runs.push({ ri, side, run, rs, L });
        run = [];
      };
      for (const st of kept) {
        if (st) run.push(st);
        else flush();
      }
      flush();
    }
  });

  // a corner is built only where both strips reach it; anywhere else the strip ends with a ramp
  const runEnds = new Set<string>();
  for (const r of runs) for (const st of [r.run[0], r.run[r.run.length - 1]]) runEnds.add(endKey(r.ri, r.side, st.s));
  const cornerEnds = new Set<string>();
  for (const plan of plans) {
    const a = endKey(plan.a.ri, plan.a.side, plan.a.s);
    const b = endKey(plan.b.ri, plan.b.side, plan.b.s);
    if (!plan.stub) {
      if (runEnds.has(a) && runEnds.has(b)) cornerEnds.add(a).add(b);
      continue;
    }
    // a stub needs clear ground: no building, water or other road where it would stand
    const { inner, outer } = plan.stub;
    const blocked = [inner, outer, lerp2(inner, outer, 0.5)].some(
      ([x, z]) => buildingAt(x, z) || inWater(x, z) || inOtherCarriageway(plan.b.ri, x, z) || inOtherCarriageway(plan.a.ri, x, z),
    );
    if (runEnds.has(a) && !blocked) cornerEnds.add(a);
    else plan.stub = null; // the strip ramps down on its own, as before
  }
  for (const r of runs) emitRun(r.ri, r.side, r.run, r.rs, r.L);

  /** The point `d` metres out from road ri's carriageway edge on `side` at station st (mitred, lerped between samples). */
  function crossPoint(rs: RoadSamples, st: { i: number; f: number }, side: -1 | 1, ri: number, d: number): V2 {
    const off = (ROAD_WIDTH_M[lines[ri].c] / 2 + d) * side;
    const i = st.i;
    const j = Math.min(i + 1, rs.q.length - 1);
    const mi = off * rs.ms[i];
    const mj = off * rs.ms[j];
    const ax = rs.q[i][0] + rs.mn[i][0] * mi;
    const az = rs.q[i][1] + rs.mn[i][1] * mi;
    const f = st.f;
    return [ax + (rs.q[j][0] + rs.mn[j][0] * mj - ax) * f, az + (rs.q[j][1] + rs.mn[j][1] * mj - az) * f];
  }

  /** the ribbon edge on `side` at station st, and the road's height there (exactly the ribbon's at a sample) */
  function edgeAt(rs: RoadSamples, st: { i: number; f: number }, side: -1 | 1): [V2, number] {
    const k = side < 0 ? 0 : 1;
    const j = Math.min(st.i + 1, rs.q.length - 1);
    const e = lerp2(rs.edge[st.i][k], rs.edge[j][k], st.f);
    const y = rs.edgeY[st.i][k] + (rs.edgeY[j][k] - rs.edgeY[st.i][k]) * st.f;
    return [e, y];
  }

  function emitRun(ri: number, side: -1 | 1, run: Station[], rs: RoadSamples, L: number) {
    const sp = sideSpec(ri, side);
    const lift = roadLiftM(lines[ri].c);
    const src = SOURCES.indexOf(sp.source);
    const tone = hash01(data.r[ri].i ?? ri, side, 'tone') * 2 - 1;
    const surf = sp.surface;
    // ramps: an end that no corner and no continuing road joins eases down over RAMP_M
    const joined = (s: number) => {
      if (cornerEnds.has(endKey(ri, side, s))) return true;
      const p = lines[ri].p;
      const v = s < 1e-6 ? 0 : s > L - 1e-6 ? p.length - 1 : -1;
      return v >= 0 && (joinedEnds.has(ri + ':' + v) || joinedEnds.has(ri + ':' + v + ':' + side));
    };
    const s0 = run[0].s;
    const s1 = run[run.length - 1].s;
    const ramp0 = !joined(s0);
    const ramp1 = !joined(s1);
    if (ramp0 || ramp1) {
      // make sure there is a station RAMP_M in from each ramped end
      const extra: Station[] = [];
      for (const [want, on] of [[s0 + RAMP_M, ramp0], [s1 - RAMP_M, ramp1]] as const) {
        if (!on || want <= s0 || want >= s1 || run.some((st) => Math.abs(st.s - want) < 0.05)) continue;
        const idx = run.findIndex((st) => st.s > want);
        const a = run[idx - 1];
        const b = run[idx];
        const t = (want - a.s) / (b.s - a.s);
        const [i, f] = locate(rs, want);
        extra.push({ s: want, i, f, width: a.width + (b.width - a.width) * t, curb: a.curb + (b.curb - a.curb) * t, bay: a.bay });
      }
      run = [...run, ...extra].sort((a, b) => a.s - b.s);
      for (const st of run) {
        const d = Math.min(ramp0 ? st.s - s0 : Infinity, ramp1 ? s1 - st.s : Infinity);
        if (d < RAMP_M) st.curb = Math.min(st.curb, LOWERED_CURB_M + ((sp.curbM - LOWERED_CURB_M) * d) / RAMP_M);
      }
    }
    // street-side bays stop short of junctions, crossings and driveways
    for (const st of run) if (st.bay && bayBlocked(ri, side, st.s, rs)) st.bay = 0;

    const pts = run.map((st) => {
      const [e, roadY] = edgeAt(rs, st, side);
      const y = (p: V2) => heightfield.heightAt(p[0], p[1]) + lift + st.curb;
      const bayP = st.bay ? crossPoint(rs, st, side, ri, st.bay) : e;
      const top0 = st.bay ? bayP : e;
      const p1 = crossPoint(rs, st, side, ri, st.bay + CURB_TOP_M);
      const p2 = crossPoint(rs, st, side, ri, st.bay + CURB_TOP_M + sp.vergeM);
      const p3 = crossPoint(rs, st, side, ri, st.bay + CURB_TOP_M + sp.vergeM + st.width);
      const bayY = st.bay ? heightfield.heightAt(bayP[0], bayP[1]) + lift : roadY;
      return {
        e: [e[0], roadY, e[1]],
        b0: [bayP[0], bayY, bayP[1]],
        // the curb's inner top is exactly curb above the road at the ribbon edge (or the bay's edge)
        t0: [top0[0], (st.bay ? bayY : roadY) + st.curb, top0[1]],
        t1: [p1[0], y(p1), p1[1]],
        t2: [p2[0], y(p2), p2[1]],
        t3: [p3[0], y(p3), p3[1]],
        g3: [p3[0], heightfield.heightAt(p3[0], p3[1]) - SKIRT_BELOW_M, p3[1]],
        out: p3,
        inner: top0,
        curb: st.curb,
        innerY: st.bay ? bayY : roadY,
        bay: st.bay,
        n: [p1[0] - e[0], p1[1] - e[1]] as V2,
      };
    });
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1];
      const b = pts[k];
      // outward = away from the road along the cross-section, towards the road for the face
      const out = [b.n[0] + a.n[0], 0, b.n[1] + a.n[1]];
      const toward = [-out[0], 0, -out[2]];
      if (a.bay || b.bay) quad(roadPatches[lines[ri].c], a.e, a.b0, b.b0, b.e, [0, 1, 0], Part.ROAD, src, Surface.ASPHALT, tone);
      quad(surface, a.b0, a.t0, b.t0, b.b0, toward, Part.CURB_FACE, src, surf, tone);
      quad(surface, a.t0, a.t1, b.t1, b.t0, [0, 1, 0], Part.CURB_TOP, src, surf, tone);
      if (sp.vergeM > 0) quad(surface, a.t1, a.t2, b.t2, b.t1, [0, 1, 0], Part.VERGE, src, Surface.GRASS, tone);
      quad(surface, a.t2, a.t3, b.t3, b.t2, [0, 1, 0], Part.SIDEWALK, src, surf, tone);
      quad(surface, a.t3, a.g3, b.g3, b.t3, out, Part.SKIRT, src, surf, tone);
    }
    // end caps, so a strip never shows an open edge
    for (const [p, dirSign] of [[pts[0], -1], [pts[pts.length - 1], 1]] as const) {
      const other = dirSign < 0 ? pts[1] : pts[pts.length - 2];
      const along = [p.e[0] - other.e[0], 0, p.e[2] - other.e[2]];
      const below = (q: number[]) => [q[0], Math.min(heightfield.heightAt(q[0], q[2]) - SKIRT_BELOW_M, q[1]), q[2]];
      for (const [u, w] of [[p.t0, p.t1], [p.t1, p.t2], [p.t2, p.t3]] as const) {
        if (Math.hypot(u[0] - w[0], u[2] - w[2]) < 1e-6) continue;
        quad(surface, below(u), u, w, below(w), along, Part.SKIRT, src, surf, tone);
      }
    }
    // stall marks on a sidewalk that is parked on
    if (sp.parking === StreetParking.ON_KERB || sp.parking === StreetParking.HALF_ON_KERB) bayTicks(ri, side, run, rs, sp.vergeM + CURB_TOP_M, sp.curbM);

    const inner: number[] = [];
    const outer: number[] = [];
    for (const p of pts) {
      inner.push(p.inner[0], p.inner[1]);
      outer.push(p.out[0], p.out[1]);
    }
    const lengthM = s1 - s0;
    strips.push({ ri, side, source: sp.source, inner, outer, lengthM });
    sidewalkM[sp.source] += lengthM;
    for (const [st, p] of [[run[0], pts[0]], [run[run.length - 1], pts[pts.length - 1]]] as const) {
      ends.set(endKey(ri, side, st.s), { inner: p.inner, outer: p.out, curb: p.curb, innerY: p.innerY });
    }
  }

  function bayBlocked(ri: number, side: -1 | 1, s: number, rs: RoadSamples) {
    const [i, f] = locate(rs, s);
    const c = lerp2(rs.q[i] as V2, rs.q[Math.min(i + 1, rs.q.length - 1)] as V2, f);
    if (junctionPoints.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < BAY_CLEAR_JUNCTION_M)) return true;
    if (crossingPoints.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < BAY_CLEAR_CROSSING_M)) return true;
    return openings.some((o) => o.ri === ri && o.side === side && Math.abs(o.s - s) < o.half + (o.kind === 'crossing' ? BAY_CLEAR_CROSSING_M : BAY_CLEAR_DRIVEWAY_M));
  }

  /** Painted bay lines: a long line `d0` out from the carriageway edge and a tick every bay length, outside blocked stretches. */
  function bayTicks(ri: number, side: -1 | 1, run: { s: number }[], rs: RoadSamples, d0: number, raise: number) {
    const sp = sideSpec(ri, side);
    const depth = BAY_DEPTH_M[sp.orientation];
    const step = BAY_LENGTH_M[sp.orientation];
    const lift = roadLiftM(lines[ri].c) + raise + MARKING_LIFT_M;
    const put = (s: number, da: number, db: number, along: number) => {
      const [i, f] = locate(rs, s);
      const [j, g] = locate(rs, s + along);
      const a0 = crossPoint(rs, { i, f }, side, ri, da);
      const a1 = crossPoint(rs, { i, f }, side, ri, db);
      const b1 = crossPoint(rs, { i: j, f: g }, side, ri, db);
      const b0 = crossPoint(rs, { i: j, f: g }, side, ri, da);
      const y = (p: V2) => [p[0], heightfield.heightAt(p[0], p[1]) + lift, p[1]];
      quad(markings, y(a0), y(a1), y(b1), y(b0), [0, 1, 0], Part.MARKING, 0, Surface.UNKNOWN, 0);
    };
    const s0 = run[0].s;
    const s1 = run[run.length - 1].s;
    for (let s = s0; s + step <= s1; s += step) {
      if (bayBlocked(ri, side, s, rs) || bayBlocked(ri, side, s + step, rs)) continue;
      put(s, d0, d0 + depth, MARKING_LINE_M);
      put(s, d0, d0 + MARKING_LINE_M, step);
    }
  }

  // street parking in the lane: lines inside the carriageway edge, the driving width unchanged
  lines.forEach((r, ri) => {
    const rs = samples[ri];
    if (!rs) return;
    for (const side of [-1, 1] as const) {
      if (sideSpec(ri, side).parking !== StreetParking.LANE) continue;
      const depth = Math.min(BAY_DEPTH_M[sideSpec(ri, side).orientation], ROAD_WIDTH_M[r.c] / 2 - 0.5);
      if (depth <= 0) continue;
      bayTicks(ri, side, [{ s: 0 }, { s: rs.s[rs.s.length - 1] }], rs, -depth, 0); // d < 0: inside the carriageway edge
    }
  });

  // ---------- junction corners ----------
  const corners: Corner[] = [];
  for (const plan of plans) {
    const ea = ends.get(endKey(plan.a.ri, plan.a.side, plan.a.s));
    const stub = plan.stub;
    // a stub's end is lowered: the corner ramps down as it turns into the street without a sidewalk
    const eb = stub
      ? { inner: stub.inner, outer: stub.outer, curb: LOWERED_CURB_M, innerY: heightfield.heightAt(stub.inner[0], stub.inner[1]) + plan.liftB }
      : ends.get(endKey(plan.b.ri, plan.b.side, plan.b.s));
    if (!ea || !eb || (stub && !cornerEnds.has(endKey(plan.a.ri, plan.a.side, plan.a.s)))) continue; // trimmed short of its corner: the strip keeps its ramped end
    const ka = plan.k;
    const ko = plan.kOuter ?? lerp2(ea.outer, eb.outer, 0.5);
    const srcA = sideSpec(plan.a.ri, plan.a.side).source;
    const srcB = stub ? srcA : sideSpec(plan.b.ri, plan.b.side).source;
    // a corner is as good as its weaker arm's evidence
    const source = SOURCES[Math.max(SOURCES.indexOf(srcA), SOURCES.indexOf(srcB))];
    const src = SOURCES.indexOf(source);
    const surf = sideSpec(plan.a.ri, plan.a.side).surface;
    const pts: { e: number[]; t0: number[]; t1: number[]; t3: number[]; g3: number[]; inner: V2; out: V2 }[] = [];
    // a stub keeps the full curb round the bend and ramps down over its last RAMP_M of curb line
    const curve = Array.from({ length: CORNER_SEGMENTS + 1 }, (_, k) => bezier(ea.inner, ka, eb.inner, k / CORNER_SEGMENTS));
    const toEnd = curve.map(() => 0);
    for (let k = CORNER_SEGMENTS - 1; k >= 0; k--) toEnd[k] = toEnd[k + 1] + Math.hypot(curve[k + 1][0] - curve[k][0], curve[k + 1][1] - curve[k][1]);
    for (let k = 0; k <= CORNER_SEGMENTS; k++) {
      const t = k / CORNER_SEGMENTS;
      const inner = curve[k];
      const out = bezier(ea.outer, ko, eb.outer, t);
      const curb = stub
        ? Math.min(ea.curb, LOWERED_CURB_M + ((ea.curb - LOWERED_CURB_M) * toEnd[k]) / RAMP_M)
        : ea.curb + (eb.curb - ea.curb) * t;
      const lift = plan.liftA + (plan.liftB - plan.liftA) * t;
      // the ends sit exactly on the strips' end heights; in between, the same formula as the strips
      const roadY = k === 0 ? ea.innerY : k === CORNER_SEGMENTS ? eb.innerY : heightfield.heightAt(inner[0], inner[1]) + lift;
      const span = Math.hypot(out[0] - inner[0], out[1] - inner[1]) || 1;
      const p1 = lerp2(inner, out, Math.min(1, CURB_TOP_M / span));
      const y = (p: V2) => heightfield.heightAt(p[0], p[1]) + lift + curb;
      pts.push({
        e: [inner[0], roadY, inner[1]],
        t0: [inner[0], roadY + curb, inner[1]],
        t1: [p1[0], y(p1), p1[1]],
        t3: [out[0], y(out), out[1]],
        g3: [out[0], heightfield.heightAt(out[0], out[1]) - SKIRT_BELOW_M, out[1]],
        inner,
        out,
      });
    }
    const kY = heightfield.heightAt(ka[0], ka[1]) + (plan.liftA + plan.liftB) / 2;
    const kp = [ka[0], kY, ka[1]];
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1];
      const b = pts[k];
      const out: number[] = [b.out[0] + a.out[0] - b.inner[0] - a.inner[0], 0, b.out[1] + a.out[1] - b.inner[1] - a.inner[1]];
      quad(surface, a.e, a.t0, b.t0, b.e, [-out[0], 0, -out[2]], Part.CURB_FACE, src, surf, 0);
      quad(surface, a.t0, a.t1, b.t1, b.t0, [0, 1, 0], Part.CURB_TOP, src, surf, 0);
      quad(surface, a.t1, a.t3, b.t3, b.t1, [0, 1, 0], Part.SIDEWALK, src, surf, 0);
      quad(surface, a.t3, a.g3, b.g3, b.t3, out, Part.SKIRT, src, surf, 0);
      // the wedge between the curb's curve and the corner the two ribbons leave open, at road level
      tri(roadPatches[plan.cls], kp, a.e, b.e, [0, 1, 0], Part.ROAD, src, Surface.ASPHALT, 0);
    }
    if (stub) {
      // the stub's end cap, so it never shows an open edge
      const p = pts[pts.length - 1];
      const along = [p.inner[0] - pts[pts.length - 2].inner[0], 0, p.inner[1] - pts[pts.length - 2].inner[1]];
      const below = (q: number[]) => [q[0], Math.min(heightfield.heightAt(q[0], q[2]) - SKIRT_BELOW_M, q[1]), q[2]];
      quad(surface, below(p.t0), p.t0, p.t1, below(p.t1), along, Part.SKIRT, src, surf, 0);
      quad(surface, below(p.t1), p.t1, p.t3, below(p.t3), along, Part.SKIRT, src, surf, 0);
    }
    const inner: number[] = [];
    const outer: number[] = [];
    for (const p of pts) {
      inner.push(p.inner[0], p.inner[1]);
      outer.push(p.out[0], p.out[1]);
    }
    corners.push({ inner, outer, source });
  }

  // ---------- parking lots ----------
  const lots: ParkingLot[] = (data.pa ?? []).map((a, ai) => {
    const source: Source = a.sf ? 'mapped' : 'derived';
    const hard = !a.sf || a.sf === Surface.ASPHALT || a.sf === Surface.PAVING || a.sf === Surface.CONCRETE;
    const lift = roadLiftM(RoadClass.SERVICE) + MARKING_LIFT_M;
    const stalls: number[] = [];
    const inside = (x: number, z: number) => pointInPolygon(a.p, x, z) && !(a.h ?? []).some((h) => pointInPolygon(h, x, z));
    const spaces = (data.ps ?? []).filter((s) => {
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < s.p.length; i += 2) {
        cx += s.p[i];
        cz += s.p[i + 1];
      }
      return inside((cx * 2) / s.p.length, (cz * 2) / s.p.length);
    });
    let stallSource: Source | null = null;
    let stallCount = 0;
    if (spaces.length) {
      // mapped spaces: outline each one, and infer nothing here
      for (const s of spaces) outlineMarks(s.p, lift);
      stallSource = 'mapped';
      stallCount = spaces.length;
    } else if (hard) {
      const layout = stallLayout(a.p, inside, ai);
      if (layout.length / 8 >= MIN_STALLS) {
        for (let i = 0; i < layout.length; i += 8) {
          stalls.push(...layout.slice(i, i + 8));
          // the two side lines of each stall
          const c = layout.slice(i, i + 8);
          lineMark([c[0], c[1]], [c[6], c[7]], lift);
          lineMark([c[2], c[3]], [c[4], c[5]], lift);
        }
        stallSource = 'inferred';
        stallCount = layout.length / 8;
      }
    }
    return { ai, source, stalls, stallSource, stallCount };
  });

  function lineMark(a: V2, b: V2, lift: number) {
    const d = sub(b, a);
    const l = Math.hypot(d[0], d[1]) || 1;
    const n: V2 = [(-d[1] / l) * (MARKING_LINE_M / 2), (d[0] / l) * (MARKING_LINE_M / 2)];
    const y = (p: V2) => [p[0], heightfield.heightAt(p[0], p[1]) + lift, p[1]];
    quad(lotMarkings, y([a[0] - n[0], a[1] - n[1]]), y([a[0] + n[0], a[1] + n[1]]), y([b[0] + n[0], b[1] + n[1]]), y([b[0] - n[0], b[1] - n[1]]), [0, 1, 0], Part.MARKING, 0, Surface.UNKNOWN, 0);
  }
  function outlineMarks(p: number[], lift: number) {
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) lineMark([p[j], p[j + 1]], [p[i], p[i + 1]], lift);
  }

  /**
   * An inferred stall layout: double rows of STALL_W_M × STALL_L_M stalls along the lot's long axis, AISLE_M between
   * them, LOT_INSET_M in from the edge, clear of any road entering the lot. Flat [x, z × 4] per stall.
   */
  function stallLayout(p: number[], inside: (x: number, z: number) => boolean, ai: number) {
    // long axis: the longest edge
    let best = 0;
    let ux = 1;
    let uz = 0;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const l = Math.hypot(p[i] - p[j], p[i + 1] - p[j + 1]);
      if (l > best) {
        best = l;
        ux = (p[i] - p[j]) / l;
        uz = (p[i + 1] - p[j + 1]) / l;
      }
    }
    const vx = -uz;
    const vz = ux;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      const u = p[i] * ux + p[i + 1] * uz;
      const v = p[i] * vx + p[i + 1] * vz;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const edgeDistance = (x: number, z: number) => {
      let d = Infinity;
      for (const ring of [p, ...(data.pa![ai].h ?? [])])
        for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) d = Math.min(d, segmentDistance(x, z, ring[j], ring[j + 1], ring[i], ring[i + 1]));
      return d;
    };
    const nearRoad = (x: number, z: number) => {
      const list = roads.grid.get(Math.floor(x / 50) + ',' + Math.floor(z / 50)) ?? [];
      for (let i = 0; i < list.length; i += 5) {
        const ri = list[i + 4];
        if (!isCarriageway(lines[ri].c, data.r[ri].s)) continue;
        if (segmentDistance(x, z, list[i], list[i + 1], list[i + 2], list[i + 3]) - ROAD_WIDTH_M[lines[ri].c] / 2 < LOT_ENTRY_CLEAR_M) return true;
      }
      return false;
    };
    const out: number[] = [];
    const module = STALL_L_M * 2 + AISLE_M;
    for (let v = v0 + LOT_INSET_M; v + STALL_L_M <= v1 - LOT_INSET_M + 1e-9; v += module) {
      for (const row of [v, v + STALL_L_M + AISLE_M]) {
        if (row + STALL_L_M > v1 - LOT_INSET_M + 1e-9) continue;
        for (let u = u0 + LOT_INSET_M; u + STALL_W_M <= u1 - LOT_INSET_M + 1e-9; u += STALL_W_M) {
          const c = [
            [u, row],
            [u + STALL_W_M, row],
            [u + STALL_W_M, row + STALL_L_M],
            [u, row + STALL_L_M],
          ].map(([a, b]): V2 => [a * ux + b * vx, a * uz + b * vz]);
          if (c.every(([x, z]) => inside(x, z) && edgeDistance(x, z) >= LOT_INSET_M - 1e-6 && !nearRoad(x, z))) for (const [x, z] of c) out.push(x, z);
        }
      }
    }
    return out;
  }

  // ---------- street trees: mapped ones, then inferred on residential verges ----------
  const trees: StreetTree[] = [];
  const mapped = data.t ?? [];
  for (let i = 0; i < mapped.length; i += 2) trees.push({ x: mapped[i], z: mapped[i + 1], source: 'mapped' });
  const avoid = inp.avoidTrees ?? [];
  const clearRoad = inp.treeRoadClearanceM ?? 0;
  for (const strip of strips) {
    const sp = sideSpec(strip.ri, strip.side);
    if (!sides[strip.ri].streetTrees || sp.vergeM < 0.8) continue;
    const rs = samples[strip.ri]!;
    const key = data.r[strip.ri].i ?? strip.ri;
    // the strip's extent along the road, from its first and last stations
    const first = nearestS(rs, strip.inner[0], strip.inner[1]);
    const last = nearestS(rs, strip.inner[strip.inner.length - 2], strip.inner[strip.inner.length - 1]);
    let n = 0;
    for (let s = first + TREE_SPACING_M / 2; s < last - 2; n++) {
      s += hash01(key, strip.side, n) * TREE_JITTER_M;
      if (s >= last - 2) break;
      const [i, f] = locate(rs, s);
      const [x, z] = crossPoint(rs, { i, f }, strip.side, strip.ri, CURB_TOP_M + sp.vergeM / 2);
      const ok =
        !junctionPoints.some((p) => Math.hypot(p[0] - x, p[1] - z) < TREE_CLEAR_JUNCTION_M) &&
        !crossingPoints.some((p) => Math.hypot(p[0] - x, p[1] - z) < TREE_CLEAR_JUNCTION_M) &&
        !openings.some((o) => o.ri === strip.ri && o.side === strip.side && Math.abs(o.s - s) < o.half + (o.kind === 'crossing' ? TREE_CLEAR_JUNCTION_M : TREE_CLEAR_DRIVEWAY_M)) &&
        buildingDistance(x, z, TREE_CLEAR_BUILDING_M) >= TREE_CLEAR_BUILDING_M &&
        !trees.some((t) => Math.hypot(t.x - x, t.z - z) < TREE_CLEAR_TREE_M) &&
        !nearAvoided(x, z) &&
        !otherRoadWithin(strip.ri, x, z, clearRoad) &&
        surfaceIn(strip, x, z);
      if (ok) trees.push({ x, z, source: 'inferred' });
      s += TREE_SPACING_M;
    }
  }
  function nearAvoided(x: number, z: number) {
    for (let i = 0; i < avoid.length; i += 2) if (Math.abs(avoid[i] - x) < TREE_CLEAR_TREE_M && Math.hypot(avoid[i] - x, avoid[i + 1] - z) < TREE_CLEAR_TREE_M) return true;
    return false;
  }
  function otherRoadWithin(ri: number, x: number, z: number, reach: number) {
    const list = roads.grid.get(Math.floor(x / 50) + ',' + Math.floor(z / 50)) ?? [];
    for (let i = 0; i < list.length; i += 5) {
      const rj = list[i + 4];
      if (rj === ri || !isCarriageway(lines[rj].c, data.r[rj].s)) continue;
      if (segmentDistance(x, z, list[i], list[i + 1], list[i + 2], list[i + 3]) - ROAD_WIDTH_M[lines[rj].c] / 2 < reach) return true;
    }
    return false;
  }
  /** the tree's spot is on this strip's footprint (not in a gap the strip skipped) */
  function surfaceIn(strip: Strip, x: number, z: number) {
    const ring = [...strip.inner];
    for (let i = strip.outer.length - 2; i >= 0; i -= 2) ring.push(strip.outer[i], strip.outer[i + 1]);
    return pointInPolygon(ring, x, z);
  }

  return { sides, strips, corners, openings, surface, roadPatches, markings, lots, lotMarkings, crossings: crossingCount, trees, sidewalkM };
}

/** arc length of the sample nearest (x, z) */
function nearestS(rs: RoadSamples, x: number, z: number) {
  let best = Infinity;
  let s = 0;
  for (let k = 1; k < rs.q.length; k++) {
    const [ax, az] = rs.q[k - 1];
    const [bx, bz] = rs.q[k];
    const d = segmentDistance(x, z, ax, az, bx, bz);
    if (d < best) {
      best = d;
      const len = Math.hypot(bx - ax, bz - az) || 1;
      s = rs.s[k - 1] + Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (len * len))) * len;
    }
  }
  return s;
}

/** Distance from the centre line of a road of class c to the middle of its sidewalk on a side (m), or null without one. */
export function sidewalkCentreM(spec: Pick<SideSpec, 'sidewalk' | 'vergeM' | 'widthM' | 'parking' | 'orientation'>, c: RoadClass) {
  if (spec.sidewalk !== 'present') return null;
  const bay = spec.parking === StreetParking.STREET_SIDE ? BAY_DEPTH_M[spec.orientation] : 0;
  return ROAD_WIDTH_M[c] / 2 + bay + CURB_TOP_M + spec.vergeM + spec.widthM / 2;
}

// ---------- terrain cutting ----------
export interface GridLike {
  /** samples per side */
  samples: number;
  sampleCoord(i: number): number;
}

/**
 * Cuts flat (x, z) triangles along the heightfield's triangles, so each piece lies inside one terrain triangle and is
 * planar on the ground. The terrain splits each grid cell along the diagonal from (i + 1, j) to (i, j + 1), as
 * Heightfield.heightAt does. Input and output are flat [x, z × 3, ...].
 */
export function cutToTerrain(tris: readonly number[], grid: GridLike): number[] {
  const x0 = grid.sampleCoord(0);
  const cell = grid.sampleCoord(1) - x0;
  const n = grid.samples;
  const out: number[] = [];
  const clip = (poly: number[][], a: number, b: number, c: number) => {
    // keep a·u + b·v + c >= 0
    const res: number[][] = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const dp = a * p[0] + b * p[1] + c;
      const dq = a * q[0] + b * q[1] + c;
      if (dp >= 0) res.push(p);
      if ((dp >= 0) !== (dq >= 0)) {
        const t = dp / (dp - dq);
        res.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    return res;
  };
  for (let t = 0; t < tris.length; t += 6) {
    const uv = [0, 2, 4].map((k) => [(tris[t + k] - x0) / cell, (tris[t + k + 1] - x0) / cell]);
    const i0 = Math.max(0, Math.floor(Math.min(uv[0][0], uv[1][0], uv[2][0])));
    const i1 = Math.min(n - 2, Math.floor(Math.max(uv[0][0], uv[1][0], uv[2][0])));
    const j0 = Math.max(0, Math.floor(Math.min(uv[0][1], uv[1][1], uv[2][1])));
    const j1 = Math.min(n - 2, Math.floor(Math.max(uv[0][1], uv[1][1], uv[2][1])));
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const cellPoly = clip(clip(clip(clip(uv, 1, 0, -i), -1, 0, i + 1), 0, 1, -j), 0, -1, j + 1);
        if (cellPoly.length < 3) continue;
        for (const lower of [true, false]) {
          // lower triangle: (u - i) + (v - j) <= 1
          const piece = lower ? clip(cellPoly, -1, -1, i + j + 1) : clip(cellPoly, 1, 1, -(i + j + 1));
          for (let k = 1; k + 1 < piece.length; k++) {
            const [p, q, r] = [piece[0], piece[k], piece[k + 1]];
            // clipping repeats a corner where an edge lies on a cut line: drop the slivers it leaves
            if (Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) < 1e-12) continue;
            for (const v of [p, q, r]) out.push(x0 + v[0] * cell, x0 + v[1] * cell);
          }
        }
      }
    }
  }
  return out;
}

// ---------- the walkable height ----------
/** a grid cell as one number; cells stay within ±32768 of the origin, far past the world's edge */
const cellOf = (x: number, z: number) => (x + 32768) * 65536 + (z + 32768);

/**
 * The raised strips' and parking areas' surface height under a point. Built once from a layout; queries use their own
 * lookup grid and the same heights the meshes have, so a person stands on the pavement, not in it.
 */
export class StreetscapeIndex {
  private readonly tris: number[] = [];
  /** cell (packed into one number, see cellOf) -> triangle indices */
  private readonly grid = new Map<number, number[]>();
  private readonly lots: { p: number[]; h: number[][]; x0: number; x1: number; z0: number; z1: number }[] = [];
  private readonly heightfield: Pick<Heightfield, 'heightAt'>;
  private readonly lotLift = roadLiftM(RoadClass.SERVICE);

  constructor(layout: Pick<StreetscapeLayout, 'surface'>, data: Pick<WorldData, 'pa'>, heightfield: Pick<Heightfield, 'heightAt'>) {
    this.heightfield = heightfield;
    const { pos, part } = layout.surface;
    for (let t = 0; t < part.length; t++) {
      if (part[t] !== Part.CURB_TOP && part[t] !== Part.VERGE && part[t] !== Part.SIDEWALK) continue;
      const o = t * 9;
      const index = this.tris.length / 9;
      for (let k = 0; k < 9; k++) this.tris.push(pos[o + k]);
      const x0 = Math.floor(Math.min(pos[o], pos[o + 3], pos[o + 6]) / INDEX_CELL_M);
      const x1 = Math.floor(Math.max(pos[o], pos[o + 3], pos[o + 6]) / INDEX_CELL_M);
      const z0 = Math.floor(Math.min(pos[o + 2], pos[o + 5], pos[o + 8]) / INDEX_CELL_M);
      const z1 = Math.floor(Math.max(pos[o + 2], pos[o + 5], pos[o + 8]) / INDEX_CELL_M);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const k = cellOf(x, z);
          let list = this.grid.get(k);
          if (!list) this.grid.set(k, (list = []));
          list.push(index);
        }
      }
    }
    for (const a of data.pa ?? []) this.lots.push({ p: a.p, h: a.h ?? [], ...polygonBounds(a.p) });
  }

  /** Height of the raised strip or parking surface at (x, z), or null where there is none. */
  surfaceAt(x: number, z: number): number | null {
    let best: number | null = null;
    const list = this.grid.get(cellOf(Math.floor(x / INDEX_CELL_M), Math.floor(z / INDEX_CELL_M)));
    if (list) {
      const t = this.tris;
      for (const i of list) {
        const o = i * 9;
        const ax = t[o];
        const az = t[o + 2];
        const bx = t[o + 3];
        const bz = t[o + 5];
        const cx = t[o + 6];
        const cz = t[o + 8];
        const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(den) < 1e-12) continue;
        const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
        const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
        const y = w0 * t[o + 1] + w1 * t[o + 4] + w2 * t[o + 7];
        if (best === null || y > best) best = y;
      }
    }
    for (const l of this.lots) {
      if (x < l.x0 || x > l.x1 || z < l.z0 || z > l.z1 || !pointInPolygon(l.p, x, z) || l.h.some((h) => pointInPolygon(h, x, z))) continue;
      const y = this.heightfield.heightAt(x, z) + this.lotLift;
      if (best === null || y > best) best = y;
    }
    return best;
  }
}
