// What stands on the plots' edges (#401): a clipped hedge, a picket fence, a board fence, a low stone wall or nothing.
// Pure: no three.js. Artistic rules, not a survey of Vrigstad. Towards the street, half the plots take their street's
// style and half choose their own, so a street has a character without being uniform. Between neighbours and at the
// back, hedges and board fences give shelter, chosen on their own. Each plot has its own boundaries on its own side of
// the line, so a hedge and a fence can stand side by side between two houses. A boundary leaves a gap at the driveway
// and a garden gate opposite the house, and keeps off its house's walls. Every choice hashes the street or the plot's
// key, never data order.

import type { Plot } from './plots';
import { polygonBounds, segmentDistance, vertexCentre } from './polygon';
import { hash01 } from './random';
import type { Profile } from './streetscape-rules';

export const BoundaryKind = { HEDGE: 0, PICKET: 1, BOARD: 2, WALL: 3 } as const;
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
const HEIGHT_M: Record<BoundaryKind, number> = { 0: 0, 1: 0.9, 2: 1.4, 3: 0.6 };
/** a picket or board fence is white or grey (variant 0) or falu red (1), falu red with this chance, by plot */
const FALU_SHARE: Record<BoundaryKind, number> = { 0: 0, 1: 0.3, 2: 0.6, 3: 0 };
/**
 * a boundary stands inside its plot from its line, as thick as it is; it is left out where its house's wall is nearer
 * the line than this (m): a hedge needs room, a fence can stand close
 */
const WALL_CLEAR_M: Record<BoundaryKind, number> = { 0: 0.8, 1: 0.15, 2: 0.15, 3: 0.6 };
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
      runs.push({ kind, p, heightM, variant, key: plot.key, inward: cross > 0 ? 1 : -1 });
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
