// Which street each house belongs to, which side of it the house is on, and where its driveway meets the street
// (#305). Pure: no three.js. The wheelie bins, mailboxes and street cabinets hang off this.

import { HOUSE_MIN_M2 } from '../buildings';
import { BuildingKind, ROAD_WIDTH_M, RoadClass, RoadUse, type WorldData } from '../data';
import { polygonArea, segmentDistance, segmentParam, vertexCentre } from '../polygon';
import type { RoadLine } from '../roads';
import type { FurnitureInput } from './placer';

/**
 * houses up to this (m²) have their own mailbox and wheelie bins; bigger ones (blocks, shops, barns), which buildings.ts
 * still gives house details up to its HOUSE_MAX_M2, share theirs away from the street
 */
const OWN_HOME_MAX_M2 = 400;
/** a house's middle within this of a street's centre line belongs to it (m) */
const HOUSE_REACH_M = 35;
/** a driveway's mouth is at most this far past the street's edge (m) */
const DRIVEWAY_STREET_M = 4;
/** a driveway's far end is at most this far from the middle of the house it serves (m) */
const DRIVEWAY_HOUSE_M = 22;

export interface HouseFront {
  /** a stable key from the house's middle, so choices follow the house rather than data order */
  key: string;
  /** the house's middle */
  x: number;
  z: number;
  /** its outline, flat [x, z, ...] */
  outline: readonly number[];
  /** its street, and the side of it the house is on (-1 left, +1 right of the street's direction) */
  ri: number;
  side: -1 | 1;
  /** where along the street the house's front is (m) */
  alongM: number;
  /** `alongM` is where a mapped driveway meets the street, rather than opposite the house's middle */
  atDriveway: boolean;
  /** that driveway's road index, when `atDriveway` */
  drivewayRi?: number;
}

/** The point on a road nearest a given point: how far along the road (m), how far from it (m), and which side. */
interface StreetMatch {
  s: number;
  d: number;
  side: -1 | 1;
}

/** The point on road `p` nearest (x, z) (x east, z south). */
export function project(p: readonly (readonly [number, number])[], x: number, z: number): StreetMatch {
  let best: StreetMatch = { s: 0, d: Infinity, side: 1 };
  let along = 0;
  for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1];
    const [bx, bz] = p[i];
    const len = Math.hypot(bx - ax, bz - az);
    const d = segmentDistance(x, z, ax, az, bx, bz);
    if (d < best.d) {
      const cross = (bx - ax) * (z - az) - (bz - az) * (x - ax); // > 0: right of the road's direction
      best = { s: along + segmentParam(x, z, ax, az, bx, bz) * len, d, side: cross > 0 ? 1 : -1 };
    }
    along += len;
  }
  return best;
}

/** The nearest eligible street within HOUSE_REACH_M of (x, z): class STREET or bigger, not a sidewalk. */
function nearestStreet(
  data: WorldData,
  roads: FurnitureInput['roads'],
  eligible: (ri: number) => boolean,
  x: number,
  z: number,
) {
  let best: (StreetMatch & { ri: number }) | null = null;
  const seen = new Set<number>(); // each road is measured once, along its whole line
  roads.forEachSegmentNear(x, z, HOUSE_REACH_M, (_ax, _az, _bx, _bz, ri) => {
    if (seen.has(ri)) return;
    seen.add(ri);
    const road = roads.lines[ri];
    if (road.c > RoadClass.STREET || data.r[ri].s === RoadUse.SIDEWALK || !eligible(ri)) return;
    const p = project(road.p, x, z);
    if (p.d <= HOUSE_REACH_M && (!best || p.d < best.d)) best = { ri, ...p };
  });
  // set inside the callback, so TypeScript can't see it change: name the result
  return best as (StreetMatch & { ri: number }) | null;
}

/** A driveway that reaches a house: which one, how close its far end is to the house (m), and where its mouth meets the street (m along it). */
interface DrivewayMatch {
  di: number;
  toHouseM: number;
  alongM: number;
}

/** The mapped driveway from `street` that ends nearest (x, z), on the house's `side`, within DRIVEWAY_HOUSE_M. */
function drivewayFront(street: RoadLine, side: -1 | 1, x: number, z: number, driveways: readonly RoadLine[]) {
  let best: DrivewayMatch | null = null;
  for (let di = 0; di < driveways.length; di++) {
    const { p } = driveways[di];
    for (const [mouth, end] of [
      [p[0], p[p.length - 1]],
      [p[p.length - 1], p[0]],
    ]) {
      const toHouseM = Math.hypot(end[0] - x, end[1] - z);
      if (toHouseM >= (best?.toHouseM ?? DRIVEWAY_HOUSE_M)) continue; // most driveways are far: skip the projection
      const atStreet = project(street.p, mouth[0], mouth[1]);
      // the mouth at the street's edge, on the house's side (or on the centre line, where the driveway joins it)
      if (atStreet.d > ROAD_WIDTH_M[street.c] / 2 + DRIVEWAY_STREET_M || (atStreet.side !== side && atStreet.d > 1))
        continue;
      best = { di, toHouseM, alongM: atStreet.s };
    }
  }
  return best;
}

/**
 * Each house with the street it fronts: the nearest street within HOUSE_REACH_M where `eligible` says the street counts.
 * A mapped driveway from that street to the house moves the front to where the driveway meets it. A driveway that two
 * houses reach serves the one its far end is nearer; the other keeps its front opposite its middle.
 */
export function houseFronts(
  data: WorldData,
  roads: FurnitureInput['roads'],
  eligible: (ri: number) => boolean,
): HouseFront[] {
  const drivewayRis = roads.lines.flatMap((l, ri) => (data.r[ri].s === RoadUse.DRIVEWAY && l.p.length > 1 ? [ri] : []));
  const driveways = drivewayRis.map(ri => roads.lines[ri]);
  const found: { front: HouseFront; driveway: DrivewayMatch | null }[] = [];
  for (const b of data.b) {
    const area = polygonArea(b.p);
    if (b.k !== BuildingKind.OTHER || area < HOUSE_MIN_M2 || area > OWN_HOME_MAX_M2) continue;
    const { x, z } = vertexCentre(b.p);
    const street = nearestStreet(data, roads, eligible, x, z);
    if (!street) continue;
    const front: HouseFront = {
      key: `h${Math.round(x * 10)}.${Math.round(z * 10)}`,
      x,
      z,
      outline: b.p,
      ri: street.ri,
      side: street.side,
      alongM: street.s,
      atDriveway: false,
    };
    found.push({ front, driveway: drivewayFront(roads.lines[street.ri], street.side, x, z, driveways) });
  }
  // the house nearest each driveway's far end, of those it reaches
  const nearestM = new Map<number, number>();
  for (const { driveway: m } of found)
    if (m && m.toHouseM < (nearestM.get(m.di) ?? Infinity)) nearestM.set(m.di, m.toHouseM);
  return found.map(({ front, driveway: m }) =>
    m && nearestM.get(m.di) === m.toHouseM
      ? { ...front, alongM: m.alongM, atDriveway: true, drivewayRi: drivewayRis[m.di] }
      : front,
  );
}
