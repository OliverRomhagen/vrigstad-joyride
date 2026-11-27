// What stands on the plots' edges (#401): a clipped hedge, a picket fence, a board fence, a low stone wall or nothing.
// Pure: no three.js. Artistic rules, not a survey of Vrigstad: a street has a style that most of its plots share, with
// the odd one out; the street edge is the most often closed, the sides less, the back rarely. A boundary leaves a gap
// at the driveway and a garden gate opposite the house, none runs along a wall, and two neighbours' shared side is
// drawn once. Every choice hashes the street or the plot's key, never data order.

import type { Plot } from './plots';
import { polygonBounds, segmentDistance, vertexCentre } from './polygon';
import { hash01 } from './random';
import type { Profile } from './streetscape-rules';

export const BoundaryKind = { HEDGE: 0, PICKET: 1, BOARD: 2, WALL: 3 } as const;
export type BoundaryKind = (typeof BoundaryKind)[keyof typeof BoundaryKind];

/**
 * the share of a street's plots that each kind closes, by the street's profile; what is left is open. The centre's
 * older villas have hedges and picket fences, the later suburbs open lawns and the odd hedge, farms a stone wall.
 */
const STYLE_SHARES: Record<Profile, readonly (readonly [BoundaryKind, number])[]> = {
  centre: [
    [BoundaryKind.HEDGE, 0.45],
    [BoundaryKind.PICKET, 0.25],
    [BoundaryKind.WALL, 0.1],
  ],
  residential: [
    [BoundaryKind.HEDGE, 0.35],
    [BoundaryKind.PICKET, 0.15],
    [BoundaryKind.BOARD, 0.1],
  ],
  outskirts: [
    [BoundaryKind.WALL, 0.35],
    [BoundaryKind.HEDGE, 0.1],
    [BoundaryKind.PICKET, 0.1],
  ],
};
/** a plot goes its own way, rather than its street's, with this chance */
const ODD_ONE_SHARE = 0.15;
/** each side of a closed plot is closed too with this chance, and its back with this */
const SIDE_SHARE = 0.6;
const BACK_SHARE = 0.3;
/** a hedge is between these heights (m), by plot; the other kinds have one height each (m) */
const HEDGE_MIN_M = 0.9;
const HEDGE_SPREAD_M = 0.6;
const HEIGHT_M: Record<BoundaryKind, number> = { 0: 0, 1: 0.9, 2: 1.3, 3: 0.6 };
/** a picket or board fence is white or grey (variant 0) or falu red (1), falu red with this chance */
const FALU_SHARE: Record<BoundaryKind, number> = { 0: 0, 1: 0.3, 2: 0.6, 3: 0 };
/** a boundary this close to its own house's wall (m) is left out: the wall is the boundary */
const WALL_CLEAR_M = 1;
/** two plots' sides this close to each other (m) are one boundary */
const SHARED_M = 1.5;
/**
 * ... which they can only be when their middles are within this of each other (m): sides are at most 52 m long, and
 * two that are one boundary differ in length by at most 40 m
 */
const SIDE_CELL_M = 25;
/** the gap at a driveway is its width and this much either side (m); the garden gate is this wide (m) */
const DRIVEWAY_SPARE_M = 0.3;
const GATE_M = 1;
/** no gate within this of the driveway's gap (m): the driveway is the way in */
const GATE_DRIVEWAY_M = 2;
/** a piece of boundary shorter than this between gaps (m) is left out */
const MIN_RUN_M = 0.5;

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
}

/** The kind a plot's street gives it, or its own as the odd one out; null where it is open. */
function plotKind(plot: Plot, profile: Profile): BoundaryKind | null {
  const odd = hash01(plot.key, 'odd') < ODD_ONE_SHARE;
  let roll = odd ? hash01(plot.key, 'kind') : hash01(plot.ri, plot.side, 'style');
  for (const [kind, share] of STYLE_SHARES[profile]) {
    if (roll < share) return kind;
    roll -= share;
  }
  return null;
}

/** Shortest distance from any point of polyline `p` to polygon outline `q` (m), both flat [x, z, ...]. */
function polylineToOutlineM(p: readonly number[], q: readonly number[]) {
  let d = Infinity;
  if (boxGapM(p, q) >= WALL_CLEAR_M) return boxGapM(p, q); // a lower bound, and far enough for every caller
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

/** The hedges, fences and walls on the plots' edges; `profileOf` gives a street's profile (StreetSides.profile). */
export function layoutBoundaries(plots: readonly Plot[], profileOf: (ri: number) => Profile): BoundaryRun[] {
  // each plot's sides, to find the ones two neighbours share; p is [ax, az, bx, bz]
  const sides = plots.flatMap((plot, pi) => {
    const o = plot.outline;
    const n = o.length / 4;
    return [
      { pi, p: [o[2 * n - 2], o[2 * n - 1], o[2 * n], o[2 * n + 1]], which: 'right' },
      { pi, p: [o[4 * n - 2], o[4 * n - 1], o[0], o[1]], which: 'left' },
    ];
  });
  const mid = (p: number[]) => [(p[0] + p[2]) / 2, (p[1] + p[3]) / 2];
  const near = (p: number[], q: number[]) => {
    const [mx, mz] = mid(q);
    return segmentDistance(mx, mz, p[0], p[1], p[2], p[3]) < SHARED_M;
  };
  // the plot a side is shared with, by side: the one with the smaller key draws it, and keeps it off both walls
  const sharedWith = new Map<(typeof sides)[number], number>();
  // sides by the SIDE_CELL_M cell of their middle; two that are one boundary are in the same cell or the next
  const cellKey = (x: number, z: number) => Math.floor(x / SIDE_CELL_M) * 65536 + Math.floor(z / SIDE_CELL_M);
  const byCell = new Map<number, (typeof sides)[number][]>();
  for (const side of sides) {
    const key = cellKey(...(mid(side.p) as [number, number]));
    byCell.set(key, [...(byCell.get(key) ?? []), side]);
  }
  for (const a of sides) {
    const [mx, mz] = mid(a.p);
    for (const dx of [-SIDE_CELL_M, 0, SIDE_CELL_M])
      for (const dz of [-SIDE_CELL_M, 0, SIDE_CELL_M])
        for (const b of byCell.get(cellKey(mx + dx, mz + dz)) ?? [])
          if (a.pi !== b.pi && near(a.p, b.p) && near(b.p, a.p)) sharedWith.set(a, b.pi);
  }

  const runs: BoundaryRun[] = [];
  plots.forEach((plot, pi) => {
    const kind = plotKind(plot, profileOf(plot.ri));
    if (kind === null) return;
    const heightM =
      kind === BoundaryKind.HEDGE ? HEDGE_MIN_M + hash01(plot.key, 'height') * HEDGE_SPREAD_M : HEIGHT_M[kind];
    const variant: 0 | 1 = hash01(plot.key, 'paint') < FALU_SHARE[kind] ? 1 : 0;
    const { x: hx, z: hz } = vertexCentre(plot.house);
    const add = (p: number[], neighbour?: Plot) => {
      if (polylineToOutlineM(p, plot.house) < WALL_CLEAR_M) return;
      if (neighbour && polylineToOutlineM(p, neighbour.house) < WALL_CLEAR_M) return;
      // > 0: the house's middle is right of the line's first piece (x east, z south)
      const cross = (p[2] - p[0]) * (hz - p[1]) - (p[3] - p[1]) * (hx - p[0]);
      runs.push({ kind, p, heightM, variant, key: plot.key, inward: cross > 0 ? 1 : -1 });
    };
    const o = plot.outline;
    const n = o.length / 4;

    // the street edge, with gaps at the driveway and the gate
    const front = o.slice(0, 2 * n);
    const gaps: [number, number][] = [];
    const d = plot.driveway;
    if (d)
      for (let i = 2; i < d.p.length; i += 2) {
        const at = crossingAlong(front, d.p[i - 2], d.p[i - 1], d.p[i], d.p[i + 1]);
        if (at === null) continue;
        const half = d.widthM / 2 + DRIVEWAY_SPARE_M;
        gaps.push([at - half, at + half]);
        break;
      }
    const gate = nearestAlong(front, hx, hz);
    if (gaps.every(([g0, g1]) => gate < g0 - GATE_DRIVEWAY_M || gate > g1 + GATE_DRIVEWAY_M))
      gaps.push([gate - GATE_M / 2, gate + GATE_M / 2]);
    for (const piece of cut(front, gaps)) add(piece);

    for (const side of sides.slice(pi * 2, pi * 2 + 2)) {
      const neighbour = sharedWith.has(side) ? plots[sharedWith.get(side)!] : undefined;
      if (neighbour && neighbour.key < plot.key) continue; // the neighbour draws it
      if (hash01(plot.key, side.which) < SIDE_SHARE) add(side.p, neighbour);
    }
    if (hash01(plot.key, 'back') < BACK_SHARE) add(o.slice(2 * n));
  });
  return runs;
}
