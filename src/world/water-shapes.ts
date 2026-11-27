// Lakes, rivers and streams as bodies of water with a level, a width and banks, and the channel they cut into the
// ground (#263). Pure: no three.js. The heightfield carves the channels (TerrainCut), the game asks it what is wet,
// and the water and shore meshes are built on the same numbers, so what you see and what the game tests agree.
import { alongEdge } from './bounds';
import { type WaterwayKind as Kind, ROAD_WIDTH_M, RoadClass, WaterwayKind, type WorldData } from './data';
import type { TerrainCut } from './heightfield';
import { clamp } from './math';
import { pointInPolygon, segmentParam } from './polygon';
import { fnv1a } from './random';
import { nodeKey } from './roads';

// ---------- rivers and streams ----------
/** half the width of a river's water (m), as the surface, the paint and the game's water test all take it */
export const RIVER_HALF_WIDTH_M = 2.6;
/** half the width of a stream's water (m) */
export const STREAM_HALF_WIDTH_M = 1.1;
/** how much the width wanders either way along the course, as a share */
const WIDTH_WOBBLE = 0.12;
/** the stretch over which the width and the banks' steepness wander (m) */
const WOBBLE_M = 70;
/** the water surface sits at least this far below the ground either side of it (m): what makes the channel read */
const RIVER_RECESS_M = 1.0;
const STREAM_RECESS_M = 0.55;
/** the bed's deepest point, at the centre line, below the surface (m); the bed rises to the waterline at the edge */
const RIVER_BED_M = 0.45;
const STREAM_BED_M = 0.25;
/** rise of a bank per metre out from the waterline, before the wobble; steeper for streams, which cut narrower */
const RIVER_BANK_SLOPE = 0.5;
const STREAM_BANK_SLOPE = 0.6;
/** how far the steepness wanders either way, as a share */
const BANK_WOBBLE = 0.3;
/** the course is sampled this often (m) */
const PROFILE_STEP_M = 2;
/**
 * How steeply the surface may climb along the flow. The 25 m elevation grid is smoothed and carries a few metres of
 * noise along the river; a level that never rose would cut metres deep through every bump, and leave the lake it feeds
 * metres below its shore. A climb of a centimetre or so a metre isn't visible on water a few metres wide, and absorbs
 * that noise.
 */
const MAX_RISE = 0.015;
/** towards a lake, the surface may fall this steeply to meet the lake's level (per metre) */
const MAX_FALL = 0.02;
/** a course whose end lies this much higher than its start flows the other way (m); OSM draws waterways downstream */
const FLOW_FLIP_M = 1.5;
/** within this of a lake, along the course, a river's recess eases to the lake's (m) */
const NEAR_LAKE_M = 40;
/** how far parameters blend where a river becomes a stream (m) */
const KIND_BLEND_M = 12;

// ---------- lakes ----------
/** a lake's level sits this far below the low end (the share below) of its shore's ground (m) */
const LAKE_RECESS_M = 0.35;
const SHORE_PERCENTILE = 0.1;
/** the ground at the mapped shore stands this far above the level (m), so the water's edge is a little inside it */
const LAKE_LIP_M = 0.1;
/** the lake bed falls this much per metre from the shore, down to the shelf's depth below the level */
const LAKE_SHELF_SLOPE = 0.35;
const LAKE_SHELF_M = 1.2;
/** rise of a lake's bank per metre from the shore, before the wobble */
const LAKE_BANK_SLOPE = 0.3;
/** where the shore's ground is lower than the water, it is raised to hold it, fading out between these distances (m) */
const LAKE_RAISE_FULL_M = 6;
const LAKE_RAISE_END_M = 10;
/** shore points within this of the world's edge are where the map cuts the lake, not a shore (m) */
const EDGE_M = 0.5;

// ---------- the cut ----------
/** a bank never reaches further than this from the water (m): beyond it, the ground is untouched */
const MAX_BANK_M = 12;
/** rounds the top of a bank where it meets the untouched ground (m) */
const BANK_ROUND_M = 0.4;
/** sub-samples per side of a 25 m grid cell: fine enough for a stream's banks, a river's, a lake shore's */
const STREAM_DETAIL = 24;
const RIVER_DETAIL = 12;
const LAKE_DETAIL = 6;
/** a lake shore whose ground stands this far above the water gets the finer grid (m) */
const LAKE_STEEP_M = 1.6;
/** side of the lookup cells (m); half the elevation grid's, so a grid cell is four whole lookup cells */
const CELL_M = 12.5;
/** a lookup cell's key as a number, so the per-frame lookups (inWater, every car, the player, the cats) build no string */
const cellKey = (cx: number, cz: number) => (cx + 2048) * 4096 + cz + 2048;

// ---------- what the channel keeps away from ----------
/** a street's ground is kept as it is this far past its edge (sidewalks, verges), easing into the bank over the next span (m) */
const STREET_KEEP_M = 2.5;
const STREET_EASE_M = 3.5;
/** the same for tracks and paths */
const PATH_KEEP_M = 1.5;
const PATH_EASE_M = 2.5;
/** and for buildings, from their walls */
const BUILDING_KEEP_M = 1.5;
const BUILDING_EASE_M = 3.5;

/** numbers per keep entry, and the flags for a segment end that meets a bridge (its eighth number is the seat there) */
const KEEP_STRIDE = 8;
const OPEN_A = 1;
const OPEN_B = 2;
/** under a bridge's end the ground stays as it is this far, where the abutment sits, so the cut grid's sub-samples
 * keep the approach itself at its height: streets, and the paths' shorter footbridges (m) */
const BRIDGE_SEAT_STREET_M = 2;
const BRIDGE_SEAT_PATH_M = 0.8;

export interface Course {
  /** stable name, for seeds and debugging */
  key: string;
  /** samples along the course, downstream, every PROFILE_STEP_M or less */
  x: Float64Array;
  z: Float64Array;
  /** distance along the course (m) */
  s: Float64Array;
  /** water level (m above the lowest sample, not exaggerated) */
  level: Float64Array;
  /** half the water's width (m) */
  half: Float64Array;
  /** the banks' rise per metre */
  slope: Float64Array;
  /** the bed's depth below the level at the centre line (m) */
  bed: Float64Array;
  /** the lake a sample lies in, or -1 */
  lake: Int16Array;
  /** 1 where the sample's kind is a stream, 0 for a river, blended between */
  stream: Float64Array;
}

export interface Lake extends Bounds {
  key: string;
  /** fnv1a of the key, for the banks' wobble */
  seed: number;
  /** outline and islands, flat [x, z, ...] */
  rings: number[][];
  /** water level (m above the lowest sample, not exaggerated) */
  level: number;
}

interface Bounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** A smooth value in [0, 1) that wanders along t, the same for the same seed (`fnv1a` of a key) and t. */
export function wander(seed: number, t: number) {
  const i = Math.floor(t);
  const f = t - i;
  const a = mix32(seed, i);
  const b = mix32(seed, i + 1);
  return a + (b - a) * f * f * (3 - 2 * f);
}

/** an integer hash of (seed, i) in [0, 1): cheap enough for every sample of the cut, unlike hashing text */
function mix32(seed: number, i: number) {
  let h = Math.imul(seed ^ Math.imul(i, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** the smaller of a and b, rounded over k where they are close */
const softMin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0);
  return Math.min(a, b) - (h * h) / (4 * k);
};

/**
 * The water level along a course, downstream: as high as it can be while staying `recess` below the ground at every
 * sample (`target`), climbing at most MAX_RISE per metre, held at a lake's level inside it and falling to meet the
 * lake before it. Exported for the tests.
 */
export function courseLevels(target: ArrayLike<number>, s: ArrayLike<number>, lakeLevel: ArrayLike<number>) {
  const n = target.length;
  const level = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    if (!Number.isNaN(lakeLevel[k])) level[k] = lakeLevel[k];
    else if (k === 0) level[k] = target[0];
    else level[k] = Math.min(target[k], level[k - 1] + MAX_RISE * (s[k] - s[k - 1]));
  }
  // falling into a lake: never above the lake plus the steepest fall allowed from here to where it enters
  let anchor = Number.NaN;
  let anchorS = 0;
  for (let k = n - 1; k >= 0; k--) {
    if (!Number.isNaN(lakeLevel[k])) {
      anchor = lakeLevel[k];
      anchorS = s[k];
    } else if (!Number.isNaN(anchor)) level[k] = Math.min(level[k], anchor + MAX_FALL * (anchorS - s[k]));
  }
  return level;
}

/** Index of the p-th share of the values, sorted. */
const percentile = (values: number[], p: number) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

/**
 * The lakes, rivers and streams with their levels and banks, and the channels they cut. `base` is the uncut ground
 * (a Heightfield with no exaggeration); build the game's heightfield with `{ cut: bodies }` after this.
 */
export class WaterBodies implements TerrainCut {
  readonly courses: Course[] = [];
  readonly lakes: Lake[] = [];
  private readonly bounds: WorldData['bounds'];
  private readonly base: { heightAt(x: number, z: number): number };
  /** lookup cells: course runs as [course, first sample, last sample], lake shore segments as [lake, ring, vertex] */
  private readonly courseCells = new Map<number, number[]>();
  private readonly shoreCells = new Map<number, number[]>();
  /** what the channel keeps away from, KEEP_STRIDE numbers each: ax, az, bx, bz, keep and ease distances, open ends, seat */
  private readonly keepCells = new Map<number, number[]>();
  private readonly buildings: { p: number[]; x0: number; x1: number; z0: number; z1: number }[];

  constructor(data: WorldData, base: { heightAt(x: number, z: number): number }) {
    this.bounds = data.bounds;
    this.base = base;
    this.buildings = data.b.map(b => ({ p: b.p, ...boundsOf(b.p) }));
    data.w.forEach(rings => {
      const key = `lake:${Math.round(rings[0][0])},${Math.round(rings[0][1])}`;
      this.lakes.push({ key, seed: fnv1a(key), rings, level: 0, ...boundsOf(rings[0]) });
    });
    this.fileKeeps(data);

    // shore heights, for each lake's level
    const lakeLevel = this.lakes.map(l => {
      const heights: number[] = [];
      this.forShore(l, (ax, az, bx, bz) => {
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4));
        for (let t = 0; t < steps; t++)
          heights.push(base.heightAt(ax + ((bx - ax) * t) / steps, az + ((bz - az) * t) / steps));
      });
      return heights.length
        ? percentile(heights, SHORE_PERCENTILE) - LAKE_RECESS_M
        : base.heightAt((l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2);
    });

    const raw = this.chain(data).map(c => this.sample(c, base));
    // a lake is no higher than the ground where its outlets leave it, nor than the rivers flowing in: settle the
    // levels, which only ever fall, before the courses take them
    for (const c of raw)
      for (let k = 1; k < c.n; k++) {
        const lake = c.lake[k - 1];
        if (lake >= 0 && c.lake[k] < 0) lakeLevel[lake] = Math.min(lakeLevel[lake], c.target[k]);
      }
    for (let pass = 0; pass < 8; pass++) {
      let moved = false;
      for (const c of raw) {
        const level = courseLevels(
          c.target,
          c.s,
          Array.from(c.lake, l => (l < 0 ? Number.NaN : lakeLevel[l])),
        );
        for (let k = 1; k < c.n; k++) {
          const lake = c.lake[k];
          if (lake >= 0 && c.lake[k - 1] < 0 && level[k - 1] < lakeLevel[lake] - 1e-9) {
            lakeLevel[lake] = level[k - 1];
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    this.lakes.forEach((l, i) => {
      l.level = lakeLevel[i];
    });
    for (const c of raw) {
      const level = courseLevels(
        c.target,
        c.s,
        Array.from(c.lake, l => (l < 0 ? Number.NaN : lakeLevel[l])),
      );
      this.courses.push({
        key: c.key,
        x: c.x,
        z: c.z,
        s: c.s,
        level,
        half: c.half,
        slope: c.slope,
        bed: c.bed,
        lake: c.lake,
        stream: c.stream,
      });
      this.fileCourse(this.courses.length - 1, c.corners);
    }
    this.lakes.forEach((l, li) => {
      l.rings.forEach((r, ri) => {
        for (let v = 0; v < r.length; v += 2) {
          const w = (v + 2) % r.length;
          this.file(this.shoreCells, r[v], r[v + 1], r[w], r[w + 1], MAX_BANK_M, [li, ri, v]);
        }
      });
    });
  }

  // ---------- building ----------

  /** The waterways joined end to start into courses, where one ends exactly where one other starts. */
  private chain(data: WorldData) {
    const key = (x: number, z: number) => Math.round(x) + ',' + Math.round(z);
    const lines = data.ww.filter(w => w.p.length >= 4);
    const startsAt = new Map<string, number[]>();
    const endsAt = new Map<string, number[]>();
    lines.forEach((w, i) => {
      const s = key(w.p[0], w.p[1]);
      const e = key(w.p[w.p.length - 2], w.p[w.p.length - 1]);
      startsAt.set(s, [...(startsAt.get(s) ?? []), i]);
      endsAt.set(e, [...(endsAt.get(e) ?? []), i]);
    });
    const next = (i: number) => {
      const w = lines[i].p;
      const e = key(w[w.length - 2], w[w.length - 1]);
      const out = startsAt.get(e) ?? [];
      return out.length === 1 && (endsAt.get(e) ?? []).length === 1 && out[0] !== i ? out[0] : -1;
    };
    const hasPrev = new Set<number>();
    lines.forEach((_, i) => {
      const j = next(i);
      if (j >= 0) hasPrev.add(j);
    });
    const used = new Set<number>();
    const out: { key: string; parts: { kind: Kind; p: number[] }[] }[] = [];
    // starts first, then whatever is left (a loop) from its lowest index
    const order = [...lines.keys()].sort((a, b) => Number(hasPrev.has(a)) - Number(hasPrev.has(b)) || a - b);
    for (const first of order) {
      if (used.has(first)) continue;
      const parts: { kind: Kind; p: number[] }[] = [];
      for (let i = first; i >= 0 && !used.has(i); i = next(i)) {
        used.add(i);
        parts.push({ kind: lines[i].k, p: lines[i].p });
      }
      out.push({ key: `course:${Math.round(parts[0].p[0])},${Math.round(parts[0].p[1])}`, parts });
    }
    return out;
  }

  /** A course sampled every PROFILE_STEP_M, turned downstream, with the ground's target level and its banks. */
  private sample(
    course: { key: string; parts: { kind: Kind; p: number[] }[] },
    base: { heightAt(x: number, z: number): number },
  ) {
    const xs: number[] = [];
    const zs: number[] = [];
    const kinds: number[] = [];
    /** 1 where a sample is a vertex of the mapped line: the course is straight between two of them */
    const corners: number[] = [];
    for (const { kind, p } of course.parts) {
      for (let i = 2; i < p.length; i += 2) {
        const ax = p[i - 2];
        const az = p[i - 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(p[i] - ax, p[i + 1] - az) / PROFILE_STEP_M));
        for (let t = xs.length ? 1 : 0; t <= steps; t++) {
          xs.push(ax + ((p[i] - ax) * t) / steps);
          zs.push(az + ((p[i + 1] - az) * t) / steps);
          kinds.push(kind === WaterwayKind.STREAM ? 1 : 0);
          corners.push(t === 0 || t === steps ? 1 : 0);
        }
      }
    }
    const n = xs.length;
    const ground = xs.map((x, k) => base.heightAt(x, zs[k]));
    // OSM draws a waterway downstream, but trust the ground when it clearly says otherwise
    const ends = Math.min(25, Math.floor(n / 2) || 1);
    const mean = (from: number, to: number) => ground.slice(from, to).reduce((a, b) => a + b, 0) / (to - from);
    if (mean(n - ends, n) - mean(0, ends) > FLOW_FLIP_M) for (const a of [xs, zs, kinds, corners, ground]) a.reverse();
    const s = new Float64Array(n);
    for (let k = 1; k < n; k++) s[k] = s[k - 1] + Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]);
    // the kind blends over KIND_BLEND_M either side of where it changes
    const stream = new Float64Array(n);
    for (let k = 0, lo = 0, hi = 0, sum = 0; k < n; k++) {
      while (hi < n && s[hi] <= s[k] + KIND_BLEND_M) sum += kinds[hi++];
      while (s[lo] < s[k] - KIND_BLEND_M) sum -= kinds[lo++];
      stream[k] = sum / (hi - lo);
    }
    const mix = (river: number, brook: number, k: number) => river + (brook - river) * stream[k];
    const half = new Float64Array(n);
    const slope = new Float64Array(n);
    const bed = new Float64Array(n);
    const target = new Float64Array(n);
    const lake = new Int16Array(n);
    const widthSeed = fnv1a(course.key, 'w');
    const bankSeed = fnv1a(course.key, 'b');
    for (let k = 0; k < n; k++) {
      const w = (wander(widthSeed, s[k] / WOBBLE_M) * 2 - 1) * WIDTH_WOBBLE;
      const b = (wander(bankSeed, s[k] / WOBBLE_M) * 2 - 1) * BANK_WOBBLE;
      half[k] = mix(RIVER_HALF_WIDTH_M, STREAM_HALF_WIDTH_M, k) * (1 + w);
      slope[k] = mix(RIVER_BANK_SLOPE, STREAM_BANK_SLOPE, k) * (1 + b);
      bed[k] = mix(RIVER_BED_M, STREAM_BED_M, k);
      lake[k] = this.lakeAt(xs[k], zs[k]);
    }
    // the recess eases to the lake's own near a lake, as a river flattens into the lake it feeds or leaves
    const toLake = new Float64Array(n).fill(Infinity);
    for (let k = 0, last = -Infinity; k < n; k++) {
      if (lake[k] >= 0) last = s[k];
      toLake[k] = s[k] - last;
    }
    for (let k = n - 1, next = Infinity; k >= 0; k--) {
      if (lake[k] >= 0) next = s[k];
      toLake[k] = Math.min(toLake[k], next - s[k]);
    }
    for (let k = 0; k < n; k++)
      target[k] =
        ground[k] -
        LAKE_RECESS_M -
        (mix(RIVER_RECESS_M, STREAM_RECESS_M, k) - LAKE_RECESS_M) * smoothstep(0, NEAR_LAKE_M, toLake[k]);
    return {
      key: course.key,
      n,
      x: Float64Array.from(xs),
      z: Float64Array.from(zs),
      s,
      half,
      slope,
      bed,
      target,
      lake,
      stream,
      corners,
    };
  }

  /**
   * Files the course's straight runs (between the mapped line's vertices, where the samples are evenly spaced) as
   * [course, first sample, last sample], leaving out what lies inside a lake, whose shelf is the bed there.
   */
  private fileCourse(ci: number, corners: number[]) {
    const c = this.courses[ci];
    const n = c.x.length;
    for (let k0 = 0; k0 < n - 1; ) {
      let k1 = k0 + 1;
      while (k1 < n - 1 && !corners[k1] && c.lake[k1] < 0 === c.lake[k0 + 1] < 0) k1++;
      if (!(c.lake[k0] >= 0 && c.lake[k1] >= 0 && c.lake[k0 + 1] >= 0)) {
        let reach = 0;
        for (let k = k0; k <= k1; k++) reach = Math.max(reach, c.half[k]);
        this.file(this.courseCells, c.x[k0], c.z[k0], c.x[k1], c.z[k1], reach + MAX_BANK_M, [ci, k0, k1]);
      }
      k0 = k1;
    }
  }

  private fileKeeps(data: WorldData) {
    // a bridge keeps nothing, so the channel runs on under its deck (#238); a road ending at a bridge keeps its ground
    // only up to its end there, so the bank meets the abutment instead of filling the span round that end
    const bridgeEnds = new Set<string>();
    for (const r of data.r)
      if (r.br && r.p.length >= 4) for (const k of [0, r.p.length - 2]) bridgeEnds.add(nodeKey([r.p[k], r.p[k + 1]]));
    data.r.forEach(r => {
      if (r.br) return;
      const street = r.c <= RoadClass.SERVICE;
      const keep = ROAD_WIDTH_M[r.c] / 2 + (street ? STREET_KEEP_M : PATH_KEEP_M);
      const ease = street ? STREET_EASE_M : PATH_EASE_M;
      const seat = street ? BRIDGE_SEAT_STREET_M : BRIDGE_SEAT_PATH_M;
      const last = r.p.length - 2;
      for (let i = 2; i < r.p.length; i += 2) {
        const open =
          (i === 2 && bridgeEnds.has(nodeKey([r.p[0], r.p[1]])) ? OPEN_A : 0) |
          (i === last && bridgeEnds.has(nodeKey([r.p[last], r.p[last + 1]])) ? OPEN_B : 0);
        this.file(this.keepCells, r.p[i - 2], r.p[i - 1], r.p[i], r.p[i + 1], keep + ease, [
          r.p[i - 2],
          r.p[i - 1],
          r.p[i],
          r.p[i + 1],
          keep,
          ease,
          open,
          seat,
        ]);
      }
    });
    this.buildings.forEach((b, bi) => {
      const reach = BUILDING_KEEP_M + BUILDING_EASE_M;
      this.file(this.keepCells, b.x0, b.z0, b.x1, b.z1, reach, [
        Number.NaN,
        bi,
        0,
        0,
        BUILDING_KEEP_M,
        BUILDING_EASE_M,
        0,
        0,
      ]);
    });
  }

  /** Files the segment (or box) from a to b in every lookup cell within `reach` of it. */
  private file(
    cells: Map<number, number[]>,
    ax: number,
    az: number,
    bx: number,
    bz: number,
    reach: number,
    item: number[],
  ) {
    const x0 = Math.floor((Math.min(ax, bx) - reach) / CELL_M);
    const x1 = Math.floor((Math.max(ax, bx) + reach) / CELL_M);
    const z0 = Math.floor((Math.min(az, bz) - reach) / CELL_M);
    const z1 = Math.floor((Math.max(az, bz) + reach) / CELL_M);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const k = cellKey(x, z);
        const list = cells.get(k);
        if (list) list.push(...item);
        else cells.set(k, item.slice());
      }
  }

  /** Calls `segment` for each shore segment of the lake that isn't the world's edge. */
  private forShore(l: Lake, segment: (ax: number, az: number, bx: number, bz: number) => void) {
    for (const r of l.rings)
      for (let v = 0; v < r.length; v += 2) {
        const w = (v + 2) % r.length;
        if (!this.onWorldEdge(r[v], r[v + 1], r[w], r[w + 1])) segment(r[v], r[v + 1], r[w], r[w + 1]);
      }
  }

  /** True for a shore segment along the world's edge, where the map cuts a lake rather than a shore. */
  onWorldEdge(ax: number, az: number, bx: number, bz: number) {
    return alongEdge(this.bounds, ax, az, bx, bz, EDGE_M);
  }

  // ---------- queries ----------

  /** Index of the lake (x, z) lies in, islands excluded, or -1. */
  lakeAt(x: number, z: number) {
    for (let i = 0; i < this.lakes.length; i++) {
      const l = this.lakes[i];
      if (x < l.x0 || x > l.x1 || z < l.z0 || z > l.z1) continue;
      let inside = false;
      for (const r of l.rings) if (pointInPolygon(r, x, z)) inside = !inside;
      if (inside) return i;
    }
    return -1;
  }

  /**
   * The nearest river or stream to (x, z) within its banks' reach, written into `out`: its course, the distance from
   * the centre line (m), and the level, half width, slope and bed interpolated there. False when none is that near.
   */
  nearestCourse(x: number, z: number, out: CoursePoint) {
    const list = this.courseCells.get(cellKey(Math.floor(x / CELL_M), Math.floor(z / CELL_M)));
    out.d = Infinity;
    if (!list) return false;
    let best = -1;
    let bestT = 0;
    let bestSq = Infinity;
    for (let i = 0; i < list.length; i += 3) {
      const c = this.courses[list[i]];
      const ax = c.x[list[i + 1]];
      const az = c.z[list[i + 1]];
      const bx = c.x[list[i + 2]];
      const bz = c.z[list[i + 2]];
      const t = segmentParam(x, z, ax, az, bx, bz);
      const dx = x - ax - (bx - ax) * t;
      const dz = z - az - (bz - az) * t;
      const sq = dx * dx + dz * dz;
      if (sq < bestSq) {
        bestSq = sq;
        best = i;
        bestT = t;
      }
    }
    const c = this.courses[list[best]];
    // the samples are evenly spaced along the run: the way along it is the way through them
    const kf = list[best + 1] + (list[best + 2] - list[best + 1]) * bestT;
    const k = Math.min(Math.floor(kf), list[best + 2] - 1);
    const t = kf - k;
    const lerp = (a: Float64Array) => a[k] + (a[k + 1] - a[k]) * t;
    const half = lerp(c.half);
    const d = Math.sqrt(bestSq);
    if (d > half + MAX_BANK_M) return false;
    out.d = d;
    out.course = list[best];
    out.s = lerp(c.s);
    out.level = lerp(c.level);
    out.half = half;
    out.slope = lerp(c.slope);
    out.bed = lerp(c.bed);
    return true;
  }

  /** Distance from (x, z) to the nearest lake shore within MAX_BANK_M, with that lake, or false. */
  private nearestShore(x: number, z: number, out: { d: number; lake: number; along: number }) {
    const list = this.shoreCells.get(cellKey(Math.floor(x / CELL_M), Math.floor(z / CELL_M)));
    out.d = Infinity;
    if (!list) return false;
    for (let i = 0; i < list.length; i += 3) {
      const l = this.lakes[list[i]];
      const r = l.rings[list[i + 1]];
      const v = list[i + 2];
      const w = (v + 2) % r.length;
      if (this.onWorldEdge(r[v], r[v + 1], r[w], r[w + 1])) continue;
      const t = segmentParam(x, z, r[v], r[v + 1], r[w], r[w + 1]);
      const d = Math.hypot(x - r[v] - (r[w] - r[v]) * t, z - r[v + 1] - (r[w + 1] - r[v + 1]) * t);
      if (d < out.d) {
        out.d = d;
        out.lake = list[i];
        // where along the ring, for the banks' wobble: the vertex and the way along its segment
        out.along = (list[i + 1] * 100000 + v / 2 + t) * 0.35;
      }
    }
    return out.d <= MAX_BANK_M;
  }

  /**
   * Distance from (x, z) to the waterline of the lake it is in or beside (m): positive on the water, negative past the
   * waterline, Infinity more than MAX_BANK_M from any shore. The waterline lies a little inside the mapped shore, where
   * the shelf meets the level.
   */
  lakeShoreDistance(x: number, z: number) {
    if (!this.nearestShore(x, z, this.shore)) return Infinity;
    const inside = this.lakeAt(x, z) >= 0;
    return (inside ? this.shore.d : -this.shore.d) - LAKE_LIP_M / LAKE_SHELF_SLOPE;
  }

  /** 1 where the ground may be cut, 0 on and beside roads and buildings, easing between. */
  keepWeight(x: number, z: number) {
    const list = this.keepCells.get(cellKey(Math.floor(x / CELL_M), Math.floor(z / CELL_M)));
    if (!list) return 1;
    let w = 1;
    for (let i = 0; i < list.length && w > 0; i += KEEP_STRIDE) {
      let d: number;
      if (Number.isNaN(list[i])) {
        const b = this.buildings[list[i + 1]];
        d = pointInPolygon(b.p, x, z) ? 0 : polygonDistance(b.p, x, z);
      } else {
        const [ax, az, bx, bz] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
        const len = Math.hypot(bx - ax, bz - az) || 1;
        // how far past the end that meets a bridge, along the road (m); 0 short of it, or at an ordinary end
        const along = list[i + 6]
          ? Math.max(
              list[i + 6] & OPEN_A ? ((ax - x) * (bx - ax) + (az - z) * (bz - az)) / len : 0,
              list[i + 6] & OPEN_B ? ((x - bx) * (bx - ax) + (z - bz) * (bz - az)) / len : 0,
            )
          : 0;
        if (along > 0) {
          // past it the ground is the bridge's channel: the road's keep runs on square under the abutment's seat,
          // then eases out into the span over its ease distance, so the bank meets the abutment
          const across = Math.abs((x - ax) * (bz - az) - (z - az) * (bx - ax)) / len;
          d = Math.max(across, list[i + 4] + Math.max(0, along - list[i + 7]));
        } else {
          const t = segmentParam(x, z, ax, az, bx, bz);
          d = Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t);
        }
      }
      w = Math.min(w, smoothstep(list[i + 4], list[i + 4] + list[i + 5], d));
    }
    return w;
  }

  /**
   * The water level over (x, z), or NaN where there is no water: a lake's level inside its rings, a river's or
   * stream's within its half width. Whether the ground there is under it is the heightfield's to say.
   */
  levelAt(x: number, z: number) {
    const lake = this.lakeAt(x, z);
    if (lake >= 0) return this.lakes[lake].level;
    return this.nearestCourse(x, z, this.point) && this.point.d <= this.point.half ? this.point.level : Number.NaN;
  }

  private readonly point: CoursePoint = { course: -1, d: 0, s: 0, level: 0, half: 0, slope: 0, bed: 0 };
  private readonly shore = { d: 0, lake: -1, along: 0 };

  // ---------- the cut (TerrainCut) ----------

  detail(x0: number, z0: number, x1: number, z1: number) {
    let m = 0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const reach = Math.hypot(x1 - x0, z1 - z0) / 2;
    // the cell's lookup cells, where every segment near it is filed: a lookup cell is half the grid's, so a grid cell is
    // four whole lookup cells, one at each corner
    for (const [x, z] of [
      [x0 + 0.01, z0 + 0.01],
      [x1 - 0.01, z0 + 0.01],
      [x0 + 0.01, z1 - 0.01],
      [x1 - 0.01, z1 - 0.01],
    ]) {
      const k = cellKey(Math.floor(x / CELL_M), Math.floor(z / CELL_M));
      const courses = this.courseCells.get(k);
      if (courses)
        for (let i = 0; i < courses.length; i += 3) {
          const c = this.courses[courses[i]];
          const [a, b] = [courses[i + 1], courses[i + 2]];
          const t = segmentParam(cx, cz, c.x[a], c.z[a], c.x[b], c.z[b]);
          const d = Math.hypot(cx - c.x[a] - (c.x[b] - c.x[a]) * t, cz - c.z[a] - (c.z[b] - c.z[a]) * t);
          const j = Math.round(a + (b - a) * t);
          if (d < reach + c.half[j] + MAX_BANK_M) m = Math.max(m, c.stream[j] > 0.5 ? STREAM_DETAIL : RIVER_DETAIL);
        }
      const shore = this.shoreCells.get(k);
      if (shore) {
        // a shore the cut drops steeply to the water needs the river's finer grid, or its waterline zigzags
        const drop = this.base.heightAt(x, z) - this.lakes[shore[0]].level;
        // so does one a road or building keeps: the kept ground must not fall between sub-samples
        m = Math.max(m, drop > LAKE_STEEP_M || this.keepCells.has(k) ? RIVER_DETAIL : LAKE_DETAIL);
      }
    }
    if (m) return m;
    // deep inside a lake, far from any shore: the corners alone hold it under the water
    return this.lakeAt(cx, cz) >= 0 ? 1 : 0;
  }

  cutAt(x: number, z: number, baseM: number) {
    let h = baseM;
    // a lake: its shelf inside, its bank outside, the shore raised where the ground is lower than the water
    const shore = this.nearestShore(x, z, this.shore);
    const lake = this.lakeAt(x, z);
    if (shore || lake >= 0) {
      const l = this.lakes[shore ? this.shore.lake : lake];
      const sd = shore ? (lake >= 0 ? -this.shore.d : this.shore.d) : -Infinity;
      const slope = LAKE_BANK_SLOPE * (1 + (wander(l.seed, this.shore.along) * 2 - 1) * BANK_WOBBLE);
      const target =
        sd >= 0
          ? l.level + LAKE_LIP_M + sd * slope
          : Math.max(l.level - LAKE_SHELF_M, l.level + LAKE_LIP_M + sd * LAKE_SHELF_SLOPE);
      if (baseM > target)
        h =
          sd >= MAX_BANK_M - 3
            ? baseM - (baseM - softMin(baseM, target, BANK_ROUND_M)) * (1 - smoothstep(MAX_BANK_M - 3, MAX_BANK_M, sd))
            : softMin(baseM, target, BANK_ROUND_M);
      // only as high as holds the water in, not up the bank's line
      else if (sd >= 0 && baseM < l.level + LAKE_LIP_M)
        h = baseM + (l.level + LAKE_LIP_M - baseM) * (1 - smoothstep(LAKE_RAISE_FULL_M, LAKE_RAISE_END_M, sd));
    }
    // a river or stream: the bed under the water, a bank rising from the waterline
    if (this.nearestCourse(x, z, this.point)) {
      const { d, level, half, slope, bed } = this.point;
      const target = d < half ? level - bed * (1 - (d / half) ** 2) : level + (d - half) * slope;
      if (target < h + BANK_ROUND_M) {
        const reach = half + MAX_BANK_M;
        h = h - (h - softMin(h, target, BANK_ROUND_M)) * (1 - smoothstep(reach - 3, reach, d));
      }
    }
    if (h === baseM) return baseM;
    return baseM + (h - baseM) * this.keepWeight(x, z);
  }
}

export interface CoursePoint {
  course: number;
  d: number;
  s: number;
  level: number;
  half: number;
  slope: number;
  bed: number;
}

function boundsOf(p: number[]): Bounds {
  const b = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (let i = 0; i < p.length; i += 2) {
    b.x0 = Math.min(b.x0, p[i]);
    b.x1 = Math.max(b.x1, p[i]);
    b.z0 = Math.min(b.z0, p[i + 1]);
    b.z1 = Math.max(b.z1, p[i + 1]);
  }
  return b;
}

function polygonDistance(p: number[], x: number, z: number) {
  let d = Infinity;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    const t = segmentParam(x, z, p[i], p[i + 1], p[j], p[j + 1]);
    d = Math.min(d, Math.hypot(x - p[i] - (p[j] - p[i]) * t, z - p[i + 1] - (p[j + 1] - p[i + 1]) * t));
  }
  return d;
}
