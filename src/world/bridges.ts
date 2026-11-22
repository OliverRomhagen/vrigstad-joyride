// The mapped bridges (#238): which road pieces cross on one, what kind of structure each is, and the height of its
// deck. Pure: no three.js. One deck height serves the ribbon, the ground query and the mesh, so they agree.
import { ROAD_WIDTH_M, RoadClass, type WorldData } from './data';
import type { Heightfield } from './heightfield';
import { segmentParam } from './polygon';
import { arcLengths } from './polyline';
import { nodeKey, type Point, roadLiftM } from './roads';
import type { Source } from './streetscape-rules';

export type BridgeArchetype = 'road-slab' | 'path-steel' | 'path-timber';

export interface Bridge {
  /** 'b' and the lowest OSM way id in it, or its rounded start point where the data has no ids (fixtures) */
  key: string;
  /** indices into data.r, in order along the bridge */
  roads: number[];
  archetype: BridgeArchetype;
  roadClass: RoadClass;
  /** the centre line from end to end, and the arc length at each of its vertices (m) */
  p: Point[];
  arcs: number[];
  spanM: number;
  /** the carriageway or path the road ribbon draws (m) */
  carriageM: number;
  /** each walkway, curb top included, beside the carriageway (m); 0 on footbridges */
  walkwayM: number;
  /** from the centre line to the deck's outer edge (m) */
  halfWidthM: number;
  /** from the centre line to the middle of each railing (m): where BridgeMesh draws it and what collides with it */
  railingM: number;
  /** the crest of the deck above its ends (m) */
  riseM: number;
  /** evidence for the inferred parts, in #187's words: heights, structure and railings are always inferred */
  source: { width: Source; structure: Source };
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

// ---------- archetypes (game-design values: OSM maps no structure, material, width or railing here) ----------
/** how high each archetype's deck rises in the middle, and the steepest grade at its ends */
const RISE_M: Record<BridgeArchetype, number> = { 'road-slab': 0.3, 'path-steel': 0.35, 'path-timber': 0.25 };
const MAX_GRADE_ROAD = 0.05;
const MAX_GRADE_PATH = 0.08;
/** a road bridge's walkway each side: the centre profile's 2 m pavement plus its 0.15 m curb top, so it continues it (m) */
const WALKWAY_M = 2.15;
/** a road bridge's raised edge beam, outside the walkway (m) */
const EDGE_BEAM_M = 0.4;
/** the walkway's curb above the carriageway: the centre profile's, as on the approach pavements (m) */
export const WALKWAY_CURB_M = 0.12;
/** a footbridge's deck: path width plus this, at least the minimum (m) */
const STEEL_EXTRA_M = 1;
const STEEL_MIN_M = 2.5;
const STEEL_CYCLE_MIN_M = 3;
const TIMBER_EXTRA_M = 0.6;
const TIMBER_MIN_M = 1.8;
/** a path longer than this is a steel footbridge even without bicycle=designated (m) */
const STEEL_SPAN_M = 10;
/** people on a footbridge walk this far in from its railings, clear of them (m) */
const FOOTBRIDGE_WALK_IN_M = 0.5;
/** each archetype's railing stands this far in from the deck's edge: on the edge beam, on the girder, on the boards (m) */
const RAILING_IN_M: Record<BridgeArchetype, number> = {
  'road-slab': EDGE_BEAM_M / 2,
  'path-steel': 0.075,
  'path-timber': 0.05,
};
/** railings start and end this far inside the deck's ends, so they never reach across an approach (m) */
export const RAILING_INSET_M = 0.3;

/** The archetype: a road on a concrete slab, a cycle or long path on a steel footbridge, a short footway on timber. */
export function archetypeOf(c: RoadClass, cycle: boolean, spanM: number): BridgeArchetype {
  if (c <= RoadClass.SERVICE) return 'road-slab';
  return cycle || spanM > STEEL_SPAN_M ? 'path-steel' : 'path-timber';
}

/** The crest of a deck at arc position t (0 to 1): zero at both ends, so the deck meets its approaches exactly. */
export const crest = (riseM: number, t: number) => (t <= 0 || t >= 1 ? 0 : riseM * 4 * t * (1 - t));

/** Where a point lies against a bridge: arc length along it and distance across, signed to the right (m). */
export interface DeckPoint {
  s: number;
  d: number;
}

/**
 * The bridges, found from OSM's bridge tags only (never from river crossings), and their deck heights. The deck
 * follows `base` (the terrain before anything is cut into it) plus the road lift and the crest.
 */
export class BridgeIndex {
  readonly bridges: Bridge[] = [];
  private readonly byRoad = new Map<number, Bridge>();
  private readonly base: Pick<Heightfield, 'heightAt'>;
  private readonly at: DeckPoint = { s: 0, d: 0 };

  constructor(data: WorldData, base: Pick<Heightfield, 'heightAt'>) {
    this.base = base;
    const pts = (ri: number): Point[] => {
      const p: Point[] = [];
      for (let i = 0; i < data.r[ri].p.length; i += 2) p.push([data.r[ri].p[i], data.r[ri].p[i + 1]]);
      return p;
    };
    const free = new Set(data.r.flatMap((r, ri) => (r.br && r.p.length >= 4 ? [ri] : [])));
    const same = (a: number, b: number) => data.r[a].c === data.r[b].c && data.r[a].br?.l === data.r[b].br?.l;
    for (const first of [...free]) {
      if (!free.has(first)) continue;
      free.delete(first);
      const roads = [first];
      let p = pts(first);
      // grow the chain at either end with free pieces that share that end node, the same class and layer
      for (let grown = true; grown; ) {
        grown = false;
        for (const ri of free) {
          if (!same(first, ri)) continue;
          const q = pts(ri);
          const [a, b] = [nodeKey(q[0]), nodeKey(q[q.length - 1])];
          const [head, tail] = [nodeKey(p[0]), nodeKey(p[p.length - 1])];
          if (a === tail || b === tail) {
            p = p.concat((a === tail ? q : q.reverse()).slice(1));
            roads.push(ri);
          } else if (a === head || b === head) {
            p = (b === head ? q : q.reverse()).slice(0, -1).concat(p);
            roads.unshift(ri);
          } else continue;
          free.delete(ri);
          grown = true;
        }
      }
      const r = data.r[first];
      const c = r.c;
      const arcs = arcLengths(p);
      const spanM = arcs[arcs.length - 1];
      const archetype = archetypeOf(
        c,
        roads.some(ri => data.r[ri].br?.cy),
        spanM,
      );
      const carriageM = r.w ?? ROAD_WIDTH_M[c];
      const walkwayM = archetype === 'road-slab' ? WALKWAY_M : 0;
      const deckM =
        archetype === 'road-slab'
          ? carriageM + 2 * (WALKWAY_M + EDGE_BEAM_M)
          : archetype === 'path-steel'
            ? Math.max(carriageM + STEEL_EXTRA_M, r.br?.cy ? STEEL_CYCLE_MIN_M : STEEL_MIN_M)
            : Math.max(carriageM + TIMBER_EXTRA_M, TIMBER_MIN_M);
      const grade = archetype === 'road-slab' ? MAX_GRADE_ROAD : MAX_GRADE_PATH;
      const ids = roads.map(ri => data.r[ri].i).filter(i => i !== undefined);
      const half = deckM / 2;
      const bridge: Bridge = {
        key: ids.length ? 'b' + Math.min(...ids) : 'b' + Math.round(p[0][0]) + ',' + Math.round(p[0][1]),
        roads,
        archetype,
        roadClass: c,
        p,
        arcs,
        spanM,
        carriageM,
        walkwayM,
        halfWidthM: half,
        railingM: half - RAILING_IN_M[archetype],
        riseM: Math.min(RISE_M[archetype], (grade * spanM) / 4),
        source: { width: r.w ? 'mapped' : 'derived', structure: 'inferred' },
        x0: Math.min(...p.map(q => q[0])) - half,
        x1: Math.max(...p.map(q => q[0])) + half,
        z0: Math.min(...p.map(q => q[1])) - half,
        z1: Math.max(...p.map(q => q[1])) + half,
      };
      this.bridges.push(bridge);
      for (const ri of roads) this.byRoad.set(ri, bridge);
    }
    this.bridges.sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  /** The bridge road ri crosses on, if any. */
  bridgeOf(ri: number) {
    return this.byRoad.get(ri);
  }

  /**
   * Where (x, z) lies along and across a bridge, written into `out`, or null past its ends. The arc length is the
   * projection on the nearest segment; past the first or last vertex the point is off the deck.
   */
  locate(b: Bridge, x: number, z: number, out: DeckPoint = this.at): DeckPoint | null {
    let best = Infinity;
    for (let i = 1; i < b.p.length; i++) {
      const [ax, az] = b.p[i - 1];
      const dx = b.p[i][0] - ax;
      const dz = b.p[i][1] - az;
      const len2 = dx * dx + dz * dz || 1;
      const u = ((x - ax) * dx + (z - az) * dz) / len2;
      if ((u < 0 && i === 1) || (u > 1 && i === b.p.length - 1)) continue;
      const cu = Math.max(0, Math.min(1, u));
      const px = x - ax - dx * cu;
      const pz = z - az - dz * cu;
      const dist = Math.hypot(px, pz);
      if (dist < best) {
        best = dist;
        out.s = b.arcs[i - 1] + cu * Math.sqrt(len2);
        // right of the direction (dx, dz) is (-dz, dx)
        out.d = Math.sign(-dz * px + dx * pz) * dist;
      }
    }
    return best < Infinity ? out : null;
  }

  /** The driving surface at (x, z) on bridge b, `s` metres along it: the base terrain, the road lift and the crest. */
  surfaceAt(b: Bridge, x: number, z: number, s: number) {
    return this.base.heightAt(x, z) + roadLiftM(b.roadClass) + crest(b.riseM, s / b.spanM);
  }

  /** What people and cars stand on at (x, z) within a deck: the carriageway, or the walkway's curb; else null. */
  deckAt(x: number, z: number) {
    // shortcut: six bridges, so a bounds check each rather than a grid; file them in cells if there are ever dozens
    for (const b of this.bridges) {
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      const at = this.locate(b, x, z);
      if (!at || Math.abs(at.d) > b.halfWidthM) continue;
      const walkway = b.walkwayM > 0 && Math.abs(at.d) > b.carriageM / 2;
      return this.surfaceAt(b, x, z, at.s) + (walkway ? WALKWAY_CURB_M : 0);
    }
    return null;
  }

  onDeck(x: number, z: number) {
    return this.deckAt(x, z) !== null;
  }

  /** Height of a ribbon vertex `lift` above the deck's terrain on bridge road ri, or undefined off the bridges. */
  ribbonHeight(ri: number, x: number, z: number, lift: number) {
    const b = this.byRoad.get(ri);
    if (!b) return undefined;
    const s = this.locate(b, x, z)?.s ?? 0;
    return this.base.heightAt(x, z) + lift + crest(b.riseM, s / b.spanM);
  }

  /** How far from the centre line people walk on bridge road ri: the walkway's middle, or inside a footbridge's edge. */
  walkOffsetM(ri: number) {
    const b = this.byRoad.get(ri);
    if (!b) return undefined;
    return b.walkwayM > 0 ? b.carriageM / 2 + b.walkwayM / 2 : b.railingM - FOOTBRIDGE_WALK_IN_M;
  }

  /**
   * Pushes `o` out to `r` from every railing it is within `r` of, as BuildingIndex.collide does from walls, so cars,
   * people and cats stop at them; true on a hit. A car (r 1.5) fits between a road bridge's railings but not a
   * footbridge's, so it stops at the end of one.
   */
  collide(o: { x: number; z: number }, r: number) {
    let hit = false;
    for (const b of this.bridges) {
      if (o.x < b.x0 - r || o.x > b.x1 + r || o.z < b.z0 - r || o.z > b.z1 + r) continue;
      // shortcut: each railing runs straight beside its centre-line segment, so a bent bridge would leave gaps at its
      // bends; all six mapped bridges are straight, so mitre them like BridgeMesh if a bent one appears
      for (let i = 1; i < b.p.length; i++) {
        const s0 = Math.max(b.arcs[i - 1], RAILING_INSET_M);
        const s1 = Math.min(b.arcs[i], b.spanM - RAILING_INSET_M);
        if (s1 <= s0) continue;
        const [ax, az] = b.p[i - 1];
        const len = b.arcs[i] - b.arcs[i - 1];
        const tx = (b.p[i][0] - ax) / len;
        const tz = (b.p[i][1] - az) / len;
        for (const side of [-1, 1]) {
          // right of the direction (tx, tz) is (-tz, tx)
          const nx = -tz * side;
          const nz = tx * side;
          const x0 = ax + tx * (s0 - b.arcs[i - 1]) + nx * b.railingM;
          const z0 = az + tz * (s0 - b.arcs[i - 1]) + nz * b.railingM;
          const x1 = ax + tx * (s1 - b.arcs[i - 1]) + nx * b.railingM;
          const z1 = az + tz * (s1 - b.arcs[i - 1]) + nz * b.railingM;
          const t = segmentParam(o.x, o.z, x0, z0, x1, z1);
          const qx = x0 + (x1 - x0) * t;
          const qz = z0 + (z1 - z0) * t;
          const d = Math.hypot(o.x - qx, o.z - qz);
          if (d >= r) continue;
          // on the railing itself, push towards the deck's middle
          const [ux, uz] = d > 1e-9 ? [(o.x - qx) / d, (o.z - qz) / d] : [-nx, -nz];
          o.x = qx + ux * r;
          o.z = qz + uz * r;
          hit = true;
        }
      }
    }
    return hit;
  }
}
