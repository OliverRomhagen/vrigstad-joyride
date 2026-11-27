// What stands on the plots' edges (#401): a clipped hedge, a picket fence, a board fence, a low stone wall or nothing.
// Pure: no three.js. Artistic rules, not a survey of Vrigstad. Towards the street, half the plots take their street's
// style and half choose their own, so a street has a character without being uniform. Between neighbours and at the
// back, hedges and board fences give shelter, chosen on their own. Each plot has its own boundaries on its own side of
// the line, so a hedge and a fence can stand side by side between two houses. A boundary leaves a gap at the driveway
// and a garden gate opposite the house, and keeps off its house's walls. Every choice hashes the street or the plot's
// key, never data order.

import { LandUse, ROAD_WIDTH_M, type RoadClass, type WorldData } from './data';
import type { Plot } from './plots';
import { type Bounds, pointInPolygon, polygonBounds, segmentDistance, vertexCentre } from './polygon';
import { hash01 } from './random';
import type { Profile } from './streetscape-rules';

/** MESH is the tall chain-link fence (nätstängsel) round industrial land */
export const BoundaryKind = { HEDGE: 0, PICKET: 1, BOARD: 2, WALL: 3, MESH: 4 } as const;
export type BoundaryKind = (typeof BoundaryKind)[keyof typeof BoundaryKind];

type Shares = readonly (readonly [BoundaryKind, number])[];

/**
 * the share of street edges that each kind closes, by the street's profile; what is left is open. The centre's older
 * villas have hedges, picket fences and the odd stone wall, the suburbs a bit of everything, farms stone walls.
 */
const FRONT_SHARES: Record<Profile, Shares> = {
  centre: [
    [BoundaryKind.HEDGE, 0.35],
    [BoundaryKind.PICKET, 0.3],
    [BoundaryKind.WALL, 0.15],
    [BoundaryKind.BOARD, 0.05],
  ],
  residential: [
    [BoundaryKind.HEDGE, 0.35],
    [BoundaryKind.PICKET, 0.25],
    [BoundaryKind.BOARD, 0.15],
    [BoundaryKind.WALL, 0.05],
  ],
  outskirts: [
    [BoundaryKind.WALL, 0.35],
    [BoundaryKind.PICKET, 0.15],
    [BoundaryKind.HEDGE, 0.15],
    [BoundaryKind.BOARD, 0.05],
  ],
};
/** the share of sides and backs each kind closes: shelter from the neighbours; farms mostly leave theirs open */
const SIDE_SHARES: Record<Profile, Shares> = {
  centre: [
    [BoundaryKind.HEDGE, 0.5],
    [BoundaryKind.BOARD, 0.2],
    [BoundaryKind.PICKET, 0.1],
  ],
  residential: [
    [BoundaryKind.HEDGE, 0.45],
    [BoundaryKind.BOARD, 0.25],
    [BoundaryKind.PICKET, 0.1],
  ],
  outskirts: [
    [BoundaryKind.HEDGE, 0.15],
    [BoundaryKind.WALL, 0.1],
  ],
};
/** a plot's street edge takes its street's style with this chance, else one of its own */
const STREET_STYLE_SHARE = 0.5;
/** a hedge is between these heights (m), by edge; the other kinds have one height each (m) */
const HEDGE_MIN_M = 0.9;
const HEDGE_SPREAD_M = 0.7;
const HEIGHT_M: Record<BoundaryKind, number> = { 0: 0, 1: 0.9, 2: 1.4, 3: 0.6, 4: 2.5 };
/** a picket or board fence is white or grey (variant 0) or falu red (1), falu red with this chance, by plot */
const FALU_SHARE: Record<BoundaryKind, number> = { 0: 0, 1: 0.3, 2: 0.6, 3: 0, 4: 0 };
/**
 * a boundary stands inside its plot from its line, as thick as it is; it is left out where its house's wall is nearer
 * the line than this (m): a hedge needs room, a fence can stand close
 */
const WALL_CLEAR_M: Record<BoundaryKind, number> = { 0: 0.8, 1: 0.15, 2: 0.15, 3: 0.6, 4: 0.3 };
/** the gap at a driveway is its width and this much either side (m); the garden gate is this wide (m) */
const DRIVEWAY_SPARE_M = 0.3;
const GATE_M = 1;
/** no gate within this of the driveway's gap (m): the driveway is the way in */
const GATE_DRIVEWAY_M = 2;
/** a piece of boundary shorter than this between gaps (m) is left out */
const MIN_RUN_M = 0.5;
/** a hedge within this of a mailbox (m), along its line, is half as thick, cut back from the street side to make room */
const MAILBOX_ROOM_M = 0.5;
/** ... where the mailbox stands within this of the hedge's line (m) */
const MAILBOX_NEAR_M = 0.8;
/** an industrial fence is cut into pieces this long (m) to test, and leaves out a piece this close to a road's edge (m) */
const INDUSTRIAL_PIECE_M = 2.5;
const INDUSTRIAL_ROAD_CLEAR_M = 1;
/** ... or to a place with a fence of its own (m): Skroten's yard, whose fence and gate stand back from the road */
const INDUSTRIAL_KEEP_OUT_M = 15;

export interface BoundaryRun {
  kind: BoundaryKind;
  /** the line it stands on, flat [x, z, ...] */
  p: number[];
  heightM: number;
  /** a fence's paint: 0 white or grey, 1 falu red */
  variant: 0 | 1;
  /** the plot it belongs to (Plot.key) */
  key: string;
  /** the plot lies to the right (1) or the left (-1) of the line's direction: the side it stands on */
  inward: -1 | 1;
  /** half as thick, cut back from the line to make room for a mailbox; its far side stays where it was */
  slim?: true;
}

/** The kind `roll` (in [0, 1)) picks from `shares`, or null for open. */
function pick(shares: Shares, roll: number): BoundaryKind | null {
  for (const [kind, share] of shares) {
    if (roll < share) return kind;
    roll -= share;
  }
  return null;
}

/** Shortest distance from any point of polyline `p` to polygon outline `q` (m), both flat [x, z, ...]. */
function polylineToOutlineM(p: readonly number[], q: readonly number[]) {
  let d = Infinity;
  const gapM = boxGapM(p, q);
  if (gapM >= 1) return gapM; // a lower bound, and further than any WALL_CLEAR_M
  for (let i = 0; i < p.length; i += 2)
    for (let k = 0, j = q.length - 2; k < q.length; j = k, k += 2)
      d = Math.min(d, segmentDistance(p[i], p[i + 1], q[j], q[j + 1], q[k], q[k + 1]));
  for (let k = 0; k < q.length; k += 2)
    for (let i = 2; i < p.length; i += 2)
      d = Math.min(d, segmentDistance(q[k], q[k + 1], p[i - 2], p[i - 1], p[i], p[i + 1]));
  return d;
}

/** The gap between two flat [x, z, ...] point lists' bounding boxes (m), 0 where they overlap. */
function boxGapM(p: readonly number[], q: readonly number[]) {
  const [a, b] = [polygonBounds(p as number[]), polygonBounds(q as number[])];
  return Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.z0 - b.z1, b.z0 - a.z1));
}

/** Where along polyline `p` (m) segment a–b crosses it, or null. */
function crossingAlong(p: readonly number[], ax: number, az: number, bx: number, bz: number) {
  let along = 0;
  for (let i = 2; i < p.length; i += 2) {
    const [cx, cz, dx, dz] = [p[i - 2], p[i - 1], p[i], p[i + 1]];
    const length = Math.hypot(dx - cx, dz - cz);
    const denominator = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
    if (denominator !== 0) {
      const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / denominator; // along a–b
      const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / denominator; // along c–d
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return along + u * length;
    }
    along += length;
  }
  return null;
}

/** Where along polyline `p` (m) the point nearest (x, z) is. */
function nearestAlong(p: readonly number[], x: number, z: number) {
  let best = { along: 0, d: Infinity };
  let along = 0;
  for (let i = 2; i < p.length; i += 2) {
    const [cx, cz, dx, dz] = [p[i - 2], p[i - 1], p[i], p[i + 1]];
    const length = Math.hypot(dx - cx, dz - cz);
    const d = segmentDistance(x, z, cx, cz, dx, dz);
    if (d < best.d) {
      const t = length ? Math.max(0, Math.min(1, ((x - cx) * (dx - cx) + (z - cz) * (dz - cz)) / length ** 2)) : 0;
      best = { along: along + t * length, d };
    }
    along += length;
  }
  return best.along;
}

/** Length of polyline `p` (m). */
function lineLength(p: readonly number[]) {
  let length = 0;
  for (let i = 2; i < p.length; i += 2) length += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return length;
}

/** Distance from (x, z) to polyline `p` (m). */
function distanceToLine(p: readonly number[], x: number, z: number) {
  let d = Infinity;
  for (let i = 2; i < p.length; i += 2) d = Math.min(d, segmentDistance(x, z, p[i - 2], p[i - 1], p[i], p[i + 1]));
  return d;
}

/** The stretches of [0, total] (m) that the intervals leave out, as gaps for `cut`: what is not in them. */
function between(intervals: readonly (readonly [number, number])[], total: number): [number, number][] {
  const out: [number, number][] = [];
  let from = 0;
  for (const [a, b] of [...intervals].sort((x, y) => x[0] - y[0])) {
    if (a > from) out.push([from, a]);
    from = Math.max(from, b);
  }
  out.push([from, total]);
  return out;
}

/** The pieces of polyline `p` outside the gaps, each [from, to] metres along it. */
function cut(p: readonly number[], gaps: readonly (readonly [number, number])[]) {
  const arcs = [0];
  for (let i = 2; i < p.length; i += 2)
    arcs.push(arcs[arcs.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
  const total = arcs[arcs.length - 1];
  const pointAt = (s: number) => {
    let i = 1;
    while (i < arcs.length - 1 && arcs[i] < s) i++;
    const t = (s - arcs[i - 1]) / (arcs[i] - arcs[i - 1] || 1);
    const k = (i - 1) * 2;
    return [p[k] + (p[k + 2] - p[k]) * t, p[k + 1] + (p[k + 3] - p[k + 1]) * t];
  };
  const pieces: number[][] = [];
  let from = 0;
  for (const [g0, g1] of [...gaps].sort((a, b) => a[0] - b[0]).concat([[total, total]])) {
    const to = Math.min(g0, total);
    if (to - from >= MIN_RUN_M) {
      const piece = [...pointAt(from)];
      arcs.forEach((s, i) => {
        if (s > from && s < to) piece.push(p[i * 2], p[i * 2 + 1]);
      });
      piece.push(...pointAt(to));
      pieces.push(piece);
    }
    from = Math.max(from, g1);
  }
  return pieces;
}

/**
 * The hedges, fences and walls on the plots' edges; `profileOf` gives a street's profile (StreetSides.profile), and
 * `mailboxes` where the mailboxes stand, which the hedges make room for.
 */
export function layoutBoundaries(
  plots: readonly Plot[],
  profileOf: (ri: number) => Profile,
  mailboxes: readonly { x: number; z: number }[] = [],
): BoundaryRun[] {
  const runs: BoundaryRun[] = [];
  for (const plot of plots) {
    const profile = profileOf(plot.ri);
    const { x: hx, z: hz } = vertexCentre(plot.house);
    // edge is the edge's name, for the rolls
    const add = (p: number[], kind: BoundaryKind, edge: string) => {
      if (polylineToOutlineM(p, plot.house) < WALL_CLEAR_M[kind]) return;
      const heightM =
        kind === BoundaryKind.HEDGE ? HEDGE_MIN_M + hash01(plot.key, edge, 'height') * HEDGE_SPREAD_M : HEIGHT_M[kind];
      const variant: 0 | 1 = hash01(plot.key, kind, 'paint') < FALU_SHARE[kind] ? 1 : 0;
      // > 0: the house's middle is right of the line's first piece (x east, z south)
      const cross = (p[2] - p[0]) * (hz - p[1]) - (p[3] - p[1]) * (hx - p[0]);
      const run = { kind, heightM, variant, key: plot.key, inward: cross > 0 ? (1 as const) : (-1 as const) };
      // a hedge makes room for the mailboxes that stand at it
      const room: [number, number][] = [];
      if (kind === BoundaryKind.HEDGE)
        for (const m of mailboxes)
          if (Math.abs(m.x - hx) < 60 && Math.abs(m.z - hz) < 60 && distanceToLine(p, m.x, m.z) < MAILBOX_NEAR_M) {
            const at = nearestAlong(p, m.x, m.z);
            room.push([at - MAILBOX_ROOM_M, at + MAILBOX_ROOM_M]);
          }
      for (const piece of cut(p, room)) runs.push({ ...run, p: piece });
      for (const piece of cut(p, between(room, lineLength(p)))) runs.push({ ...run, p: piece, slim: true });
    };
    const o = plot.outline;
    const n = o.length / 4;

    // the street edge, with gaps at the driveway and the gate
    const ownStyle = hash01(plot.key, 'own') >= STREET_STYLE_SHARE;
    const front = pick(
      FRONT_SHARES[profile],
      ownStyle ? hash01(plot.key, 'front') : hash01(plot.ri, plot.side, 'style'),
    );
    if (front !== null) {
      const line = o.slice(0, 2 * n);
      const gaps: [number, number][] = [];
      const d = plot.driveway;
      if (d)
        for (let i = 2; i < d.p.length; i += 2) {
          const at = crossingAlong(line, d.p[i - 2], d.p[i - 1], d.p[i], d.p[i + 1]);
          if (at === null) continue;
          const half = d.widthM / 2 + DRIVEWAY_SPARE_M;
          gaps.push([at - half, at + half]);
          break;
        }
      const gate = nearestAlong(line, hx, hz);
      if (gaps.every(([g0, g1]) => gate < g0 - GATE_DRIVEWAY_M || gate > g1 + GATE_DRIVEWAY_M))
        gaps.push([gate - GATE_M / 2, gate + GATE_M / 2]);
      for (const piece of cut(line, gaps)) add(piece, front, 'front');
    }

    // the sides and the back, each on its own; a neighbour's boundary on the same line stands on its own side of it
    const edges: [string, number[]][] = [
      ['right', [o[2 * n - 2], o[2 * n - 1], o[2 * n], o[2 * n + 1]]],
      ['back', o.slice(2 * n)],
      ['left', [o[4 * n - 2], o[4 * n - 1], o[0], o[1]]],
    ];
    for (const [edge, line] of edges) {
      const kind = pick(SIDE_SHARES[profile], hash01(plot.key, edge));
      if (kind !== null) add(line, kind, edge);
    }
  }
  return runs;
}

export interface IndustrialFenceInputs {
  data: WorldData;
  roads: { readonly lines: readonly { p: readonly (readonly [number, number])[]; c: RoadClass }[] };
  /** every building's outline: the fence leaves out what runs along or through one */
  buildings: { readonly footprints: readonly (Bounds & { p: number[] })[] };
  /**
   * the outlines of a place with a fence of its own (Skroten's yard: its fence, buildings and heaps): the fence keeps
   * out of their bounding box, and INDUSTRIAL_KEEP_OUT_M round it
   */
  keepOut?: readonly number[][];
  inWater?(x: number, z: number): boolean;
}

/**
 * A tall chain-link fence round each industrial area (land use), on its edge: left out within reach of a road (a gap
 * where a road or an entrance crosses), along or through a building, near something with a fence of its own, and in
 * water. Each run stands on the area's side of the edge.
 */
export function industrialFences({
  data,
  roads,
  buildings,
  keepOut = [],
  inWater,
}: IndustrialFenceInputs): BoundaryRun[] {
  const runs: BoundaryRun[] = [];
  data.l.forEach((area, ai) => {
    if (area.k !== LandUse.INDUSTRIAL) return;
    const box = polygonBounds(area.p);
    const reach = 10;
    const near = (b: Bounds) =>
      b.x0 < box.x1 + reach && b.x1 > box.x0 - reach && b.z0 < box.z1 + reach && b.z1 > box.z0 - reach;
    const footprints = buildings.footprints.filter(near);
    const keepOutBox = keepOut.length
      ? keepOut.reduce((b, q) => polygonBounds(q, b), { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity })
      : null;
    const segments: number[] = []; // ax, az, bx, bz, half width plus clearance
    for (const { p, c } of roads.lines)
      for (let i = 1; i < p.length; i++) {
        const [a, b] = [p[i - 1], p[i]];
        const bounds = {
          x0: Math.min(a[0], b[0]),
          x1: Math.max(a[0], b[0]),
          z0: Math.min(a[1], b[1]),
          z1: Math.max(a[1], b[1]),
        };
        if (near(bounds)) segments.push(a[0], a[1], b[0], b[1], ROAD_WIDTH_M[c] / 2 + INDUSTRIAL_ROAD_CLEAR_M);
      }
    const free = (ax: number, az: number, bx: number, bz: number) => {
      const [mx, mz] = [(ax + bx) / 2, (az + bz) / 2];
      for (let i = 0; i < segments.length; i += 5) {
        const k = segments[i + 4];
        for (const [x, z] of [
          [ax, az],
          [mx, mz],
          [bx, bz],
        ])
          if (segmentDistance(x, z, segments[i], segments[i + 1], segments[i + 2], segments[i + 3]) < k) return false;
      }
      for (const f of footprints)
        if (
          pointInPolygon(f.p, mx, mz) ||
          distanceToLine([...f.p, f.p[0], f.p[1]], mx, mz) < WALL_CLEAR_M[BoundaryKind.MESH]
        )
          return false;
      const k = INDUSTRIAL_KEEP_OUT_M;
      if (
        keepOutBox &&
        mx > keepOutBox.x0 - k &&
        mx < keepOutBox.x1 + k &&
        mz > keepOutBox.z0 - k &&
        mz < keepOutBox.z1 + k
      )
        return false;
      return !inWater?.(mx, mz);
    };
    // the edge in pieces, round the ring from a vertex; the kept ones joined into runs
    const ring = [...area.p, area.p[0], area.p[1]];
    let run: number[] = [];
    let index = 0;
    const flush = () => {
      if (run.length >= 4 && lineLength(run) >= MIN_RUN_M) {
        // the area's side: a point just right of the run's first piece is inside it, or not
        const [ax, az, bx, bz] = run;
        const length = Math.hypot(bx - ax, bz - az) || 1;
        const [rx, rz] = [(ax + bx) / 2 - (bz - az) / length, (az + bz) / 2 + (bx - ax) / length];
        runs.push({
          kind: BoundaryKind.MESH,
          p: run,
          heightM: HEIGHT_M[BoundaryKind.MESH],
          variant: 0,
          key: `industry${ai}:${index++}`,
          inward: pointInPolygon(area.p, rx, rz) ? 1 : -1,
        });
      }
      run = [];
    };
    for (let i = 2; i < ring.length; i += 2) {
      const [ax, az, bx, bz] = [ring[i - 2], ring[i - 1], ring[i], ring[i + 1]];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / INDUSTRIAL_PIECE_M));
      for (let k = 0; k < n; k++) {
        const [x0, z0] = [ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n];
        const [x1, z1] = [ax + ((bx - ax) * (k + 1)) / n, az + ((bz - az) * (k + 1)) / n];
        if (!free(x0, z0, x1, z1)) {
          flush();
          continue;
        }
        if (!run.length) run.push(x0, z0);
        run.push(x1, z1);
      }
    }
    flush();
  });
  return runs;
}
