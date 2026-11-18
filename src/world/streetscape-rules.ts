// Which side of which road gets a sidewalk, curb, verge and street parking, and on what evidence (#187). Pure: no
// three.js, no DOM. OSM says what it knows; where it says nothing, the documented rules below decide, deterministically,
// and the result is labelled `inferred` so it is never shown as fact.
import {
  LandUse,
  ParkingOrientation,
  RoadClass,
  RoadUse,
  ROAD_WIDTH_M,
  SideState,
  StreetParking,
  Surface,
  type WorldData,
} from './data';
import { pointInPolygon, segmentDistance } from './polygon';
import { polylineLength, resample, STEP_M } from './polyline';
import { hash01 } from './random';
import type { Point, RoadLine } from './roads';
import type { StreetscapeOverride } from './streetscape-overrides';

/** mapped: OSM says it and where; derived: OSM says it exists, defaults fill the rest; inferred: a rule guessed it */
export type Source = 'mapped' | 'derived' | 'inferred';
export type Profile = 'centre' | 'residential' | 'outskirts';

// Game-design defaults, not claims about Vrigstad; mapped values win.
/** sidewalk width by profile (m) */
export const SIDEWALK_CENTRE_M = 2.0;
export const SIDEWALK_RESIDENTIAL_M = 1.5;
/** curb height by profile (m); a mapped sidewalk in the outskirts takes the residential curb */
export const CURB_CENTRE_M = 0.12;
export const CURB_RESIDENTIAL_M = 0.1;
/** grass strip between curb and sidewalk on the residential streets that get one (m) */
export const VERGE_M = 0.8;
/** share of residential streets with a verge, chosen per way by hash */
export const VERGE_SHARE = 0.4;

/** the centre: within this of the Torget label (m) */
const CENTRE_RADIUS_M = 300;
/** buildings counted within this of the road (m) */
const FRONTAGE_REACH_M = 40;
/** buildings per 100 m of road for the centre and for residential */
const CENTRE_DENSITY = 4;
const RESIDENTIAL_DENSITY = 2;
/** a road shorter than this counts as this long, so a short stub by one house isn't "dense" (m) */
const MIN_DENSITY_LENGTH_M = 50;
/** the residential sidewalk goes on the side with more buildings within this (m) */
const SIDE_REACH_M = 30;
/** a separate sidewalk covers a side when it runs within (half the carriageway + this) ... (m) */
const SEPARATE_REACH_M = 8;
/** ... for at least this share of a window this long (m) ... */
const SEPARATE_WINDOW_M = 30;
const SEPARATE_SHARE = 0.6;
/** ... with headings within this (degrees) */
const SEPARATE_ANGLE_DEG = 20;

export interface SideSpec {
  /** what the side gets; 'separate' means a separately mapped footway is the sidewalk */
  sidewalk: 'present' | 'absent' | 'separate';
  /** sidewalk width (m), 0 without one */
  widthM: number;
  surface: Surface;
  /** curb height (m), 0 without a raised strip */
  curbM: number;
  /** grass strip between curb and sidewalk (m) */
  vergeM: number;
  parking: StreetParking;
  orientation: ParkingOrientation;
  /** the evidence for the sidewalk decision */
  source: Source;
  /**
   * per sample of resample(road), 1 where a separately mapped sidewalk runs alongside, so no strip is built there;
   * null when none does
   */
  separate: Uint8Array | null;
}

export interface StreetSides {
  profile: Profile;
  /** left and right of the OSM way's own direction */
  left: SideSpec;
  right: SideSpec;
  /** street trees may be inferred on this road's verges */
  streetTrees: boolean;
}

export interface FootprintLike {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const blank = (): SideSpec => ({
  sidewalk: 'absent',
  widthM: 0,
  surface: Surface.UNKNOWN,
  curbM: 0,
  vergeM: 0,
  parking: StreetParking.UNKNOWN,
  orientation: ParkingOrientation.UNKNOWN,
  source: 'inferred',
  separate: null,
});

/** identity for hashing: the OSM way id, or, in hand-made fixtures without one, the first vertex */
const wayKey = (data: WorldData, ri: number) => data.r[ri].i ?? data.r[ri].p[0] + '/' + data.r[ri].p[1];

/** the point half way along the polyline */
function midpoint(p: readonly Point[]): Point {
  let left = polylineLength(p) / 2;
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (left <= d && d > 0) return [p[i - 1][0] + ((p[i][0] - p[i - 1][0]) * left) / d, p[i - 1][1] + ((p[i][1] - p[i - 1][1]) * left) / d];
    left -= d;
  }
  return p[p.length - 1];
}

/** Distance from (x, z) to the polyline, and which side it is on: -1 left, +1 right of its direction. */
function sideOf(p: readonly Point[], x: number, z: number) {
  let best = Infinity;
  let side = 0;
  for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1];
    const [bx, bz] = p[i];
    const d = segmentDistance(x, z, ax, az, bx, bz);
    if (d < best) {
      best = d;
      // right of the direction (dx, dz) is (-dz, dx): positive dot with it is the right
      side = Math.sign(-(bz - az) * (x - ax) + (bx - ax) * (z - az)) || 1;
    }
  }
  return { d: best, side };
}

/**
 * Per sample of resample(road), on side `side` (-1 left, +1 right), whether a separately mapped sidewalk runs
 * alongside: within half the carriageway + SEPARATE_REACH_M, headings within SEPARATE_ANGLE_DEG, for SEPARATE_SHARE of a
 * SEPARATE_WINDOW_M window. This is what stops a sidewalk being drawn twice.
 */
function separateCover(road: RoadLine, sidewalks: readonly RoadLine[], side: number) {
  if (!sidewalks.length) return null;
  const q = resample(road.p, STEP_M);
  const reach = ROAD_WIDTH_M[road.c] / 2 + SEPARATE_REACH_M;
  const cosMax = Math.cos((SEPARATE_ANGLE_DEG * Math.PI) / 180);
  const hit = new Uint8Array(q.length);
  for (let i = 0; i < q.length; i++) {
    const a = q[Math.max(0, i - 1)];
    const b = q[Math.min(q.length - 1, i + 1)];
    const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const tx = (b[0] - a[0]) / tl;
    const tz = (b[1] - a[1]) / tl;
    const [x, z] = q[i];
    for (const s of sidewalks) {
      for (let k = 1; k < s.p.length && !hit[i]; k++) {
        const [ax, az] = s.p[k - 1];
        const [bx, bz] = s.p[k];
        if (segmentDistance(x, z, ax, az, bx, bz) > reach) continue;
        const sl = Math.hypot(bx - ax, bz - az) || 1;
        if (Math.abs(((bx - ax) * tx + (bz - az) * tz) / sl) < cosMax) continue;
        // which side of the road the sidewalk segment's nearest point is on
        const mx = (ax + bx) / 2 - x;
        const mz = (az + bz) / 2 - z;
        if (Math.sign(-tz * mx + tx * mz) === side) hit[i] = 1;
      }
    }
  }
  const window = Math.max(1, Math.round(SEPARATE_WINDOW_M / STEP_M));
  const out = new Uint8Array(q.length);
  let any = false;
  for (let i = 0; i + window <= q.length || i === 0; i++) {
    const end = Math.min(q.length, i + window);
    let n = 0;
    for (let k = i; k < end; k++) n += hit[k];
    if (n >= SEPARATE_SHARE * (end - i)) {
      out.fill(1, i, end);
      any = true;
    }
  }
  return any ? out : null;
}

/** Buildings near the road: how many per 100 m within FRONTAGE_REACH_M, and how many on each side within SIDE_REACH_M. */
function frontage(road: RoadLine, centres: readonly Point[]) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, z] of road.p) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  let near = 0;
  let left = 0;
  let right = 0;
  for (const [x, z] of centres) {
    if (x < x0 - FRONTAGE_REACH_M || x > x1 + FRONTAGE_REACH_M || z < z0 - FRONTAGE_REACH_M || z > z1 + FRONTAGE_REACH_M) continue;
    const { d, side } = sideOf(road.p, x, z);
    if (d > FRONTAGE_REACH_M) continue;
    near++;
    if (d <= SIDE_REACH_M) {
      if (side < 0) left++;
      else right++;
    }
  }
  return { perHundred: (near * 100) / Math.max(MIN_DENSITY_LENGTH_M, polylineLength(road.p)), left, right };
}

function profileOf(data: WorldData, road: RoadLine, density: number): Profile {
  const torget = data.labels.find((l) => l.t === 'Torget');
  const [mx, mz] = midpoint(road.p);
  if (torget && Math.hypot(mx - torget.x, mz - torget.z) <= CENTRE_RADIUS_M && density >= CENTRE_DENSITY) return 'centre';
  if (density >= RESIDENTIAL_DENSITY) return 'residential';
  for (const l of data.l) if (l.k === LandUse.RESIDENTIAL && pointInPolygon(l.p, mx, mz)) return 'residential';
  return 'outskirts';
}

const defaultWidth = (profile: Profile) => (profile === 'centre' ? SIDEWALK_CENTRE_M : SIDEWALK_RESIDENTIAL_M);
const defaultCurb = (profile: Profile) => (profile === 'centre' ? CURB_CENTRE_M : CURB_RESIDENTIAL_M);
const defaultSurface = (profile: Profile) => (profile === 'centre' ? Surface.PAVING : Surface.ASPHALT);

/** A side with a sidewalk, from explicit or inferred evidence. */
function present(profile: Profile, widthM: number, surface: Surface, source: Source, verge: boolean): Partial<SideSpec> {
  return {
    sidewalk: 'present',
    widthM: widthM || defaultWidth(profile),
    surface: surface || defaultSurface(profile),
    curbM: defaultCurb(profile),
    vergeM: verge ? VERGE_M : 0,
    source,
  };
}

/**
 * The streetscape of each road, in `data.r` order: per side the sidewalk, curb, verge and street parking, with the
 * evidence for each sidewalk decision. In order: overrides, explicit OSM tags, a separately mapped sidewalk alongside,
 * then inference for streets in built-up areas. Deterministic: choices hash the OSM way id, never data order or rnd().
 */
export function classifyStreetscape(
  data: WorldData,
  roads: { readonly lines: readonly RoadLine[] },
  buildings: { readonly footprints: readonly FootprintLike[] },
  overrides: Readonly<Record<number, StreetscapeOverride>> = {},
): StreetSides[] {
  const centres: Point[] = buildings.footprints.map((b) => [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2]);
  const sidewalks = roads.lines.filter((_, ri) => data.r[ri].s === RoadUse.SIDEWALK);

  return roads.lines.map((road, ri): StreetSides => {
    const r = data.r[ri];
    const key = wayKey(data, ri);
    const use = r.s ?? RoadUse.NONE;
    const carriageway = road.c <= RoadClass.SERVICE && use !== RoadUse.SIDEWALK && use !== RoadUse.CROSSING;
    const out: StreetSides = { profile: 'outskirts', left: blank(), right: blank(), streetTrees: false };
    if (!carriageway) return out;

    const f = frontage(road, centres);
    const override = r.i !== undefined ? overrides[r.i] : undefined;
    const profile = override?.profile ?? profileOf(data, road, f.perHundred);
    out.profile = profile;
    const verge = override?.verge ?? (profile === 'residential' && hash01(key, 'verge') < VERGE_SHARE);
    const sides: [SideSpec, SideSpec] = [out.left, out.right];

    sides.forEach((side, k) => {
      side.parking = r.pk?.[k] ?? StreetParking.UNKNOWN;
      side.orientation = r.po?.[k] ?? ParkingOrientation.UNKNOWN;
      const o = override?.sidewalk?.[k ? 'right' : 'left'];
      const state = r.sw?.[k] ?? SideState.UNKNOWN;
      if (o) {
        // a cited survey is as good as a mapped tag; anything else stays derived
        const source: Source = /survey/i.test(override!.note) ? 'mapped' : 'derived';
        if (o === 'present') Object.assign(side, present(profile, override!.sidewalkWidthM ?? 0, Surface.UNKNOWN, source, verge));
        else Object.assign(side, { sidewalk: o, source });
      } else if (state === SideState.PRESENT) {
        // a mapped width makes it mapped; a bare sidewalk=yes|both|left|right leaves the geometry to the defaults
        const w = r.sww?.[k] ?? 0;
        Object.assign(side, present(profile, w, r.ssf?.[k] ?? Surface.UNKNOWN, w ? 'mapped' : 'derived', verge));
      } else if (state === SideState.ABSENT) Object.assign(side, { sidewalk: 'absent', source: 'mapped' });
      else if (state === SideState.SEPARATE) Object.assign(side, { sidewalk: 'separate', source: 'mapped' });
    });

    // a separately mapped sidewalk alongside an untagged side: that stretch has its sidewalk already
    sides.forEach((side, k) => {
      if (override?.sidewalk?.[k ? 'right' : 'left'] || (r.sw?.[k] ?? SideState.UNKNOWN) !== SideState.UNKNOWN) return;
      side.separate = separateCover(road, sidewalks, k ? 1 : -1);
      if (side.separate && side.separate.every(Boolean)) Object.assign(side, { sidewalk: 'separate', source: 'derived' });
    });

    // inference: streets only, built-up only, sides OSM said nothing about
    const unknown = (k: number) => !override?.sidewalk?.[k ? 'right' : 'left'] && (r.sw?.[k] ?? SideState.UNKNOWN) === SideState.UNKNOWN && sides[k].sidewalk !== 'separate';
    if (road.c <= RoadClass.STREET && use === RoadUse.NONE && profile !== 'outskirts') {
      if (profile === 'centre') {
        for (const k of [0, 1]) if (unknown(k)) Object.assign(sides[k], present(profile, 0, Surface.UNKNOWN, 'inferred', false));
      } else {
        // one side: the one with more houses on it; a tie goes by the way's hash
        const k = f.left === f.right ? (hash01(key, 'side') < 0.5 ? 0 : 1) : f.left > f.right ? 0 : 1;
        if (unknown(k)) Object.assign(sides[k], present(profile, 0, Surface.UNKNOWN, 'inferred', verge));
      }
    }
    out.streetTrees = profile === 'residential' && sides.some((s) => s.vergeM >= VERGE_M);
    return out;
  });
}
