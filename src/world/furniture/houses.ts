// Which street each house belongs to, which side of it the house is on, and where its driveway meets the street
// (#305). Pure: no three.js. The wheelie bins, mailboxes and street cabinets hang off this.

import { ROAD_WIDTH_M, RoadClass, RoadUse, type WorldData } from '../data';
import { polygonArea, segmentDistance, segmentParam } from '../polygon';
import type { RoadLine } from '../roads';

/** a building between these footprints is a house (m²): smaller is a shed, larger a block or a barn */
const HOUSE_MIN_M2 = 40;
const HOUSE_MAX_M2 = 400;
/** a house's middle within this of a street's centre line belongs to it (m) */
const HOUSE_REACH_M = 35;
/** a driveway belongs to a house when one end is this close to the street's edge and the other this close to the house (m) */
const DRIVEWAY_STREET_M = 4;
const DRIVEWAY_HOUSE_M = 22;

export interface HouseFront {
  /** a stable key from the house's middle, so choices follow the house rather than data order */
  key: string;
  /** the house's middle, and its outline as flat [x, z, ...] */
  x: number;
  z: number;
  p: readonly number[];
  /** its street, the side of it the house is on (-1 left, +1 right of the way's direction), and where along it (m) */
  ri: number;
  side: -1 | 1;
  s: number;
  /** true when `s` is where a mapped driveway meets the street, rather than opposite the house's middle */
  driveway: boolean;
}

/** The point on road `p` nearest (x, z): how far along it (m), how far from it, and which side (x east, z south). */
function project(p: readonly (readonly [number, number])[], x: number, z: number) {
  let best = { s: 0, d: Infinity, side: 1 as -1 | 1 };
  let along = 0;
  for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1];
    const [bx, bz] = p[i];
    const len = Math.hypot(bx - ax, bz - az);
    const d = segmentDistance(x, z, ax, az, bx, bz);
    if (d < best.d) {
      const cross = (bx - ax) * (z - az) - (bz - az) * (x - ax); // > 0: right of the way
      best = { s: along + segmentParam(x, z, ax, az, bx, bz) * len, d, side: cross > 0 ? 1 : -1 };
    }
    along += len;
  }
  return best;
}

/**
 * Each house with the street it fronts: the nearest street (class STREET or bigger, not a sidewalk) within
 * HOUSE_REACH_M, where `eligible` says the street counts. A mapped driveway from that street to the house moves the
 * front to where the driveway meets it.
 */
export function houseFronts(
  data: WorldData,
  roads: {
    readonly lines: readonly RoadLine[];
    forEachSegmentNear(
      x: number,
      z: number,
      reachM: number,
      visit: (ax: number, az: number, bx: number, bz: number, ri: number) => void,
    ): void;
  },
  eligible: (ri: number) => boolean,
): HouseFront[] {
  const driveways = roads.lines.flatMap((l, ri) => (data.r[ri].s === RoadUse.DRIVEWAY && l.p.length > 1 ? [l] : []));
  const out: HouseFront[] = [];
  for (const b of data.b) {
    const area = polygonArea(b.p);
    if (b.k !== 0 || area < HOUSE_MIN_M2 || area > HOUSE_MAX_M2) continue;
    let x = 0;
    let z = 0;
    for (let i = 0; i < b.p.length; i += 2) {
      x += b.p[i];
      z += b.p[i + 1];
    }
    x /= b.p.length / 2;
    z /= b.p.length / 2;
    // every road with a segment within the reach; each is measured once, along its whole line
    let best: { ri: number; s: number; d: number; side: -1 | 1 } | null = null;
    const seen = new Set<number>();
    roads.forEachSegmentNear(x, z, HOUSE_REACH_M, (_ax, _az, _bx, _bz, ri) => {
      if (seen.has(ri)) return;
      seen.add(ri);
      const road = roads.lines[ri];
      if (road.c > RoadClass.STREET || data.r[ri].s === RoadUse.SIDEWALK || !eligible(ri)) return;
      const p = project(road.p, x, z);
      if (p.d <= HOUSE_REACH_M && (!best || p.d < best.d)) best = { ri, ...p };
    });
    // set inside the callback, so TypeScript can't see it change: name the result
    const found = best as { ri: number; s: number; d: number; side: -1 | 1 } | null;
    if (!found) continue;
    const street = roads.lines[found.ri];
    const key = `h${Math.round(x * 10)}.${Math.round(z * 10)}`;
    // a driveway from this street to this house: the end near the street's edge marks the front
    let front = found.s;
    let driveway = false;
    let nearest = DRIVEWAY_HOUSE_M;
    for (const dw of driveways)
      for (const [mouth, end] of [
        [dw.p[0], dw.p[dw.p.length - 1]],
        [dw.p[dw.p.length - 1], dw.p[0]],
      ]) {
        const toHouse = Math.hypot(end[0] - x, end[1] - z);
        if (toHouse >= nearest) continue; // most driveways are far from this house: skip the projection
        const atStreet = project(street.p, mouth[0], mouth[1]);
        // the mouth at the street's edge, on the house's side (or on the centre line, where the driveway joins it)
        if (
          atStreet.d > ROAD_WIDTH_M[street.c] / 2 + DRIVEWAY_STREET_M ||
          (atStreet.side !== found.side && atStreet.d > 1)
        )
          continue;
        nearest = toHouse;
        front = atStreet.s;
        driveway = true;
      }
    out.push({ key, x, z, p: b.p, ri: found.ri, side: found.side, s: front, driveway });
  }
  return out;
}
