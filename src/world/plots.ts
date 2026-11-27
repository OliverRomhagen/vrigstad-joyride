// Which ground belongs to which house (#401): a plot per house, from its street back, and the driveway onto it. Pure:
// no three.js. Property boundaries aren't in OSM, so every plot is inferred: it is the rectangle, in the street's own
// coordinates, that a house can grow before an edge reaches ground nearer another building than the house, or meets
// another road, a parking lot, water or the edge of its residential area. So neighbours meet halfway between their
// walls, on curves too. Every choice follows the house's key (houses.ts), never data order. What the plots will carry
// (hedges, fences, walls) is #401's next step; this is the layout they and #145, #305 and #344 read.

import { HOUSE_MIN_M2 } from './buildings';
import { LandUse, ROAD_WIDTH_M, type RoadClass, RoadUse, type WorldData } from './data';
import { HOUSE_LINE_M, HOUSE_PAST_SIDEWALK_M } from './furniture/homes';
import { type HouseFront, project } from './furniture/houses';
import { type Bounds, pointInPolygon, polygonArea, polygonBounds, segmentDistance } from './polygon';
import { arcLengths, pointAtArc } from './polyline';
import { hash01 } from './random';
import type { Point, RoadLine } from './roads';
import { sidewalkCentreM } from './streetscape';
import type { SideSpec } from './streetscape-rules';

/** a plot reaches at most this far back from its front edge (m) */
const MAX_DEPTH_M = 40;
/** ... and at most this far past the side of its house, along the street (m) */
const SIDE_REACH_M = 12;
/** a plot stops this far short of another road's edge (m) */
const ROAD_CLEARANCE_M = 0.5;
/** how far the edges grow at a time before the last step is halved down to FINE_M (m) */
const GROW_STEP_M = 4;
const FINE_M = 0.25;
/** the front and back edges follow the street with a point every this many metres, and are tested piece by piece */
const EDGE_POINT_M = 4;
/** a generated driveway's width (m), and its gap from the house's wall (m) */
const DRIVEWAY_WIDTH_M = 3.2;
const DRIVEWAY_WALL_GAP_M = 0.4;
/** a driveway shorter than this (m) is none: the house stands at the carriageway's edge */
const MIN_DRIVEWAY_M = 1;
/** the direction out from a street turns towards a bend's bisector within this of its vertex (m) */
const BEND_BLEND_M = 6;
/** a street turning more than this at a vertex (rad) is a corner, which no plot reaches round */
const SHARP_TURN_RAD = (30 * Math.PI) / 180;
/** buildings smaller than this (m²) are sheds, which join the plot they stand on rather than claim ground */
const CLAIM_MIN_M2 = HOUSE_MIN_M2;
/**
 * ... and so are garages and bigger sheds, under OUTBUILDING_MAX_M2 (m²), within OUTBUILDING_REACH_M (m) of a building
 * at least OUTBUILDING_RATIO times their size; OSM tags nearly every building just building=yes, so size and
 * closeness are all there is to go on
 */
const OUTBUILDING_MAX_M2 = 70;
const OUTBUILDING_REACH_M = 8;
const OUTBUILDING_RATIO = 2;

export interface Driveway {
  /** centre line from the carriageway's edge to the house, flat [x, z, ...] */
  p: number[];
  widthM: number;
  source: 'mapped' | 'inferred';
}

export interface Plot {
  /** the house's key (HouseFront.key) */
  key: string;
  /** the street it fronts, and its side of it (-1 left, +1 right of the street's direction) */
  ri: number;
  side: -1 | 1;
  /**
   * the outline, flat [x, z, ...], either winding: the front edge along the street from one side to the other, then
   * the back edge returning; the sides are the pieces that close it, from the front's last point to the back's first
   * and from the back's last point to the front's first
   */
  outline: number[];
  /** null where the house stands at the carriageway's edge */
  driveway: Driveway | null;
}

export interface PlotInputs {
  data: WorldData;
  roads: { readonly lines: readonly RoadLine[] };
  /** every building's outline: the houses' own `outline` arrays among them, compared by identity */
  buildings: { readonly footprints: readonly (Bounds & { p: number[] })[] };
  /** the houses that get a plot, with the street each fronts (houseFronts) */
  fronts: readonly HouseFront[];
  /** where a plot starts: its distance from the street's centre line (m), past the sidewalk or verge */
  frontEdgeM(ri: number, side: -1 | 1): number;
  inWater?(x: number, z: number): boolean;
}

/**
 * Where a street's plots begin on one side, out from its centre line (m): the property line, where the mailboxes
 * stand (homes.ts), past the sidewalk where there is one, else past the carriageway's edge.
 */
export function propertyLineM(spec: SideSpec, c: RoadClass) {
  const centreM = sidewalkCentreM(spec, c);
  return centreM === null ? ROAD_WIDTH_M[c] / 2 + HOUSE_LINE_M : centreM + spec.widthM / 2 + HOUSE_PAST_SIDEWALK_M;
}

interface Pt {
  x: number;
  z: number;
}

/** > 0 when c is left of the line from a to b, < 0 right of it (x east, z south). */
const turnOf = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) =>
  (bx - ax) * (cz - az) - (bz - az) * (cx - ax);

/** True when segment a–b crosses segment c–d. */
function segmentsCross(a: Pt, b: Pt, cx: number, cz: number, dx: number, dz: number) {
  return (
    turnOf(a.x, a.z, b.x, b.z, cx, cz) * turnOf(a.x, a.z, b.x, b.z, dx, dz) < 0 &&
    turnOf(cx, cz, dx, dz, a.x, a.z) * turnOf(cx, cz, dx, dz, b.x, b.z) < 0
  );
}

/** Distance between segment a–b and segment c–d (m), 0 where they cross. */
function segmentsDistance(a: Pt, b: Pt, cx: number, cz: number, dx: number, dz: number) {
  if (segmentsCross(a, b, cx, cz, dx, dz)) return 0;
  return Math.min(
    segmentDistance(a.x, a.z, cx, cz, dx, dz),
    segmentDistance(b.x, b.z, cx, cz, dx, dz),
    segmentDistance(cx, cz, a.x, a.z, b.x, b.z),
    segmentDistance(dx, dz, a.x, a.z, b.x, b.z),
  );
}

/** Distance from (x, z) to a polygon's outline, 0 inside it. */
function outlineDistance(p: readonly number[], x: number, z: number) {
  if (pointInPolygon(p as number[], x, z)) return 0;
  let d = Infinity;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2)
    d = Math.min(d, segmentDistance(x, z, p[j], p[j + 1], p[i], p[i + 1]));
  return d;
}

/** True when segment a–b crosses the polygon's outline, flat [x, z, ...]. */
function crossesOutline(p: readonly number[], a: Pt, b: Pt) {
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2)
    if (segmentsCross(a, b, p[j], p[j + 1], p[i], p[i + 1])) return true;
  return false;
}

/** The furthest an edge can move out, up to maxM, while `free` says the ground at that distance is free (m). */
function reach(maxM: number, free: (m: number) => boolean) {
  let good = 0;
  while (good < maxM) {
    const next = Math.min(good + GROW_STEP_M, maxM);
    if (free(next)) {
      good = next;
      continue;
    }
    let bad = next;
    while (bad - good > FINE_M) {
      const mid = (good + bad) / 2;
      if (free(mid)) good = mid;
      else bad = mid;
    }
    break;
  }
  return good;
}

/** Evenly spaced values from a to b, both included, at most stepM apart. */
function samples(a: number, b: number, stepM: number) {
  const n = Math.max(1, Math.ceil(Math.abs(b - a) / stepM));
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
}

/**
 * The point `s` metres along the polyline and `rightM` out to its right (negative: left). Within BEND_BLEND_M of a
 * vertex the direction out turns towards the vertex's bisector, so offset edges have no spikes at the bends.
 */
function offsetPoint(q: readonly Point[], arcs: readonly number[], s: number, rightM: number) {
  const { x, z, tx: sx, tz: sz } = pointAtArc(q, arcs, s);
  let i = 1;
  while (i < q.length - 1 && arcs[i] < s) i++;
  const fromStartM = s - arcs[i - 1];
  const toEndM = arcs[i] - s;
  const vertex = fromStartM < toEndM ? i - 1 : i;
  const share = 1 - Math.min(fromStartM, toEndM) / BEND_BLEND_M; // 1 at the vertex, 0 from BEND_BLEND_M away
  let tx = sx;
  let tz = sz;
  if (share > 0 && vertex > 0 && vertex < q.length - 1) {
    // the vertex's bisector: its two segments' unit directions added
    const [a, b, c] = [q[vertex - 1], q[vertex], q[vertex + 1]];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
    tx += (share * ((b[0] - a[0]) / ab + (c[0] - b[0]) / bc - 2 * sx)) / 2;
    tz += (share * ((b[1] - a[1]) / ab + (c[1] - b[1]) / bc - 2 * sz)) / 2;
  }
  const length = Math.hypot(tx, tz) || 1;
  return { x: x - (tz / length) * rightM, z: z + (tx / length) * rightM };
}

/**
 * The outlines of sheds and garages: buildings under OUTBUILDING_MAX_M2 within OUTBUILDING_REACH_M of a building at
 * least OUTBUILDING_RATIO times their size. They join the plot they stand on, rather than get or claim one.
 */
function outbuildings(footprints: readonly (Bounds & { p: number[] })[]) {
  const areas = footprints.map(f => polygonArea(f.p));
  const sheds = new Set<readonly number[]>();
  footprints.forEach((f, i) => {
    if (areas[i] >= OUTBUILDING_MAX_M2) return;
    const r = OUTBUILDING_REACH_M;
    const big = footprints.some(
      (g, j) =>
        areas[j] >= OUTBUILDING_RATIO * areas[i] &&
        g.x0 < f.x1 + r &&
        g.x1 > f.x0 - r &&
        g.z0 < f.z1 + r &&
        g.z1 > f.z0 - r &&
        outlinesDistance(f.p, g.p) < r,
    );
    if (big) sheds.add(f.p);
  });
  return sheds;
}

/** The nearest two outlines come to each other (m), from each one's corners to the other's sides. */
function outlinesDistance(a: number[], b: number[]) {
  let d = Infinity;
  for (const [p, q] of [
    [a, b],
    [b, a],
  ])
    for (let i = 0; i < p.length; i += 2)
      for (let k = 0, j = q.length - 2; k < q.length; j = k, k += 2)
        d = Math.min(d, segmentDistance(p[i], p[i + 1], q[j], q[j + 1], q[k], q[k + 1]));
  return d;
}

/** The polyline carried on straight past both its ends by `byM`: a house past the end of a dead end faces its line. */
function extendEnds(q: readonly Point[], byM: number): Point[] {
  const out = (a: Point, b: Point): Point => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [b[0] + ((b[0] - a[0]) / length) * byM, b[1] + ((b[1] - a[1]) / length) * byM];
  };
  return [out(q[1], q[0]), ...q, out(q[q.length - 2], q[q.length - 1])];
}

/** The vertices that bound the stretch of `line` around `s` (m along it) with no turn sharper than SHARP_TURN_RAD. */
function straightRun(line: readonly Point[], s: number, arcs: readonly number[]) {
  const turn = (i: number) => {
    const [a, b, c] = [line[i - 1], line[i], line[i + 1]];
    const t = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
    return Math.abs(Math.atan2(Math.sin(t), Math.cos(t)));
  };
  let first = 0;
  let last = line.length - 1;
  for (let i = 1; i < line.length - 1; i++) {
    if (turn(i) <= SHARP_TURN_RAD) continue;
    if (arcs[i] <= s) first = i;
    else {
      last = i;
      break;
    }
  }
  return [first, last];
}

/** A plot for each house in `fronts` that has room for one, in the order of `fronts`. */
export function layoutPlots(inp: PlotInputs): Plot[] {
  const { data, roads, buildings, fronts } = inp;
  // the ground other buildings claim: big enough to be a house, a block or a barn
  const sheds = outbuildings(buildings.footprints);
  const claimants = buildings.footprints.filter(f => polygonArea(f.p) >= CLAIM_MIN_M2 && !sheds.has(f.p));
  const residential = data.l.filter(a => a.k === LandUse.RESIDENTIAL).map(a => ({ p: a.p, ...polygonBounds(a.p) }));
  const parking = (data.pa ?? []).map(a => ({ p: a.p, ...polygonBounds(a.p) }));
  // every road segment that can stop a plot, as ax, az, bx, bz, road index: driveways belong to plots, and a sidewalk
  // mapped on its own runs along the front of them
  const segments: number[] = [];
  roads.lines.forEach(({ p }, ri) => {
    const use = data.r[ri].s;
    if (use === RoadUse.DRIVEWAY || use === RoadUse.SIDEWALK) return;
    for (let i = 1; i < p.length; i++) segments.push(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1], ri);
  });
  const plots: Plot[] = [];

  for (const f of fronts) {
    if (sheds.has(f.outline)) continue;
    // street coordinates: s metres along the stretch of street between its sharp bends either side of the house,
    // carried on straight past them, so a house on the outside of a corner or past a dead end still faces it; v metres
    // out from its centre line on the house's side
    const street = roads.lines[f.ri].p;
    const [first, last] = straightRun(street, project(street, f.x, f.z).s, arcLengths(street));
    const line = extendEnds(street.slice(first, last + 1), MAX_DEPTH_M + SIDE_REACH_M);
    const arcs = arcLengths(line);
    const toWorld = (s: number, v: number) => offsetPoint(line, arcs, s, v * f.side);
    let sMin = Infinity;
    let sMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (let i = 0; i < f.outline.length; i += 2) {
      const m = project(line, f.outline[i], f.outline[i + 1]);
      const v = m.side === f.side ? m.d : -m.d;
      sMin = Math.min(sMin, m.s);
      sMax = Math.max(sMax, m.s);
      vMin = Math.min(vMin, v);
      vMax = Math.max(vMax, v);
    }
    if (vMin <= 0) continue; // over the street's centre line: no front to measure from

    const land = residential.find(a => pointInPolygon(a.p, f.x, f.z));
    // the property line, or the house's front wall where it stands on it
    const vLine = Math.min(inp.frontEdgeM(f.ri, f.side), vMin);
    // what can stop this plot's edges, gathered once: within its furthest reach of the house's middle
    const reachM = MAX_DEPTH_M + SIDE_REACH_M + Math.hypot(sMax - sMin, vMax - vMin);
    const near = (b: Bounds) =>
      b.x0 < f.x + reachM && b.x1 > f.x - reachM && b.z0 < f.z + reachM && b.z1 > f.z - reachM;
    const claims = claimants.filter(c => c.p !== f.outline && near(c));
    const lots = parking.filter(near);
    // road segments as ax, az, bx, bz and how far off the plot keeps (m): its own street as far as its front edge,
    // so the inside of a bend doesn't reach the street's other leg
    const keepOff: number[] = [];
    for (let i = 0; i < segments.length; i += 5) {
      const ax = segments[i];
      const az = segments[i + 1];
      const bx = segments[i + 2];
      const bz = segments[i + 3];
      if ((ax > f.x + reachM && bx > f.x + reachM) || (ax < f.x - reachM && bx < f.x - reachM)) continue;
      if ((az > f.z + reachM && bz > f.z + reachM) || (az < f.z - reachM && bz < f.z - reachM)) continue;
      const ri = segments[i + 4];
      keepOff.push(ax, az, bx, bz, ri === f.ri ? vLine - 1e-6 : ROAD_WIDTH_M[roads.lines[ri].c] / 2 + ROAD_CLEARANCE_M);
    }
    // the point is nearer this house than any other building
    const owned = (p: Pt) => {
      const own = outlineDistance(f.outline, p.x, p.z);
      for (const c of claims) {
        // nearer than its bounding box can be: skipped without the square root, as most are
        const dx = Math.max(c.x0 - p.x, 0, p.x - c.x1);
        const dz = Math.max(c.z0 - p.z, 0, p.z - c.z1);
        if (dx * dx + dz * dz < own * own && outlineDistance(c.p, p.x, p.z) < own) return false;
      }
      return true;
    };
    // the straight piece of edge from a to b crosses no road, lot, water or residential edge
    const pieceFree = (a: Pt, b: Pt) => {
      if (inp.inWater?.(a.x, a.z) || inp.inWater?.(b.x, b.z)) return false;
      if (land && (!pointInPolygon(land.p, a.x, a.z) || crossesOutline(land.p, a, b))) return false;
      for (const l of lots) if (pointInPolygon(l.p, a.x, a.z) || crossesOutline(l.p, a, b)) return false;
      for (let i = 0; i < keepOff.length; i += 5) {
        const k = keepOff[i + 4];
        if (Math.min(a.x, b.x) - k > Math.max(keepOff[i], keepOff[i + 2])) continue;
        if (Math.max(a.x, b.x) + k < Math.min(keepOff[i], keepOff[i + 2])) continue;
        if (Math.min(a.z, b.z) - k > Math.max(keepOff[i + 1], keepOff[i + 3])) continue;
        if (Math.max(a.z, b.z) + k < Math.min(keepOff[i + 1], keepOff[i + 3])) continue;
        if (segmentsDistance(a, b, keepOff[i], keepOff[i + 1], keepOff[i + 2], keepOff[i + 3]) < k) return false;
      }
      return true;
    };
    // the edge through these points is free: every point owned, every piece between them free
    const edgeFree = (points: Pt[]) => points.every((p, i) => owned(p) && (i === 0 || pieceFree(points[i - 1], p)));
    const rowFree = (s0: number, s1: number, v: number) =>
      edgeFree(samples(s0, s1, EDGE_POINT_M).map(s => toWorld(s, v)));
    // the front edge comes forward from the house to the property line, or stops behind a path along the street
    const vFront = vMin - reach(vMin - vLine, m => rowFree(sMin, sMax, vMin - m));
    const columnFree = (s: number) => edgeFree(samples(vFront, vMax, EDGE_POINT_M).map(v => toWorld(s, v)));
    const sLeft = sMin - reach(SIDE_REACH_M, m => columnFree(sMin - m));
    const sRight = sMax + reach(SIDE_REACH_M, m => columnFree(sMax + m));
    // the front edge again, now across the whole width: its corners may reach a bend's other leg
    const vFrontWide = vMin - reach(vMin - vFront, m => rowFree(sLeft, sRight, vMin - m));
    const vBack = vMax + reach(Math.max(0, vFrontWide + MAX_DEPTH_M - vMax), m => rowFree(sLeft, sRight, vMax + m));

    // the front and back edges follow the street's bends
    const along = samples(sLeft, sRight, EDGE_POINT_M);
    const outline: number[] = [];
    for (const s of along) {
      const { x, z } = toWorld(s, vFrontWide);
      outline.push(x, z);
    }
    for (let i = along.length - 1; i >= 0; i--) {
      const { x, z } = toWorld(along[i], vBack);
      outline.push(x, z);
    }
    plots.push({
      key: f.key,
      ri: f.ri,
      side: f.side,
      outline,
      driveway: driveway(f, inp, toWorld, { sMin, sMax, vMin, vMax, sLeft, sRight }),
    });
  }
  // a mapped driveway to a garage is the driveway of the plot the garage stands on, or beside
  for (const f of fronts) {
    if (!sheds.has(f.outline) || f.drivewayRi === undefined) continue;
    let nearest: Plot | null = null;
    let nearestM = OUTBUILDING_REACH_M;
    for (const p of plots) {
      const d = outlineDistance(p.outline, f.x, f.z);
      if (d < nearestM && p.driveway?.source !== 'mapped') [nearest, nearestM] = [p, d];
    }
    if (nearest) nearest.driveway = mappedDriveway(f.drivewayRi, f.ri, inp);
  }
  return plots;
}

/** Mapped driveway ri, from the end nearer street `streetRi`. */
function mappedDriveway(ri: number, streetRi: number, { data, roads }: Pick<PlotInputs, 'data' | 'roads'>): Driveway {
  const { p } = roads.lines[ri];
  const street = roads.lines[streetRi].p;
  const fromStreet = project(street, ...p[0]).d <= project(street, ...p[p.length - 1]).d;
  return { p: (fromStreet ? p : [...p].reverse()).flat(), widthM: data.r[ri].w ?? DRIVEWAY_WIDTH_M, source: 'mapped' };
}

/** The house's mapped driveway; else one along the side of the house with more room, or straight to its front. */
function driveway(
  f: HouseFront,
  { data, roads }: PlotInputs,
  toWorld: (s: number, v: number) => { x: number; z: number },
  { sMin, sMax, vMin, vMax, sLeft, sRight }: Record<'sMin' | 'sMax' | 'vMin' | 'vMax' | 'sLeft' | 'sRight', number>,
): Driveway | null {
  if (f.drivewayRi !== undefined) return mappedDriveway(f.drivewayRi, f.ri, { data, roads });
  const needM = DRIVEWAY_WIDTH_M + DRIVEWAY_WALL_GAP_M;
  const leftM = sMin - sLeft;
  const rightM = sRight - sMax;
  const toRight = rightM > leftM || (rightM === leftM && hash01(f.key, 'driveway') < 0.5);
  const besideHouse = Math.max(leftM, rightM) >= needM;
  const offsetM = DRIVEWAY_WALL_GAP_M + DRIVEWAY_WIDTH_M / 2;
  const s = !besideHouse ? (sMin + sMax) / 2 : toRight ? sMax + offsetM : sMin - offsetM;
  const vStart = ROAD_WIDTH_M[roads.lines[f.ri].c] / 2;
  const vEnd = besideHouse ? (vMin + vMax) / 2 : vMin;
  if (vEnd - vStart < MIN_DRIVEWAY_M) return null;
  const a = toWorld(s, vStart);
  const b = toWorld(s, vEnd);
  return { p: [a.x, a.z, b.x, b.z], widthM: DRIVEWAY_WIDTH_M, source: 'inferred' };
}
